#include "engine/HMMRegime.hpp"

#include <cmath>
#include <fstream>
#include <limits>
#include <stdexcept>

#include <nlohmann/json.hpp>

namespace hermes {

using nlohmann::json;

namespace {

constexpr double kLog2Pi = 1.8378770664093453;  // log(2*pi)

// Invert a k x k symmetric positive-definite matrix via Gauss-Jordan with
// partial pivoting; also returns log|A|. Throws if singular.
std::vector<std::vector<double>> invertWithLogDet(
    std::vector<std::vector<double>> a, double& log_det) {
    const int k = static_cast<int>(a.size());
    std::vector<std::vector<double>> inv(k, std::vector<double>(k, 0.0));
    for (int i = 0; i < k; ++i) inv[i][i] = 1.0;

    double sign_log_det = 0.0;
    for (int col = 0; col < k; ++col) {
        int pivot = col;
        for (int r = col + 1; r < k; ++r)
            if (std::fabs(a[r][col]) > std::fabs(a[pivot][col])) pivot = r;
        if (std::fabs(a[pivot][col]) < 1e-300)
            throw std::runtime_error("HMMRegime: singular covariance matrix");
        if (pivot != col) { std::swap(a[pivot], a[col]); std::swap(inv[pivot], inv[col]); }

        const double diag = a[col][col];
        sign_log_det += std::log(std::fabs(diag));
        for (int j = 0; j < k; ++j) { a[col][j] /= diag; inv[col][j] /= diag; }
        for (int r = 0; r < k; ++r) {
            if (r == col) continue;
            const double factor = a[r][col];
            if (factor == 0.0) continue;
            for (int j = 0; j < k; ++j) {
                a[r][j]   -= factor * a[col][j];
                inv[r][j] -= factor * inv[col][j];
            }
        }
    }
    log_det = sign_log_det;
    return inv;
}

double logSumExp(const std::vector<double>& xs) {
    double m = -std::numeric_limits<double>::infinity();
    for (double x : xs) m = std::max(m, x);
    if (std::isinf(m)) return m;
    double s = 0.0;
    for (double x : xs) s += std::exp(x - m);
    return m + std::log(s);
}

template <typename T>
std::vector<T> getVec(const json& j) {
    std::vector<T> v;
    for (const auto& e : j) v.push_back(e.get<T>());
    return v;
}

}  // namespace

HMMRegime HMMRegime::fromFile(const std::string& path) {
    std::ifstream in(path);
    if (!in) throw std::runtime_error("HMMRegime: cannot open '" + path + "'");
    std::string text((std::istreambuf_iterator<char>(in)),
                     std::istreambuf_iterator<char>());
    return fromJsonString(text);
}

HMMRegime HMMRegime::fromJsonString(const std::string& text) {
    const json j = json::parse(text);
    HMMRegime h;
    h.n_states_   = j.at("n_states").get<int>();
    h.feature_order_ = getVec<std::string>(j.at("feature_order"));
    h.n_features_ = static_cast<int>(h.feature_order_.size());
    h.scaler_mean_  = getVec<double>(j.at("scaler_mean"));
    h.scaler_scale_ = getVec<double>(j.at("scaler_scale"));
    h.startprob_    = getVec<double>(j.at("startprob"));
    for (const auto& row : j.at("transmat")) h.transmat_.push_back(getVec<double>(row));
    for (const auto& row : j.at("means"))    h.means_.push_back(getVec<double>(row));

    std::vector<std::vector<std::vector<double>>> covars;
    for (const auto& mat : j.at("covars")) {
        std::vector<std::vector<double>> m;
        for (const auto& row : mat) m.push_back(getVec<double>(row));
        covars.push_back(m);
    }

    const int n = h.n_states_, k = h.n_features_;
    if (static_cast<int>(h.startprob_.size()) != n ||
        static_cast<int>(h.transmat_.size()) != n ||
        static_cast<int>(h.means_.size()) != n ||
        static_cast<int>(covars.size()) != n ||
        static_cast<int>(h.scaler_mean_.size()) != k ||
        static_cast<int>(h.scaler_scale_.size()) != k)
        throw std::runtime_error("HMMRegime: parameter dimension mismatch");

    h.precompute(covars);
    return h;
}

void HMMRegime::precompute(
    const std::vector<std::vector<std::vector<double>>>& covars) {
    const int n = n_states_, k = n_features_;
    inv_cov_.resize(n);
    log_norm_const_.resize(n);
    for (int s = 0; s < n; ++s) {
        double log_det = 0.0;
        inv_cov_[s] = invertWithLogDet(covars[s], log_det);
        // log of the Gaussian normalization: -0.5*(k*log(2pi) + log|Sigma|)
        log_norm_const_[s] = -0.5 * (k * kLog2Pi + log_det);
    }
}

double HMMRegime::logEmission(int state, const std::vector<double>& z) const {
    const int k = n_features_;
    // Mahalanobis: (z-mu)^T Sigma^-1 (z-mu)
    std::vector<double> d(k);
    for (int i = 0; i < k; ++i) d[i] = z[i] - means_[state][i];
    double quad = 0.0;
    for (int i = 0; i < k; ++i) {
        double row = 0.0;
        for (int jj = 0; jj < k; ++jj) row += inv_cov_[state][i][jj] * d[jj];
        quad += d[i] * row;
    }
    return log_norm_const_[state] - 0.5 * quad;
}

int HMMRegime::observeDay(const std::vector<double>& raw_features) {
    const int n = n_states_, k = n_features_;
    if (static_cast<int>(raw_features.size()) != k)
        throw std::runtime_error("HMMRegime: feature-count mismatch");

    // Standardize with the fit-time scaler.
    std::vector<double> z(k);
    for (int i = 0; i < k; ++i) {
        const double sc = scaler_scale_[i] == 0.0 ? 1.0 : scaler_scale_[i];
        z[i] = (raw_features[i] - scaler_mean_[i]) / sc;
    }

    std::vector<double> next(n);
    if (!started_) {
        for (int s = 0; s < n; ++s)
            next[s] = std::log(std::max(startprob_[s], 1e-300)) + logEmission(s, z);
        started_ = true;
    } else {
        for (int sj = 0; sj < n; ++sj) {
            std::vector<double> terms(n);
            for (int si = 0; si < n; ++si)
                terms[si] = logalpha_[si] +
                            std::log(std::max(transmat_[si][sj], 1e-300));
            next[sj] = logSumExp(terms) + logEmission(sj, z);
        }
    }
    logalpha_ = next;

    int best = 0;
    for (int s = 1; s < n; ++s) if (logalpha_[s] > logalpha_[best]) best = s;
    current_ = best;
    return current_;
}

void HMMRegime::reset() {
    logalpha_.clear();
    started_ = false;
    current_ = 0;
}

}  // namespace hermes
