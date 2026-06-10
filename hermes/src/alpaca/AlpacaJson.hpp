#pragma once

#include <chrono>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "engine/FeatureCalculator.hpp"   // Bar
#include "execution/OrderExecutor.hpp"    // Account, Position

// Pure JSON <-> struct translation for the Alpaca v2 API. These functions have
// no networking dependencies so they can be unit-tested offline (see
// tests/test_alpaca_parse.cpp). MarketDataFeed (Part 5) and OrderExecutor
// (Part 6) own the I/O and delegate all parsing here.
namespace hermes::alpaca {

// Parse an RFC 3339 / ISO-8601 UTC timestamp ("2021-02-22T19:15:00Z", with
// optional fractional seconds) into a system_clock::time_point. Throws
// std::runtime_error if the string is not a recognisable timestamp.
std::chrono::system_clock::time_point parseTimestamp(const std::string& s);

// Parse a single Alpaca bar object: {"T":"b","S":"NVDA","o":..,"h":..,"l":..,
// "c":..,"v":..,"vw":..,"t":"..."}. Throws on missing required fields.
Bar parseBar(const nlohmann::json& bar);

// Parse a raw stream message (a JSON array of typed objects, or a single
// object) and return only the bar entries (T == "b"). Non-bar / malformed
// entries are skipped. A message that is not valid JSON yields an empty vector.
std::vector<Bar> parseBars(const std::string& message);

// Parse an Alpaca account object. Numeric fields arrive as JSON strings;
// both string and numeric encodings are accepted.
Account parseAccount(const nlohmann::json& account);

// Parse an Alpaca position object (field "unrealized_pl", signed "qty").
Position parsePosition(const nlohmann::json& position);

}  // namespace hermes::alpaca
