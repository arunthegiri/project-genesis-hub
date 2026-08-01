#!/usr/bin/env python
"""Generate an HMM fixture + ground-truth regimes for the C++ HMMRegime test.

Mirrors hmmlearn's GaussianHMM(full covariance) emission and a causal online
forward filter (the same algorithm HMMRegime.cpp implements), computed here in
numpy. The C++ side loads the identical params + daily sequence and must return
the same per-day argmax regime.

Writes tests/hmm_fixture.json: { <hmm_params schema>, "days":[[...]],
"expected_states":[...] }.
"""
import json
import os

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
rng = np.random.default_rng(7)

N, K = 3, 3  # 3 states, 3 features (rvol, ret, vol_ratio)

# Well-separated state means (in RAW feature space), then standardized below.
raw_means = np.array([
    [0.010, -0.002, 0.9],   # calm / mild-down
    [0.025,  0.004, 1.4],   # volatile / up
    [0.040, -0.010, 2.0],   # high-vol / drawdown
])

# A scaler over some plausible daily-feature distribution.
scaler_mean = np.array([0.022, -0.001, 1.3])
scaler_scale = np.array([0.012, 0.006, 0.45])

means_std = (raw_means - scaler_mean) / scaler_scale       # standardized means

covars = np.array([np.diag([0.6, 0.6, 0.6]) + 0.05 for _ in range(N)])
# make them proper full SPD matrices with mild off-diagonal
for s in range(N):
    covars[s] = covars[s] @ covars[s].T / covars[s].shape[0] + np.eye(K) * 0.4

startprob = np.array([0.5, 0.3, 0.2])
transmat = np.array([
    [0.8, 0.15, 0.05],
    [0.1, 0.8, 0.1],
    [0.05, 0.15, 0.8],
])

# A daily sequence (RAW features) wandering across the regimes.
days = []
for s in [0, 0, 1, 1, 1, 2, 2, 1, 0, 0, 2, 2, 2, 0]:
    days.append((raw_means[s] + rng.normal(0, 0.002, size=K)).tolist())
days = np.array(days)


def log_emission(z, s):
    d = z - means_std[s]
    inv = np.linalg.inv(covars[s])
    _, logdet = np.linalg.slogdet(covars[s])
    quad = d @ inv @ d
    return -0.5 * (K * np.log(2 * np.pi) + logdet + quad)


def logsumexp(xs):
    m = np.max(xs)
    return m + np.log(np.sum(np.exp(xs - m)))


# Online forward filter (causal) — identical to HMMRegime.cpp.
expected = []
logalpha = None
for t in range(len(days)):
    z = (days[t] - scaler_mean) / scaler_scale
    if logalpha is None:
        logalpha = np.array([np.log(startprob[s]) + log_emission(z, s)
                             for s in range(N)])
    else:
        nxt = np.empty(N)
        for sj in range(N):
            terms = np.array([logalpha[si] + np.log(transmat[si][sj])
                              for si in range(N)])
            nxt[sj] = logsumexp(terms) + log_emission(z, sj)
        logalpha = nxt
    expected.append(int(np.argmax(logalpha)))

out = {
    "n_states": N,
    "feature_order": ["rvol", "ret", "vol_ratio"],
    "scaler_mean": scaler_mean.tolist(),
    "scaler_scale": scaler_scale.tolist(),
    "startprob": startprob.tolist(),
    "transmat": transmat.tolist(),
    "means": means_std.tolist(),
    "covars": [c.tolist() for c in covars],
    "days": days.tolist(),
    "expected_states": expected,
}
path = os.path.join(HERE, "hmm_fixture.json")
with open(path, "w") as f:
    json.dump(out, f, indent=2)
print(f"Wrote {path}  (states={N}, days={len(days)})")
print(f"expected_states = {expected}")
