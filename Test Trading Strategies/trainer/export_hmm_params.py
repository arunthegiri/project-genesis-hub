"""export_hmm_params.py — reproduce FirstRRC.ipynb Section 6 HMM fit standalone
and write hmm_params.json for Hermes (HMMRegime.cpp).

Why standalone: the notebook's cell-27 export needs `hmm`, `scaler`, `HMM_FEATS`
live in a kernel that has run Section 6. This script reproduces cells 12/14
(prep + 5-symbol merge) and cell 25 (daily NVDA features + GaussianHMM fit)
EXACTLY, then writes the same JSON schema.

Fidelity guard: rf_v1 was trained on feat_clean whose `hmm_regime` column came
from THIS fit. The regime *labels* (0..3) are only meaningful if the re-fit
reproduces the same numbering. So this script broadcasts its day-regimes back to
every bar and asserts a near-perfect match against feat_clean's hmm_regime
before writing anything. If the data or fit had drifted, the assert trips.

Data source: TimescaleDB stock_prices (the same bars get_data() serves), sliced
to the notebook's window. Run in the `base` conda env (same hmmlearn 0.3.3 /
sklearn 1.8.0 the notebook used).
"""
import json
import sys

import numpy as np
import pandas as pd
from sqlalchemy import create_engine, text
from sklearn.preprocessing import StandardScaler
from hmmlearn.hmm import GaussianHMM

# ── Constants, verbatim from the notebook (cells 2/3/25) ─────────────────────
RANDOM_SEED = 42
START, END = "2020-07-27", "2026-06-04"          # cell 3 window
SYMS = ["nvda", "amd", "spy", "tsla", "msft"]     # cell 14 order (dict order)
OHLCV = ["open", "high", "low", "close", "volume"]
HMM_FEATS = ["rvol", "ret", "vol_ratio"]
SPLIT_RET = 0.40
DSN = "postgresql+psycopg2://postgres:postgres@localhost:5432/stockdb"
FEAT_CLEAN = sys.argv[1] if len(sys.argv) > 1 else \
    "/private/tmp/claude-501/-Users-phantom-Quant-Anake/8b22bfe1-fdc9-49b6-9a41-e985b1b854b7/scratchpad/data/feat_clean_full.parquet"
OUT = sys.argv[2] if len(sys.argv) > 2 else "/tmp/hmm_params.json"


def load_symbol(engine, sym):
    """Pull one symbol's 1-min bars as a get_data()-shaped frame: UTC
    DatetimeIndex, lowercase OHLCV. Window END is exclusive (matches the
    notebook's data ending 2026-06-03)."""
    q = text(
        "select time, open, high, low, close, volume from stock_prices "
        "where symbol = :s and time >= :a and time < :b order by time"
    )
    df = pd.read_sql(q, engine, params={"s": sym.upper(), "a": START, "b": END},
                     parse_dates={"time": {"utc": True}})
    df = df.set_index("time").sort_index()
    df = df[~df.index.duplicated(keep="first")]   # cell 12/14 dedup
    return df[OHLCV]


def build_merged(dfs):
    """cell 14: outer-join all symbols, ffill<=5, anchor on NVDA."""
    merged = None
    for sym in SYMS:                                   # preserve cell-14 order
        renamed = dfs[sym].rename(columns={c: f"{sym}_{c}" for c in OHLCV})
        merged = renamed if merged is None else merged.join(renamed, how="outer")
    merged = merged.sort_index()
    for sym in SYMS:
        cols = [f"{sym}_{c}" for c in OHLCV]
        merged[cols] = merged[cols].ffill(limit=5)
    merged = merged.dropna(subset=[f"nvda_{c}" for c in OHLCV])
    return merged


def fit_hmm(merged):
    """cell 25: daily NVDA features + 4-state GaussianHMM."""
    c_ = merged["nvda_close"].astype(float)
    v_ = merged["nvda_volume"].astype(float)
    dk = merged.index.normalize()
    r1 = np.log(c_ / c_.shift(1))

    daily_close = c_.groupby(dk).last()
    daily = pd.DataFrame({
        "ret":  np.log(daily_close / daily_close.shift(1)),
        "rvol": r1.groupby(dk).std(),                 # ddof=1
        "dvol": v_.groupby(dk).sum(),
    })
    daily["vol_ratio"] = daily["dvol"] / daily["dvol"].rolling(20, min_periods=1).mean()

    split_days = daily.index[daily["ret"].abs() > SPLIT_RET]
    print(f"Excluding {len(split_days)} split/anomaly day(s): "
          f"{[str(d.date()) for d in split_days]}")
    daily_fit = daily.loc[~daily.index.isin(split_days), HMM_FEATS].dropna()
    print(f"Daily observations for HMM : {daily_fit.shape}  "
          f"{daily_fit.index.min().date()} -> {daily_fit.index.max().date()}")

    scaler = StandardScaler()
    X = scaler.fit_transform(daily_fit.values)
    hmm = GaussianHMM(n_components=4, covariance_type="full",
                      n_iter=500, tol=1e-4, random_state=RANDOM_SEED)
    hmm.fit(X)
    states = hmm.predict(X)
    daily_regime = pd.Series(states, index=daily_fit.index, name="hmm_regime")
    print(f"Converged: {hmm.monitor_.converged}   iters: {len(hmm.monitor_.history)}   "
          f"log-likelihood: {hmm.score(X):,.0f}")
    return hmm, scaler, daily_regime


def validate_against_feat_clean(daily_regime):
    """The correctness gate: broadcast day-regime to every feat_clean bar and
    compare with the hmm_regime the model was actually trained on."""
    feat = pd.read_parquet(FEAT_CLEAN, columns=["hmm_regime"])
    day = feat.index.normalize()
    mapped = pd.Series(day.map(daily_regime), index=feat.index)
    both = pd.DataFrame({"trained": feat["hmm_regime"].astype("Int64"),
                         "refit": mapped.astype("Int64")}).dropna()
    match = (both["trained"] == both["refit"]).mean()
    print(f"\nfeat_clean bars compared : {len(both):,} / {len(feat):,}")
    print(f"regime-label match rate  : {match:.4%}")
    # Per-label confusion (should be near-diagonal / identity permutation).
    conf = pd.crosstab(both["trained"], both["refit"])
    print("confusion (trained rows x refit cols):")
    print(conf.to_string())
    return match


def main():
    engine = create_engine(DSN)
    print("Loading 5 symbols from TimescaleDB ...")
    dfs = {s: load_symbol(engine, s) for s in SYMS}
    for s in SYMS:
        d = dfs[s]
        print(f"  {s:4s} shape={d.shape}  {d.index.min().date()} -> {d.index.max().date()}")
    merged = build_merged(dfs)
    print(f"merged shape : {merged.shape}  {merged.index.min()} -> {merged.index.max()}")

    hmm, scaler, daily_regime = fit_hmm(merged)

    match = validate_against_feat_clean(daily_regime)
    if match < 0.99:
        print(f"\nABORT: match rate {match:.4%} < 99% — the re-fit does NOT "
              "reproduce the hmm_regime baked into feat_clean/rf_v1. Not writing "
              "hmm_params.json (would give Hermes inconsistent regime labels).")
        sys.exit(1)

    params = {
        "n_states": int(hmm.n_components),
        "feature_order": list(HMM_FEATS),
        "scaler_mean": scaler.mean_.tolist(),
        "scaler_scale": scaler.scale_.tolist(),
        "startprob": hmm.startprob_.tolist(),
        "transmat": hmm.transmat_.tolist(),
        "means": hmm.means_.tolist(),
        "covars": [c.tolist() for c in hmm.covars_],
    }
    n, k = hmm.n_components, len(HMM_FEATS)
    assert len(params["startprob"]) == n
    assert np.array(params["transmat"]).shape == (n, n)
    assert np.array(params["means"]).shape == (n, k)
    assert np.array(params["covars"]).shape == (n, k, k)
    assert len(params["scaler_mean"]) == k and len(params["scaler_scale"]) == k

    with open(OUT, "w") as f:
        json.dump(params, f, indent=2)
    print(f"\nWrote {OUT}  ({n} states, {k} features: {HMM_FEATS})  "
          f"match={match:.4%}")


if __name__ == "__main__":
    main()
