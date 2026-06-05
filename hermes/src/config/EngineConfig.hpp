#pragma once

#include <string>
#include <vector>

#include <nlohmann/json.hpp>

namespace hermes {

// Risk-management parameters consumed by the (V2) Themis risk manager.
// In V1 only min_confidence / daily_loss_limit / max_drawdown / trading-hour
// guards are enforced (see HermesEngine::themisApprove, Part 8).
struct ThemisConfig {
    double max_position_pct   = 0.20;   // max 20% of capital per position
    double daily_loss_limit   = 0.02;   // stop trading if down 2% on the day
    double max_drawdown       = 0.10;   // stop trading if down 10% from peak
    double min_confidence     = 0.55;   // minimum model confidence to trade
    int    suppress_regime    = -1;     // regime to suppress (-1 = none)
    int    no_trade_open_min  = 15;     // no trades in first 15 min of session
    int    no_trade_close_min = 15;     // no trades in last 15 min of session
    int    max_trades_per_day = 50;     // max trades per day
};

// Deploy contract written by Kairos on k.deploy(). Loaded and validated at
// engine startup. API secrets are intentionally NOT stored here: they are
// read from the ALPACA_API_KEY / ALPACA_API_SECRET environment variables.
struct EngineConfig {
    // Strategy identity
    std::string strategy_name;
    std::string model_file;         // path to .onnx file

    // Feature contract
    std::vector<std::string> features;        // ordered — must match training
    std::vector<int>         input_shape;
    std::string              output_type;     // "probabilities"
    std::vector<std::string> output_classes;  // ["SHORT", "NEUTRAL", "LONG"]
    double                   buy_threshold  = 0.0;
    double                   sell_threshold = 0.0;

    // Trade parameters
    double stop_loss         = 0.0;     // e.g. 0.0015 = 0.15%
    double take_profit       = 0.0;     // e.g. 0.0025 = 0.25%
    double starting_capital  = 100000.0;

    // Deployment
    std::string              deploy_mode;     // "paper" or "live"
    std::vector<std::string> symbols;

    // Risk management
    ThemisConfig themis;

    // Infrastructure
    std::string alpaca_key;             // injected from env, not the file
    std::string alpaca_secret;          // injected from env, not the file
    std::string db_connection_string;
    int         http_port = 9090;

    // Factory methods
    static EngineConfig fromFile(const std::string& path);
    static EngineConfig fromJson(const nlohmann::json& j);

    // Validation — throws std::runtime_error if required fields are missing
    // or contain invalid values.
    void validate() const;

    // Print a human-readable summary to stdout.
    void print() const;
};

}  // namespace hermes
