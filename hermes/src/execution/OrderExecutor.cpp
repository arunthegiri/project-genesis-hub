#include "execution/OrderExecutor.hpp"

#include <iostream>
#include <sstream>
#include <stdexcept>
#include <utility>

#include <httplib.h>
#include <nlohmann/json.hpp>

#include "alpaca/AlpacaJson.hpp"

namespace hermes {

using nlohmann::json;

namespace {

[[noreturn]] void fail(const std::string& msg) {
    throw std::runtime_error("OrderExecutor: " + msg);
}

std::string baseUrlFor(const std::string& mode) {
    if (mode == "live") return "https://api.alpaca.markets";
    if (mode == "paper") return "https://paper-api.alpaca.markets";
    fail("deploy_mode must be 'paper' or 'live' (got '" + mode + "')");
}

httplib::Headers authHeaders(const std::string& key, const std::string& secret) {
    return {
        {"APCA-API-KEY-ID", key},
        {"APCA-API-SECRET-KEY", secret},
    };
}

httplib::Client makeClient(const std::string& base_url) {
    httplib::Client cli(base_url);
    cli.set_connection_timeout(10);
    cli.set_read_timeout(15);
    cli.set_write_timeout(15);
    return cli;
}

// Build a one-line description of a failed httplib result for error messages.
std::string transportError(const std::string& method, const std::string& path,
                           const httplib::Result& res) {
    std::ostringstream os;
    os << method << ' ' << path << " failed: ";
    if (res) {
        os << "HTTP " << res->status << " — " << res->body;
    } else {
        os << httplib::to_string(res.error());
    }
    return os.str();
}

}  // namespace

OrderExecutor::OrderExecutor(std::string api_key, std::string api_secret,
                             std::string mode)
    : api_key_(std::move(api_key)),
      api_secret_(std::move(api_secret)),
      base_url_(baseUrlFor(mode)) {}

std::string OrderExecutor::submitMarketOrder(const std::string& symbol,
                                             const std::string& side,
                                             int                qty) {
    if (qty <= 0) {
        std::cerr << "[executor] refusing order: qty must be > 0 (got "
                  << qty << ")\n";
        return "";
    }
    if (side != "buy" && side != "sell") {
        std::cerr << "[executor] refusing order: side must be 'buy' or 'sell' "
                     "(got '" << side << "')\n";
        return "";
    }

    const json body = {
        {"symbol", symbol},
        {"qty", qty},
        {"side", side},
        {"type", "market"},
        {"time_in_force", "day"},
    };

    auto cli = makeClient(base_url_);
    auto res = cli.Post("/v2/orders", authHeaders(api_key_, api_secret_),
                        body.dump(), "application/json");

    if (!res || res->status / 100 != 2) {
        std::cerr << "[executor] " << transportError("POST", "/v2/orders", res)
                  << "\n";
        return "";
    }

    const json j = json::parse(res->body, nullptr, false);
    if (j.is_discarded()) {
        std::cerr << "[executor] order response was not valid JSON\n";
        return "";
    }
    return j.value("id", std::string());
}

std::vector<Position> OrderExecutor::getPositions() {
    auto cli = makeClient(base_url_);
    auto res = cli.Get("/v2/positions", authHeaders(api_key_, api_secret_));
    if (!res || res->status / 100 != 2) {
        fail(transportError("GET", "/v2/positions", res));
    }

    const json j = json::parse(res->body);
    std::vector<Position> positions;
    if (j.is_array()) {
        positions.reserve(j.size());
        for (const json& p : j) {
            positions.push_back(alpaca::parsePosition(p));
        }
    }
    return positions;
}

std::optional<Position> OrderExecutor::getPosition(const std::string& symbol) {
    auto cli = makeClient(base_url_);
    auto res = cli.Get("/v2/positions/" + symbol,
                       authHeaders(api_key_, api_secret_));

    // Alpaca returns 404 when there is no open position for the symbol.
    if (res && res->status == 404) {
        return std::nullopt;
    }
    if (!res || res->status / 100 != 2) {
        fail(transportError("GET", "/v2/positions/" + symbol, res));
    }
    return alpaca::parsePosition(json::parse(res->body));
}

Account OrderExecutor::getAccount() {
    auto cli = makeClient(base_url_);
    auto res = cli.Get("/v2/account", authHeaders(api_key_, api_secret_));
    if (!res || res->status / 100 != 2) {
        fail(transportError("GET", "/v2/account", res));
    }
    return alpaca::parseAccount(json::parse(res->body));
}

void OrderExecutor::cancelAllOrders() {
    auto cli = makeClient(base_url_);
    auto res = cli.Delete("/v2/orders", authHeaders(api_key_, api_secret_));
    // 207 Multi-Status is the documented success code; accept any 2xx.
    if (!res || res->status / 100 != 2) {
        fail(transportError("DELETE", "/v2/orders", res));
    }
}

}  // namespace hermes
