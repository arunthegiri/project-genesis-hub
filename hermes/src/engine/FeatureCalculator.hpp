#pragma once

#include <chrono>
#include <cmath>
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
// rolling window of bars, plus stateful (OBV/ADL), cross-asset (SPY/AMD) and
// regime (HMM) features. The output order matches config.features exactly —
// the canonical 55-feature contract (feature_list_tech5_v1.json).
//
// Fidelity: every value replicates the exact pandas semantics used to build the
// training feature store (FirstRRC.ipynb, Section 3):
//   - EMA/RSI/ATR/MACD use ewm(adjust=False); RSI/ATR/ADX use Wilder alpha=1/N.
//   - rolling std / var / cov / corr use ddof=1 (pandas default, sample stats).
//   - VWAP and the day-relative features (overnight_gap, min_since_open/close,
//     vwap_z) reset/group per UTC calendar day.
//   - OBV/ADL are persistent cumulative sums (NOT windowed), maintained in
//     update() so they stay continuous as the rolling window evicts old bars.
//
// NOTE on the rolling window: recursive indicators (EMA/RSI/ATR/MACD/ADX) are
// seeded from the oldest bar still in the window. While the window holds the
// full series they match the notebook exactly; once older bars are evicted the
// seed shifts, introducing the small drift inherent to any bounded-memory
// streaming EMA. Size the lookback accordingly for production.
class FeatureCalculator {
public:
    explicit FeatureCalculator(const std::vector<std::string>& features,
                               int lookback = 100);

    // Append a new primary-symbol bar (evicting the oldest if full). Also
    // advances the persistent OBV/ADL accumulators.
    void update(const Bar& bar);

    // Companion-symbol intake (SPY/AMD) for the cross-asset features. Kept
    // separate from update() so the frozen primary interface is untouched.
    // The engine calls this for each companion bar; buffers are aligned 1:1
    // with primary bars by arrival order (see cross-asset handlers).
    void updateCompanion(const std::string& symbol, const Bar& bar);

    // Set the current day's HMM regime (0..3). Broadcast by the engine once
    // per trading day; drives hmm_regime and regime_0/1/2.
    void setRegime(int regime) { regime_ = regime; }

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

    // Persistent (non-windowed) accumulators — advanced in update().
    double            obv_cum_ = 0.0;
    double            adl_cum_ = 0.0;
    bool              have_prev_close_ = false;
    double            prev_close_ = 0.0;
    std::deque<double> obv_hist_;   // last 11 OBV values, for obv_slope=diff(10)
    std::deque<double> adl_hist_;   // last 11 ADL values, for adl_slope=diff(10)

    // Companion-symbol closes. updateCompanion() records the latest close;
    // each primary update() snapshots it into the aligned buffer (carry-forward
    // if a companion bar is momentarily stale), keeping these in lockstep with
    // history_ so the cross-asset handlers can share its indices.
    double             latest_spy_ = std::nan("");
    double             latest_amd_ = std::nan("");
    std::deque<double> spy_close_;   // aligned 1:1 with history_
    std::deque<double> amd_close_;

    int regime_ = 0;                // current HMM regime, set by the engine

    // Dispatch a single feature name to its implementation.
    float calculateFeature(const std::string& name);

    // --- windowed single-symbol indicators (operate on history_) -------------
    float rsi(int period);
    float ema(int period);
    float sma(int period);
    float atr(int period);
    float emaDist(int period);      // (close - ema(N)) / ema(N)
    float logret(int bars);         // log(close[t] / close[t-bars])
    float roc(int bars);            // (close[t]/close[t-bars] - 1) * 100
    float volStd(int window);       // rolling std (ddof=1) of 1-bar logret
    float zscore(int window);       // (close - sma(w)) / rolling std(w)
    float stochK();                 // 100*(c-LL14)/(HH14-LL14)
    float stochD();                 // 3-bar SMA of stoch_k
    float volumeRatio(int window);  // volume / mean(volume, window)
    float intradayRange();          // (high - low) / open
    float overnightGap();           // day_first_open / prev_day_close - 1
    float distVwap();               // (close - vwap) / vwap, daily-reset VWAP
    float vwapZ();                  // deviation / intraday expanding std
    float vwpm();                   // sum(logret*vol,20)/sum(vol,20)

    // --- MACD / ADX / Bollinger (multi-output, computed as a unit) -----------
    struct MacdState { float line, signal, hist, hist_slope; };
    MacdState macd(int fast = 12, int slow = 26, int signal = 9);
    float adx(int period);
    struct BollState { float pctb, bandwidth; };
    BollState bollinger(int period, double num_std);
    float bbBandwidthAt(int end_index, int period, double num_std);  // helper
    float bbSqueeze();

    // --- stateful accessors (read the persistent accumulators) ---------------
    float obvSlope();
    float adlSlope();

    // --- cross-asset (companion buffers) -------------------------------------
    bool spyLogrets(int window, std::vector<double>& nv,
                    std::vector<double>& sp) const;
    float betaSpy(int window);
    float corrSpy(int window);
    float relstrAmd(int window);

    // --- time features (from the latest bar's UTC timestamp) -----------------
    float hourSin();
    float hourCos();
    float dowSin();
    float dowCos();
    float minSinceOpen();
    float minToClose();
    float last30Flag();

    // --- regime --------------------------------------------------------------
    float hmmRegime() { return static_cast<float>(regime_); }
    float regimeOneHot(int k) {
        return regime_ == k ? 1.0f : 0.0f;
    }

    // --- day helpers ---------------------------------------------------------
    // Unique key per (year, day-of-year) in UTC — groups bars by calendar day.
    static int utcDay(std::chrono::system_clock::time_point tp);
    // Index of the first bar in history_ sharing the last bar's UTC day.
    int currentDayStart() const;

    // Split "rsi_14" -> {"rsi", 14}; irregular names -> {name, 0}.
    static std::pair<std::string, int> parseFeatureName(const std::string& name);

    // Bars required to evaluate one feature (used to derive min_bars_needed_).
    static int requiredBars(const std::string& name);
};

}  // namespace hermes
