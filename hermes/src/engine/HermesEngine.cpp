#include "engine/HermesEngine.hpp"

#include <algorithm>
#include <cmath>
#include <ctime>
#include <iostream>
#include <sstream>
#include <thread>

namespace hermes {

using nlohmann::json;
using std::chrono::system_clock;
using namespace std::chrono_literals;

namespace {

// ---- US Eastern Time helpers -----------------------------------------------
// NYSE session logic needs ET civil time. libc++ on macOS 13 has no C++20 tz
// database, so DST is computed from the US rule directly: DST runs from 2:00
// EST on the second Sunday of March (07:00 UTC) to 2:00 EDT on the first
// Sunday of November (06:00 UTC).

std::time_t utcMidnight(int year, int mon, int mday) {
    std::tm tm{};
    tm.tm_year = year - 1900;
    tm.tm_mon  = mon - 1;
    tm.tm_mday = mday;
    return timegm(&tm);
}

int nthSundayOfMonth(int year, int mon, int n) {
    const std::time_t t = utcMidnight(year, mon, 1);
    std::tm tm{};
    gmtime_r(&t, &tm);
    const int first_sunday = 1 + ((7 - tm.tm_wday) % 7);
    return first_sunday + 7 * (n - 1);
}

int etOffsetHours(std::time_t t) {
    std::tm tm{};
    gmtime_r(&t, &tm);
    const int year = tm.tm_year + 1900;
    const std::time_t dst_start =
        utcMidnight(year, 3, nthSundayOfMonth(year, 3, 2)) + 7 * 3600;
    const std::time_t dst_end =
        utcMidnight(year, 11, nthSundayOfMonth(year, 11, 1)) + 6 * 3600;
    return (t >= dst_start && t < dst_end) ? -4 : -5;
}

std::tm etCivilTime(system_clock::time_point tp) {
    const std::time_t t       = system_clock::to_time_t(tp);
    const std::time_t shifted = t + etOffsetHours(t) * 3600;
    std::tm tm{};
    gmtime_r(&shifted, &tm);
    return tm;
}

int etMinutesSinceMidnight(system_clock::time_point tp) {
    const std::tm tm = etCivilTime(tp);
    return tm.tm_hour * 60 + tm.tm_min;
}

int etDayKey(system_clock::time_point tp) {
    const std::tm tm = etCivilTime(tp);
    return (tm.tm_year + 1900) * 10000 + (tm.tm_mon + 1) * 100 + tm.tm_mday;
}

constexpr int kSessionOpenMin  = 9 * 60 + 30;  // 09:30 ET
constexpr int kSessionCloseMin = 16 * 60;      // 16:00 ET

}  // namespace

HermesEngine::HermesEngine(const EngineConfig& config)
    : config_(config),
      model_(config.model_file, config),
      feed_(config.alpaca_key, config.alpaca_secret, config.deploy_mode),
      executor_(config.alpaca_key, config.alpaca_secret, config.deploy_mode),
      logger_(config.db_connection_string),
      current_capital_(config.starting_capital),
      peak_capital_(config.starting_capital),
      day_start_capital_(config.starting_capital),
      simulate_fills_(config.alpaca_key.empty() || config.alpaca_secret.empty()),
      start_time_(std::chrono::steady_clock::now()) {
    for (const std::string& symbol : config_.symbols) {
        calculators_.emplace(symbol, FeatureCalculator(config_.features));
        feed_.onBar(symbol,
                    [this, symbol](const Bar& bar) { onBar(symbol, bar); });
    }
    if (simulate_fills_) {
        std::cout << "[engine] no Alpaca credentials — running with SIMULATED "
                     "fills (orders are not routed)\n";
    }
}

void HermesEngine::start() {
    if (running_.exchange(true)) return;
    logger_.logEvent("engine_start", "strategy=" + config_.strategy_name +
                                         " mode=" + config_.deploy_mode);
    feed_.start();
    std::cout << "[engine] started — waiting for bars\n";
    while (running_.load()) {
        std::this_thread::sleep_for(250ms);
    }
    feed_.stop();
    logger_.logEvent("engine_stop", "strategy=" + config_.strategy_name);
    std::cout << "[engine] stopped\n";
}

void HermesEngine::stop() { running_ = false; }

void HermesEngine::onBar(const std::string& symbol, const Bar& bar) {
    std::lock_guard<std::mutex> lk(mutex_);
    auto it = calculators_.find(symbol);
    if (it == calculators_.end()) return;  // not a subscribed symbol

    last_price_[symbol] = bar.close;
    rollDailyStats(bar);
    processBar(symbol, bar);
}

void HermesEngine::processBar(const std::string& symbol, const Bar& bar) {
    FeatureCalculator& calc = calculators_.at(symbol);
    calc.update(bar);

    std::cout << "[" << symbol << "] Bar: close=" << bar.close
              << " volume=" << bar.volume << "\n";

    // Flatten everything once the close window starts.
    if (isEndOfDay(bar)) {
        if (positions_.count(symbol)) {
            exitPosition(symbol, bar, bar.close, "eod");
        }
        return;
    }

    // Stop-loss / take-profit always run before any entry decision.
    checkExits(symbol, bar);

    if (positions_.count(symbol)) return;  // already in a trade — no re-entry

    if (!calc.isReady()) return;

    const std::vector<float> features = calc.calculate();
    const Prediction pred             = model_.predict(features);

    std::cout << "[" << symbol << "] Signal: " << signalName(pred.signal)
              << " confidence=" << pred.confidence << "\n";
    logger_.logSignal(config_.strategy_name, symbol, signalName(pred.signal),
                      pred.confidence, bar.time);

    if (pred.signal == Signal::HOLD) return;
    if (pred.signal == Signal::SELL) return;  // V1 is long-only

    if (!themisApprove(symbol, pred, bar, features)) return;

    enterLong(symbol, bar, pred);
}

bool HermesEngine::themisApprove(const std::string& symbol,
                                 const Prediction& pred, const Bar& bar,
                                 const std::vector<float>& features) {
    const ThemisConfig& th = config_.themis;
    auto reject = [&](const std::string& why) {
        std::cout << "[" << symbol << "] Themis: REJECTED — " << why << "\n";
        return false;
    };

    if (pred.confidence < th.min_confidence) {
        std::ostringstream os;
        os << "confidence " << pred.confidence << " < min_confidence "
           << th.min_confidence;
        return reject(os.str());
    }

    if (daily_pnl_ <= -(th.daily_loss_limit * day_start_capital_)) {
        return reject("daily loss limit reached (daily_pnl=" +
                      std::to_string(daily_pnl_) + ")");
    }

    if (current_capital_ <= peak_capital_ * (1.0 - th.max_drawdown)) {
        return reject("max drawdown reached (capital=" +
                      std::to_string(current_capital_) +
                      " peak=" + std::to_string(peak_capital_) + ")");
    }

    if (!isEntryWindow(bar)) {
        return reject("outside trading hours / no-trade window");
    }

    if (trades_today_ >= th.max_trades_per_day) {
        return reject("max trades per day reached (" +
                      std::to_string(trades_today_) + ")");
    }

    if (th.suppress_regime >= 0) {
        for (size_t i = 0; i < config_.features.size(); ++i) {
            if (config_.features[i].rfind("hmm_regime", 0) == 0 &&
                static_cast<int>(features[i]) == th.suppress_regime) {
                return reject("suppressed regime " +
                              std::to_string(th.suppress_regime));
            }
        }
    }

    std::cout << "[" << symbol << "] Themis: APPROVED\n";
    return true;
}

void HermesEngine::enterLong(const std::string& symbol, const Bar& bar,
                             const Prediction& pred) {
    const int qty = static_cast<int>(
        (current_capital_ * config_.themis.max_position_pct) / bar.close);
    if (qty <= 0) {
        std::cout << "[" << symbol << "] entry skipped: position size is 0\n";
        return;
    }

    std::string order_id;
    if (simulate_fills_) {
        order_id = "sim-" + std::to_string(trades_today_ + 1);
    } else {
        order_id = executor_.submitMarketOrder(symbol, "buy", qty);
        if (order_id.empty()) {
            std::cerr << "[" << symbol << "] entry FAILED: order rejected\n";
            logger_.logEvent("order_failed", "buy " + symbol);
            return;
        }
    }

    OpenPosition pos;
    pos.symbol            = symbol;
    pos.direction         = "long";
    pos.entry_price       = bar.close;
    pos.quantity          = qty;
    pos.stop_loss_price   = bar.close * (1.0 - config_.stop_loss);
    pos.take_profit_price = bar.close * (1.0 + config_.take_profit);
    pos.entry_time        = bar.time;
    pos.order_id          = order_id;
    positions_[symbol]    = pos;
    ++trades_today_;

    std::cout << "[" << symbol << "] Entering long: " << qty << " shares at "
              << bar.close << " (confidence=" << pred.confidence
              << ", order_id=" << order_id << ")\n";
}

void HermesEngine::exitPosition(const std::string& symbol, const Bar& bar,
                                double exit_price, const std::string& reason) {
    auto it = positions_.find(symbol);
    if (it == positions_.end()) return;
    const OpenPosition pos = it->second;

    if (!simulate_fills_) {
        const std::string order_id =
            executor_.submitMarketOrder(symbol, "sell", pos.quantity);
        if (order_id.empty()) {
            // Keep the position open and retry on the next bar rather than
            // silently dropping tracking of a live position.
            std::cerr << "[" << symbol
                      << "] exit FAILED: sell order rejected — retrying\n";
            logger_.logEvent("order_failed", "sell " + symbol);
            return;
        }
    }
    positions_.erase(it);

    const double pnl     = (exit_price - pos.entry_price) * pos.quantity;
    const double pnl_pct = (exit_price / pos.entry_price - 1.0) * 100.0;

    current_capital_ += pnl;
    peak_capital_ = std::max(peak_capital_, current_capital_);
    daily_pnl_ += pnl;

    CompletedTrade trade;
    trade.strategy_name = config_.strategy_name;
    trade.symbol        = symbol;
    trade.direction     = pos.direction;
    trade.entry_time    = pos.entry_time;
    trade.entry_price   = pos.entry_price;
    trade.exit_time     = bar.time;
    trade.exit_price    = exit_price;
    trade.quantity      = pos.quantity;
    trade.pnl           = pnl;
    trade.pnl_pct       = pnl_pct;
    trade.win           = pnl > 0.0;
    trade.exit_reason   = reason;
    logger_.logTrade(trade);

    std::cout << "[" << symbol << "] Exited long: " << pos.quantity
              << " shares at " << exit_price << " (" << reason
              << ", pnl=" << pnl << ")\n";
}

void HermesEngine::checkExits(const std::string& symbol, const Bar& bar) {
    auto it = positions_.find(symbol);
    if (it == positions_.end()) return;
    const OpenPosition& pos = it->second;

    // Conservative ordering: if both levels are inside the bar's range, the
    // stop is assumed to have been hit first.
    if (bar.low <= pos.stop_loss_price) {
        exitPosition(symbol, bar, pos.stop_loss_price, "stop_loss");
    } else if (bar.high >= pos.take_profit_price) {
        exitPosition(symbol, bar, pos.take_profit_price, "take_profit");
    }
}

void HermesEngine::rollDailyStats(const Bar& bar) {
    const int day = etDayKey(bar.time);
    if (day == current_day_key_) return;
    current_day_key_   = day;
    trades_today_      = 0;
    daily_pnl_         = 0.0;
    day_start_capital_ = current_capital_;
}

bool HermesEngine::isEntryWindow(const Bar& bar) const {
    const int minutes = etMinutesSinceMidnight(bar.time);
    return minutes >= kSessionOpenMin + config_.themis.no_trade_open_min &&
           minutes < kSessionCloseMin - config_.themis.no_trade_close_min;
}

bool HermesEngine::isEndOfDay(const Bar& bar) const {
    const int minutes = etMinutesSinceMidnight(bar.time);
    return minutes >= kSessionCloseMin - config_.themis.no_trade_close_min;
}

json HermesEngine::getStatus() const {
    std::lock_guard<std::mutex> lk(mutex_);

    json open_positions = json::array();
    for (const auto& [symbol, pos] : positions_) {
        const auto last = last_price_.find(symbol);
        const double price =
            last != last_price_.end() ? last->second : pos.entry_price;
        open_positions.push_back({
            {"symbol", pos.symbol},
            {"direction", pos.direction},
            {"entry_price", pos.entry_price},
            {"quantity", pos.quantity},
            {"unrealized_pnl", (price - pos.entry_price) * pos.quantity},
        });
    }

    const auto uptime = std::chrono::duration_cast<std::chrono::seconds>(
                            std::chrono::steady_clock::now() - start_time_)
                            .count();

    return {
        {"status", running_.load() ? "running" : "stopped"},
        {"strategy", config_.strategy_name},
        {"symbols", config_.symbols},
        {"mode", config_.deploy_mode},
        {"simulated_fills", simulate_fills_},
        {"uptime_seconds", uptime},
        {"trades_today", trades_today_},
        {"daily_pnl", daily_pnl_},
        {"current_capital", current_capital_},
        {"open_positions", open_positions},
    };
}

}  // namespace hermes
