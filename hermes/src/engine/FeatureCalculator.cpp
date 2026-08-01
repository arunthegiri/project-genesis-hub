#include "engine/FeatureCalculator.hpp"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <ctime>
#include <stdexcept>
#include <vector>

namespace hermes {

namespace {

// Sample standard deviation (ddof=1) — matches pandas rolling().std().
double sampleStd(const std::vector<double>& xs) {
    const int n = static_cast<int>(xs.size());
    if (n < 2) return std::nan("");
    double mean = 0.0;
    for (double x : xs) mean += x;
    mean /= n;
    double ss = 0.0;
    for (double x : xs) ss += (x - mean) * (x - mean);
    return std::sqrt(ss / (n - 1));
}

double meanOf(const std::vector<double>& xs) {
    if (xs.empty()) return std::nan("");
    double s = 0.0;
    for (double x : xs) s += x;
    return s / xs.size();
}

// Linear-interpolation quantile — matches numpy/pandas default ("linear").
double quantileLinear(std::vector<double> xs, double q) {
    if (xs.empty()) return std::nan("");
    std::sort(xs.begin(), xs.end());
    const double pos = q * (xs.size() - 1);
    const int lo = static_cast<int>(std::floor(pos));
    const int hi = static_cast<int>(std::ceil(pos));
    if (lo == hi) return xs[lo];
    const double frac = pos - lo;
    return xs[lo] * (1.0 - frac) + xs[hi] * frac;
}

}  // namespace

FeatureCalculator::FeatureCalculator(const std::vector<std::string>& features,
                                     int lookback)
    : features_(features), lookback_(lookback) {
    for (const auto& f : features_) {
        min_bars_needed_ = std::max(min_bars_needed_, requiredBars(f));
    }
    lookback_ = std::max(lookback_, min_bars_needed_);
}

void FeatureCalculator::update(const Bar& bar) {
    // Advance persistent OBV/ADL accumulators BEFORE eviction so they stay
    // continuous regardless of the rolling window size.
    double sign = 0.0;
    if (have_prev_close_) {
        if (bar.close > prev_close_) sign = 1.0;
        else if (bar.close < prev_close_) sign = -1.0;
    }
    obv_cum_ += sign * bar.volume;

    const double hl = bar.high - bar.low;
    double mfm_vol = 0.0;  // fillna(0.0) when high == low
    if (hl != 0.0) {
        const double mfm = ((bar.close - bar.low) - (bar.high - bar.close)) / hl;
        mfm_vol = mfm * bar.volume;
    }
    adl_cum_ += mfm_vol;

    prev_close_ = bar.close;
    have_prev_close_ = true;

    obv_hist_.push_back(obv_cum_);
    adl_hist_.push_back(adl_cum_);
    while (obv_hist_.size() > 11) obv_hist_.pop_front();
    while (adl_hist_.size() > 11) adl_hist_.pop_front();

    history_.push_back(bar);
    // Snapshot the latest companion closes so the cross-asset buffers stay in
    // lockstep with history_ (carry-forward: a stale companion reuses its last
    // close; NaN until its first bar arrives).
    spy_close_.push_back(latest_spy_);
    amd_close_.push_back(latest_amd_);
    while (static_cast<int>(history_.size()) > lookback_) {
        history_.pop_front();
        spy_close_.pop_front();
        amd_close_.pop_front();
    }
}

void FeatureCalculator::updateCompanion(const std::string& symbol,
                                        const Bar& bar) {
    // Record the latest companion close; update() folds it into the aligned
    // buffer on the next primary bar. Keeps the primary interface untouched.
    if (symbol == "SPY") latest_spy_ = bar.close;
    else if (symbol == "AMD") latest_amd_ = bar.close;
}

bool FeatureCalculator::isReady() const {
    return static_cast<int>(history_.size()) >= min_bars_needed_;
}

std::vector<float> FeatureCalculator::calculate() {
    std::vector<float> out;
    out.reserve(features_.size());
    for (const auto& f : features_) out.push_back(calculateFeature(f));
    return out;
}

std::map<std::string, float> FeatureCalculator::calculateNamed() {
    std::map<std::string, float> out;
    for (const auto& f : features_) out[f] = calculateFeature(f);
    return out;
}

// ---------------------------------------------------------------------------
// Feature-name parsing & dispatch
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
    // Irregular names dispatched explicitly.
    if (name == "overnight_gap")   return 2;
    if (name == "intraday_range")  return 1;
    if (name == "stoch_k")         return 14;
    if (name == "stoch_d")         return 16;   // 14 + 2 prior k values
    if (name == "macd_line" || name == "macd_signal" ||
        name == "macd_hist" || name == "macd_hist_slope") return 35;  // 26 + 9
    if (name == "adx_14")          return 15;   // period + 1
    if (name == "bb_pctb" || name == "bb_bandwidth") return 20;
    if (name == "bb_squeeze")      return 20;   // 0 until 20 bandwidth samples
    if (name == "dist_vwap" || name == "vwap_z") return 1;
    if (name == "vol_ratio_20")    return 20;
    if (name == "obv")             return 1;
    if (name == "obv_slope")       return 11;
    if (name == "adl")             return 1;
    if (name == "adl_slope")       return 11;
    if (name == "vwpm")            return 21;
    if (name == "beta_spy_20" || name == "corr_spy_20") return 21;
    if (name == "relstr_amd_20")   return 21;
    if (name == "hour_sin" || name == "hour_cos" ||
        name == "dow_sin"  || name == "dow_cos" ||
        name == "min_since_open" || name == "min_to_close" ||
        name == "last_30_flag") return 1;
    if (name == "hmm_regime" || name == "regime_0" ||
        name == "regime_1"  || name == "regime_2" || name == "regime_3")
        return 1;

    // Clean numeric-suffix families.
    const auto [base, period] = parseFeatureName(name);
    if (base == "sma")            return std::max(period, 1);
    if (base == "ema")            return std::max(period, 1);   // ema_N_dist
    if (base == "rsi" || base == "atr") return std::max(period, 1) + 1;
    if (base == "logret")         return std::max(period, 1) + 1;
    if (base == "roc")            return std::max(period, 1) + 1;
    if (base == "vol")            return std::max(period, 1) + 1;  // std of logret
    if (base == "zscore")         return std::max(period, 1);
    if (base == "volume_ratio")   return 20;
    return std::max(period, 1);
}

float FeatureCalculator::calculateFeature(const std::string& name) {
    // Irregular / multi-output names first.
    if (name == "overnight_gap")   return overnightGap();
    if (name == "intraday_range")  return intradayRange();
    if (name == "stoch_k")         return stochK();
    if (name == "stoch_d")         return stochD();
    if (name == "macd_line")        return macd().line;
    if (name == "macd_signal")      return macd().signal;
    if (name == "macd_hist")        return macd().hist;
    if (name == "macd_hist_slope")  return macd().hist_slope;
    if (name == "adx_14")          return adx(14);
    if (name == "bb_pctb")         return bollinger(20, 2.0).pctb;
    if (name == "bb_bandwidth")    return bollinger(20, 2.0).bandwidth;
    if (name == "bb_squeeze")      return bbSqueeze();
    if (name == "dist_vwap" || name == "vwap_distance") return distVwap();
    if (name == "vwap_z")          return vwapZ();
    if (name == "vol_ratio_20")    return volumeRatio(20);
    if (name == "obv")             return static_cast<float>(obv_cum_);
    if (name == "obv_slope")       return obvSlope();
    if (name == "adl")             return static_cast<float>(adl_cum_);
    if (name == "adl_slope")       return adlSlope();
    if (name == "vwpm")            return vwpm();
    if (name == "beta_spy_20")     return betaSpy(20);
    if (name == "corr_spy_20")     return corrSpy(20);
    if (name == "relstr_amd_20")   return relstrAmd(20);
    if (name == "hour_sin")        return hourSin();
    if (name == "hour_cos")        return hourCos();
    if (name == "dow_sin")         return dowSin();
    if (name == "dow_cos")         return dowCos();
    if (name == "min_since_open")  return minSinceOpen();
    if (name == "min_to_close")    return minToClose();
    if (name == "last_30_flag")    return last30Flag();
    if (name == "hmm_regime")      return hmmRegime();
    if (name == "regime_0")        return regimeOneHot(0);
    if (name == "regime_1")        return regimeOneHot(1);
    if (name == "regime_2")        return regimeOneHot(2);
    if (name == "regime_3")        return regimeOneHot(3);

    // Clean numeric-suffix families.
    const auto [base, period] = parseFeatureName(name);
    if (base == "rsi")           return rsi(period);
    if (base == "sma")           return sma(period);
    if (base == "atr")           return atr(period);
    if (base == "logret")        return logret(period);
    if (base == "roc")           return roc(period);
    if (base == "vol")           return volStd(period);
    if (base == "zscore")        return zscore(period);
    // ema_<p>_dist — the middle number isn't a trailing suffix, so parse it out.
    if (name.rfind("ema_", 0) == 0 && name.size() > 9 &&
        name.substr(name.size() - 5) == "_dist") {
        const std::string mid = name.substr(4, name.size() - 9);
        return emaDist(std::stoi(mid));
    }
    if (base == "ema")           return ema(period);   // plain ema_<p> (legacy)
    if (base == "volume_ratio")  return volumeRatio(20);
    throw std::runtime_error("FeatureCalculator: unknown feature '" + name + "'");
}

// ---------------------------------------------------------------------------
// Day helpers
// ---------------------------------------------------------------------------
int FeatureCalculator::utcDay(std::chrono::system_clock::time_point tp) {
    std::time_t t = std::chrono::system_clock::to_time_t(tp);
    std::tm g{};
    gmtime_r(&t, &g);
    return g.tm_year * 10000 + g.tm_yday;
}

int FeatureCalculator::currentDayStart() const {
    const int n = static_cast<int>(history_.size());
    if (n == 0) return -1;
    const int day = utcDay(history_.back().time);
    int f = n - 1;
    while (f > 0 && utcDay(history_[f - 1].time) == day) --f;
    return f;
}

// ---------------------------------------------------------------------------
// Windowed single-symbol indicators
// ---------------------------------------------------------------------------
float FeatureCalculator::sma(int period) {
    const int n = static_cast<int>(history_.size());
    if (period < 1 || n < period) return std::nanf("");
    double sum = 0.0;
    for (int i = n - period; i < n; ++i) sum += history_[i].close;
    return static_cast<float>(sum / period);
}

// ewm(span=period, adjust=False).mean(), seeded at the first bar in the window.
float FeatureCalculator::ema(int period) {
    const int n = static_cast<int>(history_.size());
    if (period < 1 || n < 1) return std::nanf("");
    const double alpha = 2.0 / (period + 1.0);
    double e = history_[0].close;
    for (int i = 1; i < n; ++i)
        e = alpha * history_[i].close + (1.0 - alpha) * e;
    return static_cast<float>(e);
}

float FeatureCalculator::emaDist(int period) {
    const float e = ema(period);
    if (std::isnan(e) || e == 0.0f) return std::nanf("");
    return static_cast<float>((history_.back().close - e) / e);
}

// Wilder's RSI: ewm(alpha=1/period, adjust=False) on gains/losses.
float FeatureCalculator::rsi(int period) {
    const int n = static_cast<int>(history_.size());
    if (period < 1 || n < 2) return std::nanf("");
    const double alpha = 1.0 / period;
    double delta = history_[1].close - history_[0].close;
    double avg_gain = std::max(delta, 0.0);
    double avg_loss = std::max(-delta, 0.0);
    for (int i = 2; i < n; ++i) {
        delta = history_[i].close - history_[i - 1].close;
        avg_gain = alpha * std::max(delta, 0.0) + (1.0 - alpha) * avg_gain;
        avg_loss = alpha * std::max(-delta, 0.0) + (1.0 - alpha) * avg_loss;
    }
    const double rs = avg_gain / avg_loss;
    return static_cast<float>(100.0 - 100.0 / (1.0 + rs));
}

float FeatureCalculator::atr(int period) {
    const int n = static_cast<int>(history_.size());
    if (period < 1 || n < 1) return std::nanf("");
    const double alpha = 1.0 / period;
    double a = history_[0].high - history_[0].low;
    for (int i = 1; i < n; ++i) {
        const double prev_close = history_[i - 1].close;
        const double tr = std::max({history_[i].high - history_[i].low,
                                    std::fabs(history_[i].high - prev_close),
                                    std::fabs(history_[i].low - prev_close)});
        a = alpha * tr + (1.0 - alpha) * a;
    }
    return static_cast<float>(a);
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

// (close[t]/close[t-bars] - 1) * 100.
float FeatureCalculator::roc(int bars) {
    const int n = static_cast<int>(history_.size());
    if (bars < 1 || n < bars + 1) return std::nanf("");
    const double prev = history_[n - 1 - bars].close;
    if (prev == 0.0) return std::nanf("");
    return static_cast<float>((history_.back().close / prev - 1.0) * 100.0);
}

// rolling(window).std() of 1-bar log returns (ddof=1).
float FeatureCalculator::volStd(int window) {
    const int n = static_cast<int>(history_.size());
    if (window < 1 || n < window + 1) return std::nanf("");
    std::vector<double> rets;
    rets.reserve(window);
    for (int i = n - window; i < n; ++i) {
        const double a = history_[i - 1].close, b = history_[i].close;
        if (a <= 0.0 || b <= 0.0) return std::nanf("");
        rets.push_back(std::log(b / a));
    }
    return static_cast<float>(sampleStd(rets));
}

// (close - sma(w)) / rolling std(w), ddof=1.
float FeatureCalculator::zscore(int window) {
    const int n = static_cast<int>(history_.size());
    if (window < 1 || n < window) return std::nanf("");
    std::vector<double> xs;
    xs.reserve(window);
    for (int i = n - window; i < n; ++i) xs.push_back(history_[i].close);
    const double sd = sampleStd(xs);
    if (std::isnan(sd) || sd == 0.0) return std::nanf("");
    return static_cast<float>((history_.back().close - meanOf(xs)) / sd);
}

// 100*(c - LL14)/(HH14 - LL14), 14-bar low/high.
float FeatureCalculator::stochK() {
    const int n = static_cast<int>(history_.size());
    if (n < 14) return std::nanf("");
    double ll = history_[n - 14].low, hh = history_[n - 14].high;
    for (int i = n - 14; i < n; ++i) {
        ll = std::min(ll, history_[i].low);
        hh = std::max(hh, history_[i].high);
    }
    if (hh == ll) return std::nanf("");
    return static_cast<float>(100.0 * (history_.back().close - ll) / (hh - ll));
}

// 3-bar SMA of stoch_k. Recompute k at the three most recent positions.
float FeatureCalculator::stochD() {
    const int n = static_cast<int>(history_.size());
    if (n < 16) return std::nanf("");
    auto kAt = [&](int end) -> double {
        double ll = history_[end - 13].low, hh = history_[end - 13].high;
        for (int i = end - 13; i <= end; ++i) {
            ll = std::min(ll, history_[i].low);
            hh = std::max(hh, history_[i].high);
        }
        if (hh == ll) return std::nan("");
        return 100.0 * (history_[end].close - ll) / (hh - ll);
    };
    const double k0 = kAt(n - 1), k1 = kAt(n - 2), k2 = kAt(n - 3);
    if (std::isnan(k0) || std::isnan(k1) || std::isnan(k2)) return std::nanf("");
    return static_cast<float>((k0 + k1 + k2) / 3.0);
}

float FeatureCalculator::volumeRatio(int window) {
    const int n = static_cast<int>(history_.size());
    if (n < window) return std::nanf("");
    double sum = 0.0;
    for (int i = n - window; i < n; ++i) sum += history_[i].volume;
    const double avg = sum / window;
    if (avg == 0.0) return std::nanf("");
    return static_cast<float>(history_.back().volume / avg);
}

float FeatureCalculator::intradayRange() {
    if (history_.empty()) return std::nanf("");
    const Bar& b = history_.back();
    if (b.open == 0.0) return std::nanf("");
    return static_cast<float>((b.high - b.low) / b.open);
}

// day_first_open / prev_day_last_close - 1 (prior calendar day's last close).
float FeatureCalculator::overnightGap() {
    const int f = currentDayStart();
    if (f <= 0) return std::nanf("");            // no prior day in the window
    const double day_first_open = history_[f].open;
    const double prev_day_close = history_[f - 1].close;
    if (prev_day_close == 0.0) return std::nanf("");
    return static_cast<float>(day_first_open / prev_day_close - 1.0);
}

// (close - VWAP) / VWAP, daily-reset cumulative VWAP at the last bar.
float FeatureCalculator::distVwap() {
    const int n = static_cast<int>(history_.size());
    if (n < 1) return std::nanf("");
    const int day = utcDay(history_.back().time);
    double cum_tpv = 0.0, cum_vol = 0.0;
    for (int i = 0; i < n; ++i) {
        if (utcDay(history_[i].time) != day) continue;
        const Bar& b = history_[i];
        cum_tpv += (b.high + b.low + b.close) / 3.0 * b.volume;
        cum_vol += b.volume;
    }
    if (cum_vol == 0.0) return std::nanf("");
    const double vwap = cum_tpv / cum_vol;
    if (vwap == 0.0) return std::nanf("");
    return static_cast<float>((history_.back().close - vwap) / vwap);
}

// deviation(close - VWAP) / expanding intraday std(ddof=1) of that deviation.
float FeatureCalculator::vwapZ() {
    const int n = static_cast<int>(history_.size());
    if (n < 1) return std::nanf("");
    const int day = utcDay(history_.back().time);
    double cum_tpv = 0.0, cum_vol = 0.0;
    std::vector<double> devs;
    double last_dev = std::nan("");
    for (int i = 0; i < n; ++i) {
        if (utcDay(history_[i].time) != day) continue;
        const Bar& b = history_[i];
        cum_tpv += (b.high + b.low + b.close) / 3.0 * b.volume;
        cum_vol += b.volume;
        if (cum_vol == 0.0) continue;
        const double vwap = cum_tpv / cum_vol;
        last_dev = b.close - vwap;
        devs.push_back(last_dev);
    }
    const double sd = sampleStd(devs);
    if (std::isnan(sd) || sd == 0.0) return std::nanf("");
    return static_cast<float>(last_dev / sd);
}

// sum(logret1 * vol, 20) / sum(vol, 20).
float FeatureCalculator::vwpm() {
    const int n = static_cast<int>(history_.size());
    if (n < 21) return std::nanf("");
    double num = 0.0, den = 0.0;
    for (int i = n - 20; i < n; ++i) {
        const double a = history_[i - 1].close, b = history_[i].close;
        if (a <= 0.0 || b <= 0.0) return std::nanf("");
        num += std::log(b / a) * history_[i].volume;
        den += history_[i].volume;
    }
    if (den == 0.0) return std::nanf("");
    return static_cast<float>(num / den);
}

// ---------------------------------------------------------------------------
// MACD / ADX / Bollinger
// ---------------------------------------------------------------------------
FeatureCalculator::MacdState FeatureCalculator::macd(int fast, int slow,
                                                     int signal) {
    const int n = static_cast<int>(history_.size());
    if (n < 1) return {std::nanf(""), std::nanf(""), std::nanf(""), std::nanf("")};
    const double af = 2.0 / (fast + 1.0);
    const double as = 2.0 / (slow + 1.0);
    const double ag = 2.0 / (signal + 1.0);
    double ef = history_[0].close, es = history_[0].close;
    double line = ef - es, sig = line, hist = line - sig, prev_hist = hist;
    for (int i = 1; i < n; ++i) {
        const double c = history_[i].close;
        ef = af * c + (1.0 - af) * ef;
        es = as * c + (1.0 - as) * es;
        line = ef - es;
        sig = ag * line + (1.0 - ag) * sig;
        prev_hist = hist;
        hist = line - sig;
    }
    return {static_cast<float>(line), static_cast<float>(sig),
            static_cast<float>(hist), static_cast<float>(hist - prev_hist)};
}

// ADX(14): Wilder-smoothed +DI/-DI → DX → Wilder-smoothed DX.
float FeatureCalculator::adx(int period) {
    const int n = static_cast<int>(history_.size());
    if (period < 1 || n < 2) return std::nanf("");
    const double alpha = 1.0 / period;
    bool seeded = false;
    double atr_w = 0.0, plus_sm = 0.0, minus_sm = 0.0;
    double adx_val = 0.0;
    bool adx_seeded = false;
    for (int i = 1; i < n; ++i) {
        const double h = history_[i].high, l = history_[i].low;
        const double ph = history_[i - 1].high, pl = history_[i - 1].low;
        const double pc = history_[i - 1].close;
        const double up = h - ph, down = pl - l;
        const double plus_dm  = (up > down && up > 0.0) ? up : 0.0;
        const double minus_dm = (down > up && down > 0.0) ? down : 0.0;
        const double tr = std::max({h - l, std::fabs(h - pc), std::fabs(l - pc)});
        if (!seeded) {
            atr_w = tr; plus_sm = plus_dm; minus_sm = minus_dm;
            seeded = true;
        } else {
            atr_w    = alpha * tr       + (1.0 - alpha) * atr_w;
            plus_sm  = alpha * plus_dm  + (1.0 - alpha) * plus_sm;
            minus_sm = alpha * minus_dm + (1.0 - alpha) * minus_sm;
        }
        if (atr_w == 0.0) continue;
        const double plus_di  = 100.0 * plus_sm / atr_w;
        const double minus_di = 100.0 * minus_sm / atr_w;
        const double di_sum = plus_di + minus_di;
        if (di_sum == 0.0) continue;
        const double dx = 100.0 * std::fabs(plus_di - minus_di) / di_sum;
        if (!adx_seeded) { adx_val = dx; adx_seeded = true; }
        else adx_val = alpha * dx + (1.0 - alpha) * adx_val;
    }
    if (!adx_seeded) return std::nanf("");
    return static_cast<float>(adx_val);
}

FeatureCalculator::BollState FeatureCalculator::bollinger(int period,
                                                          double num_std) {
    const int n = static_cast<int>(history_.size());
    if (n < period) return {std::nanf(""), std::nanf("")};
    std::vector<double> xs;
    xs.reserve(period);
    for (int i = n - period; i < n; ++i) xs.push_back(history_[i].close);
    const double mid = meanOf(xs);
    const double sd = sampleStd(xs);
    if (std::isnan(sd)) return {std::nanf(""), std::nanf("")};
    const double band = num_std * sd;            // half-width
    const double upper = mid + band, lower = mid - band;
    const double range = upper - lower;
    const double c = history_.back().close;
    const float pctb = range == 0.0 ? std::nanf("")
                                    : static_cast<float>((c - lower) / range);
    const float bw = mid == 0.0 ? std::nanf("")
                                : static_cast<float>(range / mid);
    return {pctb, bw};
}

// bb_bandwidth computed with `end_index` as the last bar of the window.
float FeatureCalculator::bbBandwidthAt(int end_index, int period,
                                       double num_std) {
    if (end_index + 1 < period) return std::nanf("");
    std::vector<double> xs;
    xs.reserve(period);
    for (int i = end_index - period + 1; i <= end_index; ++i)
        xs.push_back(history_[i].close);
    const double mid = meanOf(xs);
    const double sd = sampleStd(xs);
    if (std::isnan(sd) || mid == 0.0) return std::nanf("");
    return static_cast<float>((2.0 * num_std * sd) / mid);
}

// (bb_bandwidth <= rolling(100, min_periods=20).quantile(0.2)).
float FeatureCalculator::bbSqueeze() {
    const int n = static_cast<int>(history_.size());
    const double cur = bbBandwidthAt(n - 1, 20, 2.0);
    if (std::isnan(cur)) return 0.0f;
    std::vector<double> bws;
    const int start = std::max(0, n - 100);
    for (int end = start; end < n; ++end) {
        const double bw = bbBandwidthAt(end, 20, 2.0);
        if (!std::isnan(bw)) bws.push_back(bw);
    }
    if (static_cast<int>(bws.size()) < 20) return 0.0f;   // min_periods=20
    const double q = quantileLinear(bws, 0.2);
    return cur <= q ? 1.0f : 0.0f;
}

// ---------------------------------------------------------------------------
// Stateful accessors
// ---------------------------------------------------------------------------
float FeatureCalculator::obvSlope() {
    if (obv_hist_.size() < 11) return std::nanf("");
    return static_cast<float>(obv_hist_.back() - obv_hist_.front());
}

float FeatureCalculator::adlSlope() {
    if (adl_hist_.size() < 11) return std::nanf("");
    return static_cast<float>(adl_hist_.back() - adl_hist_.front());
}

// ---------------------------------------------------------------------------
// Cross-asset (companion buffers, aligned 1:1 with primary bars)
// ---------------------------------------------------------------------------
// Collect the last `window` aligned 1-bar logret pairs (NVDA, SPY). spy_close_
// is kept in lockstep with history_, so both share the same indices.
bool FeatureCalculator::spyLogrets(int window, std::vector<double>& nv,
                                   std::vector<double>& sp) const {
    const int n = static_cast<int>(history_.size());
    if (n < window + 1) return false;
    for (int i = n - window; i < n; ++i) {
        const double na = history_[i - 1].close, nb = history_[i].close;
        const double sa = spy_close_[i - 1],     sb = spy_close_[i];
        if (!(na > 0 && nb > 0 && sa > 0 && sb > 0) ||
            std::isnan(sa) || std::isnan(sb))
            return false;
        nv.push_back(std::log(nb / na));
        sp.push_back(std::log(sb / sa));
    }
    return true;
}

// beta = cov(nvda_ret, spy_ret, 20) / var(spy_ret, 20)  (ddof=1).
float FeatureCalculator::betaSpy(int window) {
    std::vector<double> nv, sp;
    if (!spyLogrets(window, nv, sp)) return std::nanf("");
    const double mn = meanOf(nv), ms = meanOf(sp);
    double cov = 0.0, var = 0.0;
    for (int i = 0; i < window; ++i) {
        cov += (nv[i] - mn) * (sp[i] - ms);
        var += (sp[i] - ms) * (sp[i] - ms);
    }
    if (var == 0.0) return std::nanf("");
    return static_cast<float>((cov / (window - 1)) / (var / (window - 1)));
}

float FeatureCalculator::corrSpy(int window) {
    std::vector<double> nv, sp;
    if (!spyLogrets(window, nv, sp)) return std::nanf("");
    const double mn = meanOf(nv), ms = meanOf(sp);
    double cov = 0.0, vn = 0.0, vs = 0.0;
    for (int i = 0; i < window; ++i) {
        cov += (nv[i] - mn) * (sp[i] - ms);
        vn  += (nv[i] - mn) * (nv[i] - mn);
        vs  += (sp[i] - ms) * (sp[i] - ms);
    }
    if (vn == 0.0 || vs == 0.0) return std::nanf("");
    return static_cast<float>(cov / std::sqrt(vn * vs));
}

// (nvda_close / amd_close).pct_change(20).
float FeatureCalculator::relstrAmd(int window) {
    const int n = static_cast<int>(history_.size());
    if (n < window + 1) return std::nanf("");
    const double cur_amd = amd_close_[n - 1];
    const double prev_amd = amd_close_[n - 1 - window];
    if (std::isnan(cur_amd) || std::isnan(prev_amd) ||
        cur_amd == 0.0 || prev_amd == 0.0)
        return std::nanf("");
    const double cur = history_[n - 1].close / cur_amd;
    const double prev = history_[n - 1 - window].close / prev_amd;
    if (prev == 0.0) return std::nanf("");
    return static_cast<float>(cur / prev - 1.0);
}

// ---------------------------------------------------------------------------
// Time features (UTC timestamp of the latest bar)
// ---------------------------------------------------------------------------
namespace {
std::tm lastTm(std::chrono::system_clock::time_point tp) {
    std::time_t t = std::chrono::system_clock::to_time_t(tp);
    std::tm g{};
    gmtime_r(&t, &g);
    return g;
}
constexpr double kPi = 3.14159265358979323846;
}  // namespace

float FeatureCalculator::hourSin() {
    if (history_.empty()) return std::nanf("");
    const std::tm g = lastTm(history_.back().time);
    const double hour = g.tm_hour + g.tm_min / 60.0;
    return static_cast<float>(std::sin(2 * kPi * hour / 24.0));
}
float FeatureCalculator::hourCos() {
    if (history_.empty()) return std::nanf("");
    const std::tm g = lastTm(history_.back().time);
    const double hour = g.tm_hour + g.tm_min / 60.0;
    return static_cast<float>(std::cos(2 * kPi * hour / 24.0));
}
float FeatureCalculator::dowSin() {
    if (history_.empty()) return std::nanf("");
    const std::tm g = lastTm(history_.back().time);
    const int dow = (g.tm_wday + 6) % 7;   // C Sun=0 -> pandas Mon=0
    return static_cast<float>(std::sin(2 * kPi * dow / 7.0));
}
float FeatureCalculator::dowCos() {
    if (history_.empty()) return std::nanf("");
    const std::tm g = lastTm(history_.back().time);
    const int dow = (g.tm_wday + 6) % 7;
    return static_cast<float>(std::cos(2 * kPi * dow / 7.0));
}
float FeatureCalculator::minSinceOpen() {
    const int f = currentDayStart();
    if (f < 0) return std::nanf("");
    const auto dt = history_.back().time - history_[f].time;
    return static_cast<float>(
        std::chrono::duration_cast<std::chrono::seconds>(dt).count() / 60.0);
}
float FeatureCalculator::minToClose() {
    const float m = minSinceOpen();
    if (std::isnan(m)) return std::nanf("");
    return 390.0f - m;
}
float FeatureCalculator::last30Flag() {
    const float m = minSinceOpen();
    if (std::isnan(m)) return std::nanf("");
    return m > 360.0f ? 1.0f : 0.0f;
}

}  // namespace hermes
