#pragma once

#include <string>
#include <vector>

namespace hermes {

// Loads a fitted GaussianHMM (full covariance) exported from FirstRRC.ipynb
// (Batch 6) and assigns the current trading day's regime from daily NVDA
// features. Drives the hmm_regime / regime_0..2 model features.
//
// Fidelity notes:
//   - Emissions are full-covariance multivariate Gaussians, matching hmmlearn's
//     GaussianHMM(covariance_type="full"). Daily features are standardized with
//     the SAME StandardScaler (mean/scale) used at fit time before scoring.
//   - The notebook labels each day via hmm.predict (Viterbi over the full daily
//     sequence, i.e. it peeks at future days). That is not causally available
//     live, so we run an ONLINE forward filter: after each day's features the
//     current regime is argmax of the (log) forward probability. This is the
//     causal analogue; it can differ from the smoothed notebook label at regime
//     boundaries — an accepted train/serve nuance.
class HMMRegime {
public:
    HMMRegime() = default;

    // Parse an hmm_params.json artifact. Throws std::runtime_error on malformed
    // input. See "Test Trading Strategies/hmm_export_cell.py" for the schema.
    static HMMRegime fromFile(const std::string& path);
    static HMMRegime fromJsonString(const std::string& text);

    bool loaded() const { return n_states_ > 0; }
    int  nStates() const { return n_states_; }
    int  nFeatures() const { return n_features_; }
    const std::vector<std::string>& featureOrder() const { return feature_order_; }

    // Advance one trading day with RAW (unstandardized) daily features, in
    // featureOrder() order. Returns the resulting most-likely regime (0..n-1).
    int observeDay(const std::vector<double>& raw_features);

    int  currentRegime() const { return current_; }
    void reset();

private:
    int n_states_   = 0;
    int n_features_ = 0;
    std::vector<std::string> feature_order_;
    std::vector<double>      scaler_mean_;   // [k]
    std::vector<double>      scaler_scale_;  // [k]
    std::vector<double>      startprob_;     // [n]
    std::vector<std::vector<double>> transmat_;   // [n][n]
    std::vector<std::vector<double>> means_;      // [n][k] (standardized space)
    // Per-state precomputed emission constants.
    std::vector<std::vector<std::vector<double>>> inv_cov_;  // [n][k][k]
    std::vector<double> log_norm_const_;                     // [n]

    std::vector<double> logalpha_;   // running log forward probabilities [n]
    bool started_ = false;
    int  current_ = 0;

    double logEmission(int state, const std::vector<double>& z) const;
    void   precompute(const std::vector<std::vector<std::vector<double>>>& covars);
};

}  // namespace hermes
