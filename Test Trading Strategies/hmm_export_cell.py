"""HMM export cell — paste into FirstRRC.ipynb AFTER Cell 25 (the GaussianHMM
fit), where `hmm`, `scaler`, and `HMM_FEATS` are in scope.

Writes hmm_params.json, the artifact the Hermes C++ engine (HMMRegime) loads to
assign the current trading day's regime live. Upload it alongside the model:

    gs://{ANANKE_GCS_BUCKET}/ananke/v1/hmm_params.json

then, per the build doc Section 4:

    gcloud storage cp gs://.../hmm_params.json hermes/configs/hmm_params.json

Schema (consumed by hermes/src/engine/HMMRegime.cpp):
    n_states       : int                      (4)
    feature_order  : [str]  == HMM_FEATS      (["rvol","ret","vol_ratio"])
    scaler_mean    : [k]    StandardScaler.mean_
    scaler_scale   : [k]    StandardScaler.scale_
    startprob      : [n]    hmm.startprob_
    transmat       : [n][n] hmm.transmat_
    means          : [n][k] hmm.means_        (in standardized space)
    covars         : [n][k][k] full covariances

IMPORTANT: `hmm` was fit on scaler.transform(daily_fit[HMM_FEATS]) — i.e. the
means/covars live in STANDARDIZED space. HMMRegime standardizes each live daily
feature vector with scaler_mean/scaler_scale before scoring, so the two match.
The daily features Hermes must compute per trading day, in feature_order:
    rvol      = std (ddof=1) of the day's 1-min log returns
    ret       = log(daily_close[t] / daily_close[t-1])   (close-to-close)
    vol_ratio = day_volume / rolling-20-day mean day_volume (min_periods=1)
"""
import json
import numpy as np

hmm_params = {
    "n_states": int(hmm.n_components),
    "feature_order": list(HMM_FEATS),                       # ["rvol","ret","vol_ratio"]
    "scaler_mean": scaler.mean_.tolist(),
    "scaler_scale": scaler.scale_.tolist(),
    "startprob": hmm.startprob_.tolist(),
    "transmat": hmm.transmat_.tolist(),
    "means": hmm.means_.tolist(),
    "covars": [c.tolist() for c in hmm.covars_],            # full covariance_type
}

# Sanity: dimensions line up (n states, k features).
_n, _k = hmm.n_components, len(HMM_FEATS)
assert len(hmm_params["startprob"]) == _n
assert np.array(hmm_params["transmat"]).shape == (_n, _n)
assert np.array(hmm_params["means"]).shape == (_n, _k)
assert np.array(hmm_params["covars"]).shape == (_n, _k, _k)
assert len(hmm_params["scaler_mean"]) == _k

with open("/tmp/hmm_params.json", "w") as f:
    json.dump(hmm_params, f, indent=2)
print(f"Wrote /tmp/hmm_params.json  ({_n} states, {_k} features: {HMM_FEATS})")

# Optional: upload next to the model artifacts.
# import gcsfs, os
# bucket = os.environ["ANANKE_GCS_BUCKET"]
# gcsfs.GCSFileSystem().put("/tmp/hmm_params.json",
#                           f"{bucket}/ananke/v1/hmm_params.json")
