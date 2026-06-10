#pragma once

#include <atomic>
#include <chrono>
#include <map>
#include <mutex>
#include <string>

#include <nlohmann/json.hpp>

#include "config/EngineConfig.hpp"
#include "engine/FeatureCalculator.hpp"
#include "execution/OrderExecutor.hpp"
#include "feed/MarketDataFeed.hpp"
#include "inference/ONNXModel.hpp"
#include "logging/TradeLogger.hpp"

namespace hermes {

// A live long position tracked by the engine (V1 is long-only).
struct OpenPosition {
    std::string symbol;
    std::string direction;          // always "long" in V1
    double      entry_price       = 0.0;
    int         quantity          = 0;
    double      stop_loss_price   = 0.0;
    double      take_profit_price = 0.0;
    std::chrono::system_clock::time_point entry_time;
    std::string order_id;
};

// Wires every component together: bars from the MarketDataFeed flow through
// the per-symbol FeatureCalculator into the ONNXModel; approved signals are
// routed to the OrderExecutor and every signal/trade/event is persisted via
// the TradeLogger.
//
// All session/time logic is driven by bar timestamps (not the wall clock), so
// the same code path serves live trading and offline replay. When the config
// carries no Alpaca credentials the engine runs in simulated-fill mode: orders
// are filled locally at bar prices instead of being routed to Alpaca, which is
// what the offline engine test exercises.
class HermesEngine {
public:
    explicit HermesEngine(const EngineConfig& config);

    // Blocking — starts the feed and runs until stop() is called.
    void start();
    void stop();

    // Snapshot for the HTTP status server (Part 9). Thread-safe.
    nlohmann::json getStatus() const;

    // Feed entry point. Public so the feed callback, offline tests, and a
    // future replay harness can all drive the engine the same way.
    void onBar(const std::string& symbol, const Bar& bar);

private:
    // Main decision flow for one bar (caller holds mutex_).
    void processBar(const std::string& symbol, const Bar& bar);

    // V1 Themis: min_confidence, daily loss limit, max drawdown, trading
    // hours, max trades/day, suppress_regime. Logs the reason for every
    // rejection. Returns true when the trade may proceed.
    bool themisApprove(const std::string& symbol, const Prediction& pred,
                       const Bar& bar, const std::vector<float>& features);

    // Position management (caller holds mutex_).
    void enterLong(const std::string& symbol, const Bar& bar,
                   const Prediction& pred);
    void exitPosition(const std::string& symbol, const Bar& bar,
                      double exit_price, const std::string& reason);

    // Stop-loss / take-profit checks against the current bar's range.
    void checkExits(const std::string& symbol, const Bar& bar);

    // Reset per-day counters when the bar's ET calendar day changes.
    void rollDailyStats(const Bar& bar);

    // True while entries are allowed: inside the NYSE session minus the
    // configured no-trade windows at the open and close.
    bool isEntryWindow(const Bar& bar) const;

    // True once the bar is inside the no-trade close window — positions are
    // flattened ("eod") from there on.
    bool isEndOfDay(const Bar& bar) const;

    EngineConfig                             config_;
    ONNXModel                                model_;
    std::map<std::string, FeatureCalculator> calculators_;  // one per symbol
    MarketDataFeed                           feed_;
    OrderExecutor                            executor_;
    TradeLogger                              logger_;

    // State (guarded by mutex_)
    mutable std::mutex                  mutex_;
    std::map<std::string, OpenPosition> positions_;
    std::map<std::string, double>       last_price_;     // last close per symbol
    double                              current_capital_;
    double                              peak_capital_;
    double                              day_start_capital_;
    double                              daily_pnl_   = 0.0;
    int                                 trades_today_ = 0;
    int                                 current_day_key_ = 0;  // ET yyyymmdd

    bool              simulate_fills_;  // no Alpaca creds -> fill locally
    std::atomic<bool> running_{false};
    std::chrono::steady_clock::time_point start_time_;
};

}  // namespace hermes
