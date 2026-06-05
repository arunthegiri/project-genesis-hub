#pragma once

#include <chrono>
#include <deque>
#include <map>
#include <string>
#include <utility>
#include <vector>

namespace hermes {

// A single OHLCV bar. Defined here because the FeatureCalculator is the first
// consumer; the feed, logger and engine (later parts) reuse this type.
struct Bar {
    std::chrono::system_clock::time_point time;
    double      open  = 0.0;
    double      high  = 0.0;
    double      low   = 0.0;
    double      close = 0.0;
    double      volume = 0.0;
    double      vwap  = 0.0;
    std::string symbol;
};

// Computes the technical-indicator feature vector for a single symbol from a
// rolling window of bars.
//
// Values are bit-for-bit aligned with the Ananke Python SDK
// (ananke.indicators) for any input series that fits inside the lookback
// window: EMA / RSI / ATR replicate pandas' adjust=False ewm seeding, SMA
// replicates rolling(period).mean(), and VWAP resets per calendar day.
//
// NOTE on the rolling window: recursive indicators (EMA/RSI/ATR) are seeded
// from the oldest bar still in the window. While the window holds the full
// series they match the Python SDK exactly; once older bars are evicted the
// seed shifts, introducing the small drift inherent to any bounded-memory
// streaming EMA. Size the lookback accordingly for production.
class FeatureCalculator {
public:
    explicit FeatureCalculator(const std::vector<std::string>& features,
                               int lookback = 100);

    // Append a new bar to the rolling window (evicting the oldest if full).
    void update(const Bar& bar);

    // True once enough bars are buffered to evaluate every configured feature.
    bool isReady() const;

    // Ordered feature vector, matching config.features exactly.
    std::vector<float> calculate();

    // Named feature map (same values) for debugging / logging.
    std::map<std::string, float> calculateNamed();

    // Smallest window size at which isReady() becomes true.
    int minBarsNeeded() const { return min_bars_needed_; }

private:
    std::deque<Bar>          history_;
    std::vector<std::string> features_;
    int                      lookback_;
    int                      min_bars_needed_ = 1;

    // Dispatch a single feature name (e.g. "rsi_14") to its implementation.
    float calculateFeature(const std::string& name);

    // Indicator implementations (operate on the current window).
    float rsi(int period);
    float ema(int period);
    float sma(int period);
    float atr(int period);
    float volume_ratio();    // current volume / 20-bar avg volume
    float vwap_distance();   // (close - vwap) / vwap, daily-reset VWAP
    float logret(int bars);  // log(close[t] / close[t-bars])
    float intraday_range();  // (high - low) / open
    float overnight_gap();   // (open - prev_close) / prev_close
    float hmm_regime();      // placeholder — returns 0 in V1

    // Split "rsi_14" -> {"rsi", 14}; "volume_ratio" -> {"volume_ratio", 0}.
    static std::pair<std::string, int> parseFeatureName(const std::string& name);

    // Bars required to evaluate one feature (used to derive min_bars_needed_).
    static int requiredBars(const std::string& name);
};

}  // namespace hermes
