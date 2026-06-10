#include "alpaca/AlpacaJson.hpp"

#include <cstdio>
#include <ctime>
#include <stdexcept>
#include <string>

namespace hermes::alpaca {

using nlohmann::json;

namespace {

[[noreturn]] void fail(const std::string& msg) {
    throw std::runtime_error("AlpacaJson: " + msg);
}

// Read a numeric field that Alpaca encodes as a JSON string (e.g. "125.40"),
// tolerating a genuine JSON number too. Returns 0.0 when absent or null.
double num(const json& j, const char* key) {
    auto it = j.find(key);
    if (it == j.end() || it->is_null()) {
        return 0.0;
    }
    if (it->is_string()) {
        try {
            return std::stod(it->get<std::string>());
        } catch (const std::exception&) {
            fail(std::string("field '") + key + "' is not a number");
        }
    }
    return it->get<double>();
}

}  // namespace

std::chrono::system_clock::time_point parseTimestamp(const std::string& s) {
    // RFC 3339 UTC: YYYY-MM-DDTHH:MM:SS[.fraction]Z
    int    year = 0, mon = 0, day = 0, hour = 0, min = 0;
    double sec  = 0.0;
    if (std::sscanf(s.c_str(), "%d-%d-%dT%d:%d:%lf",
                    &year, &mon, &day, &hour, &min, &sec) < 6) {
        fail("unparseable timestamp '" + s + "'");
    }

    std::tm tm{};
    tm.tm_year = year - 1900;
    tm.tm_mon  = mon - 1;
    tm.tm_mday = day;
    tm.tm_hour = hour;
    tm.tm_min  = min;
    tm.tm_sec  = static_cast<int>(sec);

    // timegm interprets the broken-down time as UTC (Alpaca timestamps are
    // always UTC), avoiding any local-timezone offset.
    const std::time_t tt = timegm(&tm);
    auto tp = std::chrono::system_clock::from_time_t(tt);

    const double frac = sec - static_cast<double>(static_cast<int>(sec));
    if (frac > 0.0) {
        tp += std::chrono::duration_cast<std::chrono::system_clock::duration>(
            std::chrono::duration<double>(frac));
    }
    return tp;
}

Bar parseBar(const json& j) {
    if (!j.is_object()) {
        fail("bar entry is not a JSON object");
    }
    auto require = [&](const char* key) -> const json& {
        auto it = j.find(key);
        if (it == j.end()) {
            fail(std::string("bar missing required field '") + key + "'");
        }
        return *it;
    };

    Bar b;
    b.symbol = require("S").get<std::string>();
    b.open   = require("o").get<double>();
    b.high   = require("h").get<double>();
    b.low    = require("l").get<double>();
    b.close  = require("c").get<double>();
    b.volume = require("v").get<double>();
    b.vwap   = j.value("vw", 0.0);
    b.time   = parseTimestamp(require("t").get<std::string>());
    return b;
}

std::vector<Bar> parseBars(const std::string& message) {
    std::vector<Bar> bars;

    json root = json::parse(message, nullptr, /*allow_exceptions=*/false);
    if (root.is_discarded()) {
        return bars;  // not valid JSON — caller logs the raw frame
    }

    // Alpaca streams an array of messages; tolerate a lone object too.
    const json& arr = root.is_array() ? root : json::array({root});
    for (const json& m : arr) {
        if (m.is_object() && m.value("T", std::string()) == "b") {
            bars.push_back(parseBar(m));
        }
    }
    return bars;
}

Account parseAccount(const json& j) {
    if (!j.is_object()) {
        fail("account is not a JSON object");
    }
    Account a;
    a.equity          = num(j, "equity");
    a.cash            = num(j, "cash");
    a.buying_power    = num(j, "buying_power");
    a.portfolio_value = num(j, "portfolio_value");
    return a;
}

Position parsePosition(const json& j) {
    if (!j.is_object()) {
        fail("position is not a JSON object");
    }
    Position p;
    p.symbol          = j.value("symbol", std::string());
    p.qty             = static_cast<int>(num(j, "qty"));
    p.avg_entry_price = num(j, "avg_entry_price");
    p.current_price   = num(j, "current_price");
    p.unrealized_pnl  = num(j, "unrealized_pl");  // Alpaca spells it "pl"
    p.side            = j.value("side", std::string());
    return p;
}

}  // namespace hermes::alpaca
