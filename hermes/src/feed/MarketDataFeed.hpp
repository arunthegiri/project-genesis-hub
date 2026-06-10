#pragma once

#include <functional>
#include <memory>
#include <string>

#include "engine/FeatureCalculator.hpp"  // Bar

namespace hermes {

// Streams 1-minute bars from the Alpaca v2 market-data WebSocket and delivers
// them to per-symbol callbacks. Runs the WebSocket on a background thread with
// automatic re-authentication, re-subscription and exponential-backoff
// reconnect. All websocketpp / Asio details live behind a PIMPL so callers
// (and the rest of the engine) never include the transport headers.
//
// Stream endpoints (chosen by mode):
//   paper -> wss://stream.data.alpaca.markets/v2/iex   (free IEX feed)
//   live  -> wss://stream.data.alpaca.markets/v2/sip   (full SIP feed)
class MarketDataFeed {
public:
    using BarCallback = std::function<void(const Bar&)>;

    MarketDataFeed(std::string api_key, std::string api_secret, std::string mode);
    ~MarketDataFeed();

    MarketDataFeed(const MarketDataFeed&)            = delete;
    MarketDataFeed& operator=(const MarketDataFeed&) = delete;

    // Register a callback for a symbol's bars. Must be called before start();
    // the set of registered symbols is what gets subscribed on connect.
    void onBar(const std::string& symbol, BarCallback callback);

    // Start the background feed thread (non-blocking). Idempotent.
    void start();

    // Stop the feed and join the background thread. Idempotent; also called by
    // the destructor.
    void stop();

    // True while the WebSocket is connected and authenticated.
    bool isConnected() const;

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};

}  // namespace hermes
