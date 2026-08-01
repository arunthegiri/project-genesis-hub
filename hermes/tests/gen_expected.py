#!/usr/bin/env python
"""Generate a deterministic OHLCV fixture and the ground-truth feature values
at the last bar, for the C++ FeatureCalculator parity test.

The expected values replicate the EXACT pandas formulas used to build the
training feature store (FirstRRC.ipynb, Section 3 / Cell 16). The C++
FeatureCalculator must reproduce every one on the same bars.

Fixture: 3 UTC calendar days x 60 one-minute bars, with a genuine overnight
gap between days so the day-relative features (overnight_gap, min_since_open,
vwap_z) are exercised. Companion SPY/AMD close series are emitted 1:1 with the
primary bars for the cross-asset features.

Writes tests/feature_fixture.json:
  { "bars": [...], "spy": [...], "amd": [...], "expected": {...} }

Run with a python that has pandas/numpy. The Ananke SDK is imported from
../../ananke-sdk.
"""
import json
import os
import sys
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
SDK = os.path.normpath(os.path.join(HERE, "..", "..", "ananke-sdk"))
sys.path.insert(0, SDK)

from ananke import indicators as ind  # noqa: E402

# ---------------------------------------------------------------------------
# Deterministic OHLCV: seeded random walk over 3 UTC days (60 bars each).
# Each new day opens with a gap vs the prior day's last close.
# ---------------------------------------------------------------------------
rng = np.random.default_rng(42)
DAYS = 3
PER_DAY = 60
n = DAYS * PER_DAY

close = np.empty(n)
level = 100.0
for i in range(n):
    if i % PER_DAY == 0 and i > 0:
        level += rng.normal(0.0, 1.5)   # overnight gap kick
    level += rng.normal(0.0, 0.5)
    close[i] = level

day0 = datetime(2024, 1, 2, 14, 30, tzinfo=timezone.utc)  # Tue 09:30 ET
day_starts = [day0 + timedelta(days=d) for d in range(DAYS)]

def build(series, vol_seed):
    bars = []
    for i in range(n):
        d, m = divmod(i, PER_DAY)
        t = day_starts[d] + timedelta(minutes=m)
        c = float(series[i])
        # first bar of a day opens at its own close (gap already in `series`);
        # subsequent bars open at the prior bar's close.
        o = c if m == 0 else float(series[i - 1])
        spread = abs(float(series[i] - series[i - 1])) + 0.2 if i > 0 else 0.3
        high = max(o, c) + spread
        low = min(o, c) - spread
        vol = float(1000 + ((i * vol_seed) % 500))
        bars.append({"t": int(t.timestamp()), "open": o, "high": high,
                     "low": low, "close": c, "volume": vol})
    return bars

bars = build(close, 37)

# Companion series (SPY, AMD): independent seeded walks, aligned 1:1.
spy_close = 400.0 + np.cumsum(rng.normal(0.0, 0.4, size=n))
amd_close = 150.0 + np.cumsum(rng.normal(0.0, 0.3, size=n))
spy = build(spy_close, 53)
amd = build(amd_close, 71)

# ---------------------------------------------------------------------------
# DataFrame + notebook feature formulas (Cell 16).
# ---------------------------------------------------------------------------
df = pd.DataFrame(bars)
df.index = pd.to_datetime(df["t"], unit="s", utc=True)
o, h, l, c, v = (df["open"], df["high"], df["low"], df["close"], df["volume"])
nvda_df = pd.DataFrame({"open": o, "high": h, "low": l, "close": c, "volume": v})
day_key = df.index.normalize()
logret1 = np.log(c / c.shift(1))
spy_c = pd.Series(spy_close, index=df.index)
amd_c = pd.Series(amd_close, index=df.index)
spy_ret = np.log(spy_c / spy_c.shift(1))

f = {}
# PRICE
for k in (1, 5, 15, 30, 60):
    f[f"logret_{k}"] = np.log(c / c.shift(k))
for w in (5, 10, 20, 60):
    f[f"vol_{w}"] = logret1.rolling(w).std()
day_first_open = o.groupby(day_key).transform("first")
prev_close_byday = c.groupby(day_key).last().shift(1)
prev_close_row = pd.Series(day_key, index=df.index).map(prev_close_byday)
f["overnight_gap"] = day_first_open / prev_close_row - 1.0
f["intraday_range"] = (h - l) / o
# MOMENTUM
f["rsi_7"], f["rsi_14"], f["rsi_21"] = ind.rsi(c, 7), ind.rsi(c, 14), ind.rsi(c, 21)
for k in (5, 15, 30):
    f[f"roc_{k}"] = (c / c.shift(k) - 1.0) * 100
ll14, hh14 = l.rolling(14).min(), h.rolling(14).max()
stoch_k = 100 * (c - ll14) / (hh14 - ll14)
f["stoch_k"] = stoch_k
f["stoch_d"] = stoch_k.rolling(3).mean()
# TREND
for p in (9, 21, 50, 200):
    f[f"ema_{p}_dist"] = (c - ind.ema(c, p)) / ind.ema(c, p)
_m = ind.macd(c, 12, 26, 9)
f["macd_line"], f["macd_signal"] = _m["macd"], _m["signal"]
f["macd_hist"] = _m["histogram"]
f["macd_hist_slope"] = _m["histogram"].diff()
prev_c = c.shift(1)
tr = pd.concat([(h - l), (h - prev_c).abs(), (l - prev_c).abs()], axis=1).max(axis=1)
up_move, down_move = h.diff(), -l.diff()
plus_dm = up_move.where((up_move > down_move) & (up_move > 0), 0.0)
minus_dm = down_move.where((down_move > up_move) & (down_move > 0), 0.0)
atr_w = tr.ewm(alpha=1 / 14, adjust=False).mean()
plus_di = 100 * plus_dm.ewm(alpha=1 / 14, adjust=False).mean() / atr_w
minus_di = 100 * minus_dm.ewm(alpha=1 / 14, adjust=False).mean() / atr_w
dx = 100 * (plus_di - minus_di).abs() / (plus_di + minus_di)
f["adx_14"] = dx.ewm(alpha=1 / 14, adjust=False).mean()
# MEAN REVERSION
_bb = ind.bollinger(c, 20, 2)
f["bb_pctb"] = (c - _bb["lower"]) / (_bb["upper"] - _bb["lower"])
f["bb_bandwidth"] = (_bb["upper"] - _bb["lower"]) / _bb["middle"]
f["bb_squeeze"] = (f["bb_bandwidth"] <=
                   f["bb_bandwidth"].rolling(100, min_periods=20).quantile(0.2)).astype(float)
for w in (20, 60):
    f[f"zscore_{w}"] = (c - c.rolling(w).mean()) / c.rolling(w).std()
_vw = ind.vwap(nvda_df)
f["dist_vwap"] = (c - _vw) / _vw
_dev = c - _vw
_dev_std = _dev.groupby(day_key).transform(lambda s: s.expanding().std())
f["vwap_z"] = _dev / _dev_std
# VOLUME
f["vol_ratio_20"] = v / v.rolling(20).mean()
_sign = np.sign(c.diff()).fillna(0.0)
_obv = (_sign * v).cumsum()
f["obv"] = _obv
f["obv_slope"] = _obv.diff(10)
f["vwpm"] = (logret1 * v).rolling(20).sum() / v.rolling(20).sum()
_mfm = ((c - l) - (h - c)) / (h - l).replace(0, np.nan)
_adl = (_mfm * v).fillna(0.0).cumsum()
f["adl"] = _adl
f["adl_slope"] = _adl.diff(10)
# CROSS-ASSET
f["beta_spy_20"] = logret1.rolling(20).cov(spy_ret) / spy_ret.rolling(20).var()
f["corr_spy_20"] = logret1.rolling(20).corr(spy_ret)
f["relstr_amd_20"] = (c / amd_c).pct_change(20)
# TIME
idx = df.index
_hour = idx.hour + idx.minute / 60.0
f["hour_sin"] = pd.Series(np.sin(2 * np.pi * _hour / 24), index=idx)
f["hour_cos"] = pd.Series(np.cos(2 * np.pi * _hour / 24), index=idx)
_dow = idx.dayofweek
f["dow_sin"] = pd.Series(np.sin(2 * np.pi * _dow / 7), index=idx)
f["dow_cos"] = pd.Series(np.cos(2 * np.pi * _dow / 7), index=idx)
_t = pd.Series(idx, index=idx)
_min_open = (_t - _t.groupby(day_key).transform("first")).dt.total_seconds() / 60.0
f["min_since_open"] = _min_open
f["min_to_close"] = 390 - _min_open
f["last_30_flag"] = (_min_open > 360).astype(float)

expected = {k: float(s.iloc[-1]) for k, s in f.items()}

out = {"bars": bars, "spy": spy, "amd": amd, "expected": expected}
path = os.path.join(HERE, "feature_fixture.json")
with open(path, "w") as fh:
    json.dump(out, fh, indent=2)

print(f"Wrote {path} ({n} bars, {len(expected)} features)")
for k in sorted(expected):
    print(f"  {k:16s} = {expected[k]:.10f}")
