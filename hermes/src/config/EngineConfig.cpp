#include "config/EngineConfig.hpp"

#include <fstream>
#include <iostream>
#include <sstream>
#include <stdexcept>

namespace hermes {

using nlohmann::json;

namespace {

// Throw a uniformly-formatted config error.
[[noreturn]] void fail(const std::string& msg) {
    throw std::runtime_error("EngineConfig: " + msg);
}

// Fetch a required key, failing with a clear message if absent.
const json& require(const json& j, const char* key) {
    auto it = j.find(key);
    if (it == j.end()) {
        fail(std::string("missing required field '") + key + "'");
    }
    return *it;
}

}  // namespace

EngineConfig EngineConfig::fromFile(const std::string& path) {
    std::ifstream in(path);
    if (!in) {
        fail("could not open config file '" + path + "'");
    }

    json j;
    try {
        in >> j;
    } catch (const json::parse_error& e) {
        fail("invalid JSON in '" + path + "': " + e.what());
    }
    return fromJson(j);
}

EngineConfig EngineConfig::fromJson(const json& j) {
    if (!j.is_object()) {
        fail("top-level config must be a JSON object");
    }

    EngineConfig c;

    // Strategy identity
    c.strategy_name = require(j, "strategy_name").get<std::string>();
    c.model_file    = require(j, "model_file").get<std::string>();

    // Feature contract
    c.features        = require(j, "features").get<std::vector<std::string>>();
    c.input_shape     = require(j, "input_shape").get<std::vector<int>>();
    c.output_type     = j.value("output_type", std::string("probabilities"));
    c.output_classes  = require(j, "output_classes").get<std::vector<std::string>>();
    c.buy_threshold   = require(j, "buy_threshold").get<double>();
    c.sell_threshold  = require(j, "sell_threshold").get<double>();

    // Trade parameters
    c.stop_loss         = require(j, "stop_loss").get<double>();
    c.take_profit       = require(j, "take_profit").get<double>();
    c.starting_capital  = j.value("starting_capital", 100000.0);

    // Deployment
    c.deploy_mode = require(j, "deploy_mode").get<std::string>();
    c.symbols     = require(j, "symbols").get<std::vector<std::string>>();

    // Risk management (optional block — defaults applied per-field)
    if (auto it = j.find("themis"); it != j.end()) {
        const json& t = *it;
        ThemisConfig& th = c.themis;
        th.max_position_pct   = t.value("max_position_pct",   th.max_position_pct);
        th.daily_loss_limit   = t.value("daily_loss_limit",   th.daily_loss_limit);
        th.max_drawdown       = t.value("max_drawdown",       th.max_drawdown);
        th.min_confidence     = t.value("min_confidence",     th.min_confidence);
        th.suppress_regime    = t.value("suppress_regime",    th.suppress_regime);
        th.no_trade_open_min  = t.value("no_trade_open_min",  th.no_trade_open_min);
        th.no_trade_close_min = t.value("no_trade_close_min", th.no_trade_close_min);
        th.max_trades_per_day = t.value("max_trades_per_day", th.max_trades_per_day);
    }

    // Infrastructure. alpaca_key / alpaca_secret are read from the file only
    // as a fallback; main() overrides them from the environment.
    c.alpaca_key           = j.value("alpaca_key", std::string());
    c.alpaca_secret        = j.value("alpaca_secret", std::string());
    c.db_connection_string = j.value("db_connection_string", std::string());
    c.http_port            = j.value("http_port", 9090);

    return c;
}

void EngineConfig::validate() const {
    if (strategy_name.empty()) fail("strategy_name must not be empty");
    if (model_file.empty())    fail("model_file must not be empty");

    if (features.empty())       fail("features must not be empty");
    if (output_classes.empty()) fail("output_classes must not be empty");
    if (symbols.empty())        fail("symbols must not be empty");

    // input_shape should describe a single-sample batch matching the feature
    // count, e.g. [1, N] where N == features.size().
    if (input_shape.size() != 2) {
        fail("input_shape must have exactly 2 dimensions, e.g. [1, N]");
    }
    if (input_shape[1] != static_cast<int>(features.size())) {
        std::ostringstream os;
        os << "input_shape[1] (" << input_shape[1]
           << ") must equal the number of features (" << features.size() << ")";
        fail(os.str());
    }

    if (output_type != "probabilities") {
        fail("output_type must be 'probabilities' (got '" + output_type + "')");
    }

    if (deploy_mode != "paper" && deploy_mode != "live") {
        fail("deploy_mode must be 'paper' or 'live' (got '" + deploy_mode + "')");
    }

    auto check_prob = [](double v, const char* name) {
        if (v <= 0.0 || v > 1.0) {
            fail(std::string(name) + " must be in (0, 1]");
        }
    };
    check_prob(buy_threshold, "buy_threshold");
    check_prob(sell_threshold, "sell_threshold");
    check_prob(themis.min_confidence, "themis.min_confidence");

    if (stop_loss <= 0.0)   fail("stop_loss must be > 0");
    if (take_profit <= 0.0) fail("take_profit must be > 0");
    if (starting_capital <= 0.0) fail("starting_capital must be > 0");

    if (themis.max_position_pct <= 0.0 || themis.max_position_pct > 1.0) {
        fail("themis.max_position_pct must be in (0, 1]");
    }
    if (http_port <= 0 || http_port > 65535) {
        fail("http_port must be in (0, 65535]");
    }
}

void EngineConfig::print() const {
    auto join = [](const std::vector<std::string>& v) {
        std::ostringstream os;
        for (size_t i = 0; i < v.size(); ++i) {
            if (i) os << ", ";
            os << v[i];
        }
        return os.str();
    };

    std::cout << "============================================\n"
              << "  Hermes Engine v0.1.0\n"
              << "============================================\n"
              << "  Strategy:        " << strategy_name << "\n"
              << "  Model file:      " << model_file << "\n"
              << "  Symbols:         " << join(symbols) << "\n"
              << "  Mode:            " << deploy_mode << "\n"
              << "--------------------------------------------\n"
              << "  Features (" << features.size() << "):     " << join(features) << "\n"
              << "  Input shape:     [";
    for (size_t i = 0; i < input_shape.size(); ++i) {
        if (i) std::cout << ", ";
        std::cout << input_shape[i];
    }
    std::cout << "]\n"
              << "  Output classes:  " << join(output_classes) << "\n"
              << "  Buy threshold:   " << buy_threshold << "\n"
              << "  Sell threshold:  " << sell_threshold << "\n"
              << "--------------------------------------------\n"
              << "  Stop loss:       " << stop_loss << "\n"
              << "  Take profit:     " << take_profit << "\n"
              << "  Starting cap:    " << starting_capital << "\n"
              << "--------------------------------------------\n"
              << "  Themis:\n"
              << "    max_position_pct:   " << themis.max_position_pct << "\n"
              << "    daily_loss_limit:   " << themis.daily_loss_limit << "\n"
              << "    max_drawdown:       " << themis.max_drawdown << "\n"
              << "    min_confidence:     " << themis.min_confidence << "\n"
              << "    suppress_regime:    " << themis.suppress_regime << "\n"
              << "    no_trade_open_min:  " << themis.no_trade_open_min << "\n"
              << "    no_trade_close_min: " << themis.no_trade_close_min << "\n"
              << "    max_trades_per_day: " << themis.max_trades_per_day << "\n"
              << "--------------------------------------------\n"
              << "  HTTP port:       " << http_port << "\n"
              << "  DB connection:   "
              << (db_connection_string.empty() ? "(none)" : db_connection_string) << "\n"
              << "  Alpaca key:      "
              << (alpaca_key.empty() ? "(not set — read from env)" : "(set)") << "\n"
              << "============================================\n";
}

}  // namespace hermes
