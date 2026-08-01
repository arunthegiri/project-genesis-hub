// backtest_main.cpp — offline backtest driver for the rf_v1 model.
//
// Replays historical bars through the REAL HermesEngine in simulated-fill mode
// (blank Alpaca creds), exactly as the live path would run them: NVDA bars ->
// onBar, SPY/AMD -> onCompanionBar, daily HMM regime -> setRegime at each UTC
// day boundary. Afterwards it reads the engine's in-memory completed trades +
// equity curve, computes performance stats, and writes a frontend-ready JSON.
//
// This is the C++ engine producing the numbers the frontend "models" tab shows
// — no Java backend, no Python inference in the path.
//
// Usage:
//   hermes_backtest <config.json> <bars.csv> <daily_regime.csv> <out.json>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <ctime>
#include <fstream>
#include <iostream>
#include <map>
#include <sstream>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "config/EngineConfig.hpp"
#include "engine/FeatureCalculator.hpp"   // Bar
#include "engine/HermesEngine.hpp"

using nlohmann::json;
using hermes::Bar;
using Clock = std::chrono::system_clock;

namespace {

// Parse "2026-03-02T14:31:00Z" (UTC) -> time_point.
Clock::time_point parseIso(const std::string& s) {
    int y = 0, mo = 0, d = 0, h = 0, mi = 0, sec = 0;
    std::sscanf(s.c_str(), "%d-%d-%dT%d:%d:%d", &y, &mo, &d, &h, &mi, &sec);
    std::tm tm{};
    tm.tm_year = y - 1900;
    tm.tm_mon  = mo - 1;
    tm.tm_mday = d;
    tm.tm_hour = h;
    tm.tm_min  = mi;
    tm.tm_sec  = sec;
    return Clock::from_time_t(timegm(&tm));
}

// time_point -> "2026-03-02T14:31:00Z" (UTC).
std::string formatIso(Clock::time_point tp) {
    const std::time_t t = Clock::to_time_t(tp);
    std::tm tm{};
    gmtime_r(&t, &tm);
    char buf[32];
    std::strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &tm);
    return buf;
}

// UTC calendar day key "YYYY-MM-DD" for regime lookup.
std::string utcDateKey(Clock::time_point tp) {
    const std::time_t t = Clock::to_time_t(tp);
    std::tm tm{};
    gmtime_r(&t, &tm);
    char buf[16];
    std::strftime(buf, sizeof(buf), "%Y-%m-%d", &tm);
    return buf;
}

std::vector<std::string> splitCsv(const std::string& line) {
    std::vector<std::string> out;
    std::string cell;
    std::stringstream ss(line);
    while (std::getline(ss, cell, ',')) out.push_back(cell);
    return out;
}

struct CsvBar {
    Clock::time_point time;
    std::string       symbol;
    Bar               bar;
};

}  // namespace

int main(int argc, char* argv[]) {
    if (argc < 5) {
        std::cerr << "usage: " << argv[0]
                  << " <config.json> <bars.csv> <daily_regime.csv> <out.json>\n";
        return 1;
    }
    const std::string config_path = argv[1];
    const std::string bars_path   = argv[2];
    const std::string regime_path = argv[3];
    const std::string out_path    = argv[4];

    // ---- Config: force simulated fills (blank creds); keep the contract's DB. --
    hermes::EngineConfig config = hermes::EngineConfig::fromFile(config_path);
    config.alpaca_key.clear();
    config.alpaca_secret.clear();
    const std::string primary = config.symbols.empty() ? "NVDA" : config.symbols[0];

    // ---- Daily regimes: date -> regime -----------------------------------------
    std::map<std::string, int> regimes;
    {
        std::ifstream in(regime_path);
        if (!in) { std::cerr << "cannot open " << regime_path << "\n"; return 1; }
        std::string line;
        std::getline(in, line);  // header
        while (std::getline(in, line)) {
            if (line.empty()) continue;
            const auto cols = splitCsv(line);
            if (cols.size() < 2) continue;
            regimes[cols[0]] = std::stoi(cols[1]);
        }
    }
    std::cerr << "loaded " << regimes.size() << " daily regimes\n";

    // ---- Bars ------------------------------------------------------------------
    std::vector<CsvBar> bars;
    {
        std::ifstream in(bars_path);
        if (!in) { std::cerr << "cannot open " << bars_path << "\n"; return 1; }
        std::string line;
        std::getline(in, line);  // header: time,symbol,open,high,low,close,volume
        while (std::getline(in, line)) {
            if (line.empty()) continue;
            const auto c = splitCsv(line);
            if (c.size() < 7) continue;
            CsvBar cb;
            cb.time        = parseIso(c[0]);
            cb.symbol      = c[1];
            cb.bar.time    = cb.time;
            cb.bar.open    = std::stod(c[2]);
            cb.bar.high    = std::stod(c[3]);
            cb.bar.low     = std::stod(c[4]);
            cb.bar.close   = std::stod(c[5]);
            cb.bar.volume  = std::stod(c[6]);
            cb.bar.symbol  = c[1];
            bars.push_back(std::move(cb));
        }
    }
    std::cerr << "loaded " << bars.size() << " bars\n";
    // Stable-sort by time; the file is already time-then-symbol sorted.
    std::stable_sort(bars.begin(), bars.end(),
                     [](const CsvBar& a, const CsvBar& b) { return a.time < b.time; });

    // ---- Construct engine + replay ---------------------------------------------
    hermes::HermesEngine engine(config);

    std::string last_day;
    // Feed one timestamp-group at a time: companions BEFORE the primary so the
    // cross-asset buffers hold the current minute's SPY/AMD close when NVDA is
    // evaluated.
    size_t i = 0;
    while (i < bars.size()) {
        const Clock::time_point ts = bars[i].time;
        size_t j = i;
        while (j < bars.size() && bars[j].time == ts) ++j;  // [i, j) same timestamp

        // Day boundary -> broadcast that day's regime before processing.
        const std::string day = utcDateKey(ts);
        if (day != last_day) {
            const auto it = regimes.find(day);
            if (it != regimes.end()) engine.setRegime(it->second);
            last_day = day;
        }

        // Companions first.
        for (size_t k = i; k < j; ++k)
            if (bars[k].symbol != primary)
                engine.onCompanionBar(bars[k].symbol, bars[k].bar);
        // Then the primary/traded symbol(s).
        for (size_t k = i; k < j; ++k)
            if (bars[k].symbol == primary)
                engine.onBar(bars[k].symbol, bars[k].bar);

        i = j;
    }

    // ---- Collect results + compute stats ---------------------------------------
    const auto& trades = engine.completedTrades();
    const auto& equity = engine.equityCurve();

    const double start_cap = config.starting_capital;
    double total_pnl = 0.0, gross_profit = 0.0, gross_loss = 0.0;
    double largest_win = 0.0, largest_loss = 0.0, sum_win = 0.0, sum_loss = 0.0;
    int wins = 0, losses = 0;
    for (const auto& t : trades) {
        total_pnl += t.pnl;
        if (t.pnl > 0) { ++wins; gross_profit += t.pnl; sum_win += t.pnl;
                         largest_win = std::max(largest_win, t.pnl); }
        else           { ++losses; gross_loss += -t.pnl; sum_loss += t.pnl;
                         largest_loss = std::min(largest_loss, t.pnl); }
    }
    const int n_trades = static_cast<int>(trades.size());
    const double end_cap = start_cap + total_pnl;
    const double win_rate = n_trades ? static_cast<double>(wins) / n_trades : 0.0;
    const double avg_win  = wins ? sum_win / wins : 0.0;
    const double avg_loss = losses ? sum_loss / losses : 0.0;
    const double profit_factor =
        gross_loss > 0 ? gross_profit / gross_loss : (gross_profit > 0 ? 999.99 : 0.0);
    const double total_pnl_pct =
        start_cap > 0 ? (end_cap / start_cap - 1.0) * 100.0 : 0.0;

    // Max drawdown (fraction 0..1) from the mark-to-market equity curve.
    double peak = start_cap, max_dd = 0.0;
    for (const auto& [t, eq] : equity) {
        peak = std::max(peak, eq);
        if (peak > 0) max_dd = std::max(max_dd, (peak - eq) / peak);
    }

    // Sharpe from daily equity returns (last equity per UTC day), annualized.
    std::map<std::string, double> daily_last;
    for (const auto& [t, eq] : equity) daily_last[utcDateKey(t)] = eq;
    std::vector<double> daily_ret;
    double prev = 0.0; bool have_prev = false;
    for (const auto& [d, eq] : daily_last) {
        if (have_prev && prev > 0) daily_ret.push_back(eq / prev - 1.0);
        prev = eq; have_prev = true;
    }
    double sharpe = 0.0;
    if (daily_ret.size() >= 2) {
        double m = 0.0; for (double r : daily_ret) m += r; m /= daily_ret.size();
        double v = 0.0; for (double r : daily_ret) v += (r - m) * (r - m);
        v /= (daily_ret.size() - 1);
        const double sd = std::sqrt(v);
        if (sd > 0) sharpe = (m / sd) * std::sqrt(252.0);
    }

    // ---- Serialize -------------------------------------------------------------
    // Model name/version from strategy_name "<name>_v<N>".
    std::string mname = config.strategy_name, mver = "v1";
    if (const auto p = config.strategy_name.rfind("_v"); p != std::string::npos) {
        mname = config.strategy_name.substr(0, p);
        mver  = config.strategy_name.substr(p + 1);
    }

    json out;
    out["model"] = {
        {"name", mname}, {"version", mver}, {"strategyName", config.strategy_name},
        {"status", "BACKTESTED"}, {"featureCount", (int)config.features.size()},
        {"symbols", config.symbols}, {"buyThreshold", config.buy_threshold},
        {"sellThreshold", config.sell_threshold}, {"engine", "hermes-cpp"},
        {"generatedAt", formatIso(Clock::now())},
    };
    out["performance"] = {
        {"symbol", primary},
        {"fromTs", bars.empty() ? "" : formatIso(bars.front().time)},
        {"toTs",   bars.empty() ? "" : formatIso(bars.back().time)},
        {"startingCapital", start_cap}, {"endingCapital", end_cap},
        {"totalTrades", n_trades}, {"winningTrades", wins}, {"losingTrades", losses},
        {"winRate", win_rate}, {"totalPnl", total_pnl}, {"totalPnlPct", total_pnl_pct},
        {"avgWin", avg_win}, {"avgLoss", avg_loss},
        {"largestWin", largest_win}, {"largestLoss", largest_loss},
        {"profitFactor", profit_factor}, {"maxDrawdown", max_dd},
        {"sharpeRatio", sharpe},
    };

    // Equity curve downsampled to <= ~600 points for the chart.
    json eq_arr = json::array();
    const size_t stride = equity.size() > 600 ? equity.size() / 600 : 1;
    for (size_t k = 0; k < equity.size(); k += stride)
        eq_arr.push_back({{"t", formatIso(equity[k].first)}, {"equity", equity[k].second}});
    if (!equity.empty() && (equity.size() - 1) % stride != 0)
        eq_arr.push_back({{"t", formatIso(equity.back().first)},
                          {"equity", equity.back().second}});
    out["equity"] = eq_arr;

    json tr_arr = json::array();
    for (const auto& t : trades) {
        tr_arr.push_back({
            {"entryTime", formatIso(t.entry_time)}, {"exitTime", formatIso(t.exit_time)},
            {"entryPrice", t.entry_price}, {"exitPrice", t.exit_price},
            {"qty", t.quantity}, {"pnl", t.pnl}, {"pnlPct", t.pnl_pct},
            {"reason", t.exit_reason},
        });
    }
    out["trades"] = tr_arr;

    std::ofstream fout(out_path);
    if (!fout) { std::cerr << "cannot write " << out_path << "\n"; return 1; }
    fout << out.dump(2) << "\n";

    std::cerr << "\n=== backtest complete ===\n"
              << "trades=" << n_trades << " winRate=" << win_rate
              << " totalPnl=" << total_pnl << " (" << total_pnl_pct << "%)"
              << " maxDD=" << max_dd << " sharpe=" << sharpe << "\n"
              << "wrote " << out_path << "\n";
    return 0;
}
