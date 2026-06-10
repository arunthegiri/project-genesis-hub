#pragma once

#include <optional>
#include <string>
#include <vector>

namespace hermes {

// A single open position as reported by Alpaca. Quantity is signed: positive
// for long, negative for short (mirrors Alpaca's signed `qty`).
struct Position {
    std::string symbol;
    int         qty             = 0;
    double      avg_entry_price = 0.0;
    double      current_price   = 0.0;
    double      unrealized_pnl  = 0.0;
    std::string side;            // "long" or "short"
};

// Account snapshot from Alpaca.
struct Account {
    double equity          = 0.0;
    double cash            = 0.0;
    double buying_power    = 0.0;
    double portfolio_value = 0.0;
};

// Submits orders and queries account / position state via the Alpaca REST API
// (cpp-httplib over TLS). Read-only queries throw std::runtime_error on a
// transport or HTTP error; submitMarketOrder returns an empty string on
// failure so the engine can keep running. API secrets are passed in by the
// caller (sourced from the environment, never the config file).
class OrderExecutor {
public:
    // mode: "paper" -> https://paper-api.alpaca.markets
    //       "live"  -> https://api.alpaca.markets
    OrderExecutor(std::string api_key, std::string api_secret, std::string mode);

    // Submit a market order. side is "buy" or "sell". Returns the Alpaca
    // order id, or an empty string on failure (failure is logged to stderr).
    std::string submitMarketOrder(const std::string& symbol,
                                  const std::string& side,
                                  int                qty);

    // All open positions.
    std::vector<Position> getPositions();

    // Position for one symbol; std::nullopt if there is no open position.
    std::optional<Position> getPosition(const std::string& symbol);

    // Account snapshot.
    Account getAccount();

    // Cancel every open order.
    void cancelAllOrders();

    const std::string& baseUrl() const { return base_url_; }

private:
    std::string api_key_;
    std::string api_secret_;
    std::string base_url_;
};

}  // namespace hermes
