#include "engine/FeatureCalculator.hpp"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <ctime>
#include <stdexcept>

namespace hermes {

FeatureCalculator::FeatureCalculator(const std::vector<std::string>& features,
                                     int lookback)
    : features_(features), lookback_(lookback) {
    // Derive the warm-up requirement from the configured features.
    for (const auto& f : features_) {
        min_bars_needed_ = std::max(min_bars_needed_, requiredBars(f));
    }
    // The window must be able to hold at least the warm-up history.
    lookback_ = std::max(lookback_, min_bars_needed_);
}

void FeatureCalculator::update(const Bar& bar) {
    history_.push_back(bar);
    while (static_cast<int>(history_.size()) > lookback_) {
        history_.pop_front();
    }
}

bool FeatureCalculator::isReady() const {
    return static_cast<int>(history_.size()) >= min_bars_needed_;
}

std::vector<float> FeatureCalculator::calculate() {
    std::vector<float> out;
    out.reserve(features_.size());
    for (const auto& f : features_) {
        out.push_back(calculateFeature(f));
    }
    return out;
}

std::map<std::string, float> FeatureCalculator::calculateNamed() {
    std::map<std::string, float> out;
    for (const auto& f : features_) {
        out[f] = calculateFeature(f);
    }
    return out;
}

// ---------------------------------------------------------------------------
// Feature-name parsing
// ---------------------------------------------------------------------------
std::pair<std::string, int> FeatureCalculator::parseFeatureName(
    const std::string& name) {
    auto pos = name.find_last_of('_');
    if (pos != std::string::npos && pos + 1 < name.size()) {
        const std::string suffix = name.substr(pos + 1);
        if (!suffix.empty() &&
            std::all_of(suffix.begin(), suffix.end(),
                        [](unsigned char c) { return std::isdigit(c); })) {
            return {name.substr(0, pos), std::stoi(suffix)};
        }
    }
    return {name, 0};
}

int FeatureCalculator::requiredBars(const std::string& name) {
    const auto [base, period] = parseFeatureName(name);
    if (base == "sma" || base == "ema") return std::max(period, 1);
    if (base == "rsi" || base == "atr") return std::max(period, 1) + 1;
    if (base == "logret")               return std::max(period, 1) + 1;
    if (base == "volume_ratio")         return 20;
    if (base == "overnight_gap")        return 2;
    if (base == "vwap_distance")        return 1;
    if (base == "intraday_range")       return 1;
    if (base == "hmm_regime")           return 1;
    return std::max(period, 1);
}

float FeatureCalculator::calculateFeature(const std::string& name) {
    const auto [base, period] = parseFeatureName(name);
    if (base == "rsi")            return rsi(period);
    if (base == "ema")            return ema(period);
    if (base == "sma")            return sma(period);
    if (base == "atr")            return atr(period);
    if (base == "logret")         return logret(period);
    if (base == "volume_ratio")   return volume_ratio();
    if (base == "vwap_distance")  return vwap_distance();
    if (base == "intraday_range") return intraday_range();
    if (base == "overnight_gap")  return overnight_gap();
    if (base == "hmm_regime")     return hmm_regime();
    throw std::runtime_error("FeatureCalculator: unknown feature '" + name + "'");
}

// ---------------------------------------------------------------------------
// Indicator implementations. Each replicates the corresponding pandas routine
// in ananke/indicators.py over the bars currently in history_.
// ---------------------------------------------------------------------------

// rolling(period).mean() evaluated at the last bar.
float FeatureCalculator::sma(int period) {
    const int n = static_cast<int>(history_.size());
    if (period < 1 || n < period) return std::nanf("");
    double sum = 0.0;
    for (int i = n - period; i < n; ++i) sum += history_[i].close;
    return static_cast<float>(sum / period);
}

// ewm(span=period, adjust=False).mean(), seeded at the first bar.
float FeatureCalculator::ema(int period) {
    const int n = static_cast<int>(history_.size());
    if (period < 1 || n < 1) return std::nanf("");
    const double alpha = 2.0 / (period + 1.0);
    double e = history_[0].close;
    for (int i = 1; i < n; ++i) {
        e = alpha * history_[i].close + (1.0 - alpha) * e;
    }
    return static_cast<float>(e);
}

// Wilder's RSI: ewm(alpha=1/period, adjust=False) on gains/losses, seeded at
// the first delta (index 1) — matching pandas' handling of the leading NaN.
float FeatureCalculator::rsi(int period) {
    const int n = static_cast<int>(history_.size());
    if (period < 1 || n < 2) return std::nanf("");
    const double alpha = 1.0 / period;

    // Seed from the first delta (between bars 0 and 1).
    double delta = history_[1].close - history_[0].close;
    double avg_gain = std::max(delta, 0.0);
    double avg_loss = std::max(-delta, 0.0);

    for (int i = 2; i < n; ++i) {
        delta = history_[i].close - history_[i - 1].close;
        const double gain = std::max(delta, 0.0);
        const double loss = std::max(-delta, 0.0);
        avg_gain = alpha * gain + (1.0 - alpha) * avg_gain;
        avg_loss = alpha * loss + (1.0 - alpha) * avg_loss;
    }

    const double rs = avg_gain / avg_loss;          // inf when avg_loss == 0
    return static_cast<float>(100.0 - 100.0 / (1.0 + rs));
}

// True Range with Wilder smoothing; TR[0] = high - low (matches the pandas
// combine(max) seeding where the missing prev_close drops out).
float FeatureCalculator::atr(int period) {
    const int n = static_cast<int>(history_.size());
    if (period < 1 || n < 1) return std::nanf("");
    const double alpha = 1.0 / period;

    double a = history_[0].high - history_[0].low;   // TR[0]
    for (int i = 1; i < n; ++i) {
        const double prev_close = history_[i - 1].close;
        const double tr = std::max({history_[i].high - history_[i].low,
                                    std::fabs(history_[i].high - prev_close),
                                    std::fabs(history_[i].low - prev_close)});
        a = alpha * tr + (1.0 - alpha) * a;
    }
    return static_cast<float>(a);
}

// Current volume / mean of the last 20 bars' volume (inclusive).
float FeatureCalculator::volume_ratio() {
    const int n = static_cast<int>(history_.size());
    if (n < 20) return std::nanf("");
    double sum = 0.0;
    for (int i = n - 20; i < n; ++i) sum += history_[i].volume;
    const double avg = sum / 20.0;
    if (avg == 0.0) return std::nanf("");
    return static_cast<float>(history_.back().volume / avg);
}

// (close - vwap) / vwap, where VWAP is the daily-reset cumulative VWAP of the
// Python SDK, evaluated at the last bar. Cumulates bars sharing the last bar's
// UTC calendar date.
float FeatureCalculator::vwap_distance() {
    const int n = static_cast<int>(history_.size());
    if (n < 1) return std::nanf("");

    auto utc_day = [](std::chrono::system_clock::time_point tp) {
        std::time_t t = std::chrono::system_clock::to_time_t(tp);
        std::tm g{};
        gmtime_r(&t, &g);
        return g.tm_year * 10000 + g.tm_yday;  // unique per (year, day)
    };

    const int last_day = utc_day(history_.back().time);
    double cum_tpv = 0.0, cum_vol = 0.0;
    for (int i = 0; i < n; ++i) {
        if (utc_day(history_[i].time) != last_day) continue;
        const Bar& b = history_[i];
        const double tp = (b.high + b.low + b.close) / 3.0;
        cum_tpv += tp * b.volume;
        cum_vol += b.volume;
    }
    if (cum_vol == 0.0) return std::nanf("");
    const double vwap = cum_tpv / cum_vol;
    if (vwap == 0.0) return std::nanf("");
    return static_cast<float>((history_.back().close - vwap) / vwap);
}

// log(close[t] / close[t-bars]).
float FeatureCalculator::logret(int bars) {
    const int n = static_cast<int>(history_.size());
    if (bars < 1 || n < bars + 1) return std::nanf("");
    const double cur = history_.back().close;
    const double prev = history_[n - 1 - bars].close;
    if (prev <= 0.0 || cur <= 0.0) return std::nanf("");
    return static_cast<float>(std::log(cur / prev));
}

// (high - low) / open for the latest bar.
float FeatureCalculator::intraday_range() {
    if (history_.empty()) return std::nanf("");
    const Bar& b = history_.back();
    if (b.open == 0.0) return std::nanf("");
    return static_cast<float>((b.high - b.low) / b.open);
}

// (open - prev_close) / prev_close for the latest bar.
float FeatureCalculator::overnight_gap() {
    const int n = static_cast<int>(history_.size());
    if (n < 2) return std::nanf("");
    const double prev_close = history_[n - 2].close;
    if (prev_close == 0.0) return std::nanf("");
    return static_cast<float>((history_.back().open - prev_close) / prev_close);
}

// Real regime detection arrives in V2; V1 always reports regime 0.
float FeatureCalculator::hmm_regime() {
    return 0.0f;
}

}  // namespace hermes
