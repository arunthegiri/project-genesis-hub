#!/usr/bin/env python
"""Generate a deterministic OHLCV fixture and the Ananke-SDK ground-truth
feature values at the last bar, for the C++ FeatureCalculator test.

Writes tests/feature_fixture.json: { "bars": [...], "expected": {...} }.

Run with the miniconda `python` (has pandas). The Ananke SDK is imported
from ../../ananke-sdk.
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
# Deterministic OHLCV: a seeded random walk over two UTC calendar days so the
# daily-reset VWAP path is exercised (60 bars on day A, 60 on day B).
# ---------------------------------------------------------------------------
rng = np.random.default_rng(42)
n = 120
steps = rng.normal(0.0, 0.5, size=n)
close = 100.0 + np.cumsum(steps)

bars = []
day_a = datetime(2024, 1, 2, 14, 30, tzinfo=timezone.utc)
day_b = datetime(2024, 1, 3, 14, 30, tzinfo=timezone.utc)
for i in range(n):
    base = day_a if i < 60 else day_b
    t = base + timedelta(minutes=(i % 60))
    c = float(close[i])
    o = float(close[i - 1]) if i > 0 else c
    spread = abs(float(steps[i])) + 0.2
    high = max(o, c) + spread
    low = min(o, c) - spread
    vol = float(1000 + (i * 37 % 500))
    bars.append({
        "t": int(t.timestamp()),
        "open": o, "high": high, "low": low, "close": c, "volume": vol,
    })

df = pd.DataFrame(bars)
df.index = pd.to_datetime(df["t"], unit="s", utc=True)

expected = {
    "rsi_14": ind.rsi(df["close"], 14),
    "ema_9": ind.ema(df["close"], 9),
    "ema_21": ind.ema(df["close"], 21),
    "sma_20": ind.sma(df["close"], 20),
    "atr_14": ind.atr(df, 14),
    "vwap_distance": (df["close"] - ind.vwap(df)) / ind.vwap(df),
}
expected = {k: float(v.iloc[-1]) for k, v in expected.items()}

# Features the SDK has no direct helper for — compute the same definitions.
expected["volume_ratio"] = float(df["volume"].iloc[-1] /
                                 df["volume"].rolling(20).mean().iloc[-1])
expected["logret_5"] = float(np.log(df["close"].iloc[-1] /
                                    df["close"].iloc[-6]))
last = df.iloc[-1]
expected["intraday_range"] = float((last["high"] - last["low"]) / last["open"])
expected["overnight_gap"] = float((last["open"] - df["close"].iloc[-2]) /
                                  df["close"].iloc[-2])

out = {"bars": bars, "expected": expected}
path = os.path.join(HERE, "feature_fixture.json")
with open(path, "w") as f:
    json.dump(out, f, indent=2)

print(f"Wrote {path} ({n} bars)")
for k, v in expected.items():
    print(f"  {k:16s} = {v:.10f}")
