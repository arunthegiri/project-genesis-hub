#pragma once

#include <chrono>
#include <memory>
#include <string>

namespace hermes {

// A round-trip trade ready to be persisted. Times are UTC time_points;
// TradeLogger formats them as TIMESTAMPTZ on the way into the database.
struct CompletedTrade {
    std::string strategy_name;
    std::string symbol;
    std::string direction;      // "long" or "short"
    std::chrono::system_clock::time_point entry_time;
    double      entry_price = 0.0;
    std::chrono::system_clock::time_point exit_time;
    double      exit_price  = 0.0;
    int         quantity    = 0;
    double      pnl         = 0.0;
    double      pnl_pct     = 0.0;
    bool        win         = false;
    std::string exit_reason;    // "take_profit" | "stop_loss" | "signal" | "eod"
};

// Persists trades, signals and engine events to TimescaleDB via libpqxx.
//
// The constructor connects and ensures the schema exists (throws if the
// database is unreachable — a startup failure the engine should surface). The
// log* methods never throw: a transient write error is logged to stderr so a
// database hiccup cannot take down live trading. libpqxx is fully hidden
// behind a PIMPL so including this header costs nothing extra and the rest of
// the engine builds on machines without libpqxx.
class TradeLogger {
public:
    explicit TradeLogger(const std::string& connection_string);
    ~TradeLogger();

    TradeLogger(const TradeLogger&)            = delete;
    TradeLogger& operator=(const TradeLogger&) = delete;

    void logTrade(const CompletedTrade& trade);

    void logSignal(const std::string& strategy,
                   const std::string& symbol,
                   const std::string& signal,
                   float              confidence,
                   std::chrono::system_clock::time_point time);

    void logEvent(const std::string& event, const std::string& details);

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};

}  // namespace hermes
