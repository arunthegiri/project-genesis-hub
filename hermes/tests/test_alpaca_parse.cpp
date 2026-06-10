// Offline unit tests for the Alpaca JSON parsing layer (Parts 5 & 6).
// No networking: feeds canned Alpaca v2 payloads through the pure parse
// functions and checks the resulting structs. Returns non-zero on any failure.

#include <chrono>
#include <cmath>
#include <cstdio>
#include <string>

#include <nlohmann/json.hpp>

#include "alpaca/AlpacaJson.hpp"

namespace {

int g_failures = 0;

void check(bool cond, const char* what) {
    std::printf("  %-52s %s\n", what, cond ? "OK" : "FAILED");
    if (!cond) ++g_failures;
}

bool close(double a, double b, double eps = 1e-9) {
    return std::fabs(a - b) <= eps;
}

// Seconds since epoch (UTC) for a parsed timestamp, for easy comparison.
long epoch(std::chrono::system_clock::time_point tp) {
    return std::chrono::duration_cast<std::chrono::seconds>(
               tp.time_since_epoch())
        .count();
}

}  // namespace

int main() {
    using namespace hermes;

    std::printf("=== parseBars (stream bar message) ===\n");
    {
        // A realistic Alpaca v2 frame: a control success followed by a bar.
        const std::string msg = R"([
            {"T":"success","msg":"authenticated"},
            {"T":"b","S":"NVDA","o":125.0,"h":125.8,"l":124.7,"c":125.4,
             "v":45321,"vw":125.25,"t":"2021-02-22T19:15:00Z","n":312}
        ])";
        auto bars = alpaca::parseBars(msg);
        check(bars.size() == 1, "exactly one bar extracted");
        if (bars.size() == 1) {
            const Bar& b = bars[0];
            check(b.symbol == "NVDA", "symbol == NVDA");
            check(close(b.open, 125.0), "open == 125.0");
            check(close(b.high, 125.8), "high == 125.8");
            check(close(b.low, 124.7), "low == 124.7");
            check(close(b.close, 125.4), "close == 125.4");
            check(close(b.volume, 45321), "volume == 45321");
            check(close(b.vwap, 125.25), "vwap == 125.25");
            // 2021-02-22T19:15:00Z == 1614021300 epoch seconds.
            check(epoch(b.time) == 1614021300L, "timestamp parsed as UTC");
        }
    }

    std::printf("=== parseBars (multiple bars, mixed types) ===\n");
    {
        const std::string msg = R"([
            {"T":"b","S":"AAPL","o":1,"h":2,"l":0.5,"c":1.5,"v":10,"t":"2024-01-02T14:30:00Z"},
            {"T":"q","S":"AAPL","bp":1.4,"ap":1.6,"t":"2024-01-02T14:30:00Z"},
            {"T":"b","S":"MSFT","o":3,"h":4,"l":2.5,"c":3.5,"v":20,"t":"2024-01-02T14:31:00.5Z"}
        ])";
        auto bars = alpaca::parseBars(msg);
        check(bars.size() == 2, "two bars, quote skipped");
        if (bars.size() == 2) {
            check(bars[0].symbol == "AAPL" && bars[1].symbol == "MSFT",
                  "order preserved (AAPL, MSFT)");
            check(close(bars[0].vwap, 0.0), "missing vwap defaults to 0");
        }
    }

    std::printf("=== parseBars (malformed input) ===\n");
    {
        check(alpaca::parseBars("not json").empty(), "garbage -> empty");
        check(alpaca::parseBars("[]").empty(), "empty array -> empty");
    }

    std::printf("=== parseAccount ===\n");
    {
        const auto j = nlohmann::json::parse(R"({
            "equity":"100084.50","cash":"99000.00",
            "buying_power":"198169.00","portfolio_value":"100084.50"
        })");
        Account a = alpaca::parseAccount(j);
        check(close(a.equity, 100084.50), "equity from string");
        check(close(a.cash, 99000.0), "cash from string");
        check(close(a.buying_power, 198169.0), "buying_power from string");
        check(close(a.portfolio_value, 100084.50), "portfolio_value from string");
    }

    std::printf("=== parsePosition (long) ===\n");
    {
        const auto j = nlohmann::json::parse(R"({
            "symbol":"NVDA","qty":"10","avg_entry_price":"125.40",
            "current_price":"126.82","unrealized_pl":"14.20","side":"long"
        })");
        Position p = alpaca::parsePosition(j);
        check(p.symbol == "NVDA", "symbol == NVDA");
        check(p.qty == 10, "qty == 10");
        check(close(p.avg_entry_price, 125.40), "avg_entry_price");
        check(close(p.current_price, 126.82), "current_price");
        check(close(p.unrealized_pnl, 14.20), "unrealized_pl -> unrealized_pnl");
        check(p.side == "long", "side == long");
    }

    std::printf("=== parsePosition (short, signed qty) ===\n");
    {
        const auto j = nlohmann::json::parse(R"({
            "symbol":"TSLA","qty":"-5","avg_entry_price":"240.0",
            "current_price":"238.0","unrealized_pl":"10.0","side":"short"
        })");
        Position p = alpaca::parsePosition(j);
        check(p.qty == -5, "qty == -5 (short)");
        check(p.side == "short", "side == short");
    }

    std::printf("\n");
    if (g_failures == 0) {
        std::printf("PASSED: all Alpaca parse checks\n");
        return 0;
    }
    std::printf("FAILED: %d check(s)\n", g_failures);
    return 1;
}
