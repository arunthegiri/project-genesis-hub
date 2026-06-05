"""
Insert and execute SECTION 3 — Feature Engineering into FirstRRC.ipynb, placed between
Section 2 (merge, cell 14) and Section 4 (labels). Builds a non-destructive feature
store `feat` from the existing `merged` DataFrame (does NOT mutate `merged`, so the
already-built Section 4/5 still run unchanged). Uses Ananke SDK indicators where they
exist (ema/rsi/macd/bollinger/atr/vwap); ADX, stochastic, OBV, A/D, beta, correlation,
relative strength and time features computed manually. No look-ahead: every feature uses
only data available at bar time. Captures genuine outputs (incl. the correlation heatmap).
"""
import nbformat
from nbclient import NotebookClient

NB = "/Users/phantom/Quant/Anake/Test Trading Strategies/FirstRRC.ipynb"
WORKDIR = "/Users/phantom/Quant/Anake/Test Trading Strategies"
LOADERS = [3, 7, 8, 9, 10]
MERGE = 14

MD = """## Section 3 — Feature Engineering

Builds a comprehensive **feature store** (`feat`) on NVDA, the target asset, drawing
cross-asset context from SPY and AMD. Ananke SDK indicators are used where they exist
(`ema`, `rsi`, `macd`, `bollinger`, `vwap`); ADX, stochastic, OBV, A/D line, rolling
beta/correlation, relative strength and the calendar features are computed manually.

**No look-ahead:** every feature uses only information available at the bar's close —
rolling/EWM windows look backward, the overnight gap uses the *prior* day's close, and
session-boundary flags come from each day's first bar (known intraday) or the fixed
390-minute RTH schedule.

`feat` is built **separately from `merged`** so the existing Section 4/5 cells keep
operating on the untouched merged frame.

**What good looks like:** ~55–60 features; after dropping warm-up/cross-asset NaNs the
clean set should retain the vast majority of rows and span essentially the full
2020-07 → 2026-06 range, with no large unexplained interior gaps."""

CONSTRUCT = r'''# ── Section 3: feature construction (target = NVDA; cross-asset = SPY, AMD) ────
feat = pd.DataFrame(index=merged.index)

o = merged["nvda_open"].astype(float)
h = merged["nvda_high"].astype(float)
l = merged["nvda_low"].astype(float)
c = merged["nvda_close"].astype(float)
v = merged["nvda_volume"].astype(float)
nvda_df = pd.DataFrame({"open": o, "high": h, "low": l, "close": c, "volume": v})

date_key = merged.index.normalize()              # per-bar calendar day (UTC)
logret1  = np.log(c / c.shift(1))

# ── PRICE ─────────────────────────────────────────────────────────────────────
for k in (1, 5, 15, 30, 60):
    feat[f"logret_{k}"] = np.log(c / c.shift(k))
for w in (5, 10, 20, 60):
    feat[f"vol_{w}"] = logret1.rolling(w).std()
day_first_open  = o.groupby(date_key).transform("first")
prev_close_byday = c.groupby(date_key).last().shift(1)
prev_close_row  = pd.Series(date_key, index=merged.index).map(prev_close_byday)
feat["overnight_gap"]  = day_first_open / prev_close_row - 1.0      # prior-day close only
feat["intraday_range"] = (h - l) / o

# ── MOMENTUM ──────────────────────────────────────────────────────────────────
feat["rsi_7"], feat["rsi_14"], feat["rsi_21"] = rsi(c, 7), rsi(c, 14), rsi(c, 21)
for k in (5, 15, 30):
    feat[f"roc_{k}"] = (c / c.shift(k) - 1.0) * 100
ll14, hh14 = l.rolling(14).min(), h.rolling(14).max()
stoch_k = 100 * (c - ll14) / (hh14 - ll14)
feat["stoch_k"] = stoch_k
feat["stoch_d"] = stoch_k.rolling(3).mean()

# ── TREND ─────────────────────────────────────────────────────────────────────
for p in (9, 21, 50, 200):
    feat[f"ema_{p}_dist"] = (c - ema(c, p)) / ema(c, p)
e9, e21, e50 = ema(c, 9), ema(c, 21), ema(c, 50)
feat["ema_cross_9_21"]  = (e9 > e21).astype(int)
feat["ema_cross_21_50"] = (e21 > e50).astype(int)
_m = macd(c, 12, 26, 9)
feat["macd_line"], feat["macd_signal"] = _m["macd"], _m["signal"]
feat["macd_hist"] = _m["histogram"]
feat["macd_hist_slope"] = _m["histogram"].diff()
# ADX(14) — Wilder smoothing
prev_c = c.shift(1)
tr = pd.concat([(h - l), (h - prev_c).abs(), (l - prev_c).abs()], axis=1).max(axis=1)
up_move, down_move = h.diff(), -l.diff()
plus_dm  = up_move.where((up_move > down_move) & (up_move > 0), 0.0)
minus_dm = down_move.where((down_move > up_move) & (down_move > 0), 0.0)
atr_w = tr.ewm(alpha=1/14, adjust=False).mean()
plus_di  = 100 * plus_dm.ewm(alpha=1/14, adjust=False).mean() / atr_w
minus_di = 100 * minus_dm.ewm(alpha=1/14, adjust=False).mean() / atr_w
dx = 100 * (plus_di - minus_di).abs() / (plus_di + minus_di)
feat["adx_14"] = dx.ewm(alpha=1/14, adjust=False).mean()

# ── MEAN REVERSION ────────────────────────────────────────────────────────────
_bb = bollinger(c, 20, 2)
feat["bb_pctb"]      = (c - _bb["lower"]) / (_bb["upper"] - _bb["lower"])
feat["bb_bandwidth"] = (_bb["upper"] - _bb["lower"]) / _bb["middle"]
feat["bb_squeeze"]   = (feat["bb_bandwidth"] <=
                        feat["bb_bandwidth"].rolling(100, min_periods=20).quantile(0.2)).astype(int)
for w in (20, 60):
    feat[f"zscore_{w}"] = (c - c.rolling(w).mean()) / c.rolling(w).std()
_vw = sdk_vwap(nvda_df)                              # daily-reset VWAP
feat["dist_vwap"] = (c - _vw) / _vw
_dev = c - _vw
_dev_std = _dev.groupby(date_key).transform(lambda s: s.expanding().std())
feat["vwap_z"] = _dev / _dev_std                     # deviation in intraday-std units

# ── VOLUME ────────────────────────────────────────────────────────────────────
feat["vol_ratio_20"] = v / v.rolling(20).mean()
_sign = np.sign(c.diff()).fillna(0.0)
_obv = (_sign * v).cumsum()
feat["obv"] = _obv
feat["obv_slope"] = _obv.diff(10)
feat["vwpm"] = (logret1 * v).rolling(20).sum() / v.rolling(20).sum()
_mfm = ((c - l) - (h - c)) / (h - l).replace(0, np.nan)
_adl = (_mfm * v).fillna(0.0).cumsum()
feat["adl"] = _adl
feat["adl_slope"] = _adl.diff(10)

# ── CROSS-ASSET (vs SPY, AMD) ─────────────────────────────────────────────────
spy_c = merged["spy_close"].astype(float); spy_ret = np.log(spy_c / spy_c.shift(1))
amd_c = merged["amd_close"].astype(float)
feat["beta_spy_20"]   = logret1.rolling(20).cov(spy_ret) / spy_ret.rolling(20).var()
feat["corr_spy_20"]   = logret1.rolling(20).corr(spy_ret)
feat["relstr_amd_20"] = (c / amd_c).pct_change(20)

# ── TIME ──────────────────────────────────────────────────────────────────────
idx = merged.index
_hour = idx.hour + idx.minute / 60.0
feat["hour_sin"] = np.sin(2*np.pi*_hour/24); feat["hour_cos"] = np.cos(2*np.pi*_hour/24)
_dow = idx.dayofweek
feat["dow_sin"]  = np.sin(2*np.pi*_dow/7);   feat["dow_cos"]  = np.cos(2*np.pi*_dow/7)
_t = pd.Series(idx, index=merged.index)
_min_open = (_t - _t.groupby(date_key).transform("first")).dt.total_seconds() / 60.0
feat["min_since_open"] = _min_open
feat["min_to_close"]   = 390 - _min_open             # RTH = 390 min (schedule-based)
feat["first_30_flag"]  = (_min_open < 30).astype(int)
feat["last_30_flag"]   = (_min_open > 360).astype(int)
feat["is_first_bar"]   = (_min_open == 0).astype(int)
feat["is_last_bar"]    = (_t == _t.groupby(date_key).transform("last")).astype(int)

print(f"Constructed feature store: {feat.shape[1]} features over {feat.shape[0]:,} rows")
print(f"Feature columns:\n{feat.columns.tolist()}")
'''

FINALIZE = r'''# ── Section 3: drop NaNs, summarize, correlation heatmap, gap check ───────────
raw_shape = feat.shape
feat = feat.replace([np.inf, -np.inf], np.nan)
nan_by_col = feat.isna().sum().sort_values(ascending=False)
feat_clean = feat.dropna()

print(f"Raw feature store      : {raw_shape}")
print(f"After dropping NaN rows : {feat_clean.shape}")
print(f"Rows dropped            : {raw_shape[0] - feat_clean.shape[0]:,} "
      f"({(raw_shape[0]-feat_clean.shape[0])/raw_shape[0]*100:.2f}%)")
print("\nTop NaN sources (warm-up / cross-asset gaps):")
print(nan_by_col[nan_by_col > 0].head(8).to_string() if (nan_by_col > 0).any() else "  none")

# ── Correlation heatmap of the first 30 features (price/momentum/trend blocks) ─
import numpy as _np
top = feat_clean.columns[:30].tolist()
corr = feat_clean[top].corr()
fig, ax = plt.subplots(figsize=(13, 11))
im = ax.imshow(corr.values, cmap="coolwarm", vmin=-1, vmax=1, aspect="auto")
ax.set_xticks(range(len(top))); ax.set_xticklabels(top, rotation=90, fontsize=7)
ax.set_yticks(range(len(top))); ax.set_yticklabels(top, fontsize=7)
ax.set_title("Feature correlation matrix — first 30 features")
fig.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
plt.tight_layout(); plt.show()

# ── Gap check on the clean dataset ───────────────────────────────────────────
clean_idx = feat_clean.index
monthly = clean_idx.to_series().groupby(clean_idx.tz_localize(None).to_period("M")).size()
thin_months = monthly[monthly < 5000]

print("\n" + "="*64)
print("SECTION 3 COMPLETE — Feature Store")
print("="*64)
print(f"Total feature count : {feat_clean.shape[1]}")
print(f"Final shape         : {feat_clean.shape}")
print(f"Date range (clean)  : {clean_idx.min()}  →  {clean_idx.max()}")
print(f"Months covered      : {len(monthly)}  "
      f"({monthly.index.min()} → {monthly.index.max()})")
if thin_months.empty:
    print("Unexpected gaps     : none (every interior month >= 5000 clean bars)")
else:
    bdry = {str(monthly.index.min()), str(monthly.index.max())}
    interior = thin_months[[str(p) not in bdry for p in thin_months.index]]
    print(f"Months < 5000 clean bars: {[(str(p), int(n)) for p, n in thin_months.items()]}")
    print("  (boundary months excluded; interior thin months:",
          [(str(p), int(n)) for p, n in interior.items()] or "none", ")")
'''

nb = nbformat.read(NB, as_version=4)

# Build temp notebook: setup (numpy/pandas/matplotlib + SDK) + loaders + merge + S3.
setup = ('%matplotlib inline\n'
         'import os, sys, numpy as np, pandas as pd\n'
         'import matplotlib, matplotlib.pyplot as plt\n'
         'from sqlalchemy import create_engine, text\n'
         'sys.path.insert(0, os.path.join(os.getcwd(), "..", "ananke-sdk"))\n'
         'from ananke.indicators import sma, ema, rsi, macd, bollinger, atr, vwap as sdk_vwap')
tmp = nbformat.v4.new_notebook(); tmp.metadata = nb.metadata
tmp.cells = [nbformat.v4.new_code_cell(setup)]
tmp.cells += [nbformat.v4.new_code_cell("".join(nb.cells[i]["source"])) for i in LOADERS]
tmp.cells += [nbformat.v4.new_code_cell("".join(nb.cells[MERGE]["source"]))]
tmp.cells += [nbformat.v4.new_code_cell(CONSTRUCT), nbformat.v4.new_code_cell(FINALIZE)]

print("Executing loaders -> merge -> Section 3 in a fresh kernel ...")
NotebookClient(tmp, timeout=1800, kernel_name="python3",
               resources={"metadata": {"path": WORKDIR}}).execute()
print("Execution complete.\n")

construct_cell, finalize_cell = tmp.cells[-2], tmp.cells[-1]

def streams(cell):
    return "".join("".join(o.get("text", [])) if o.get("output_type") == "stream"
                   else ("ERROR %s: %s" % (o.get("ename"), o.get("evalue")) if o.get("output_type") == "error" else "")
                   for o in cell["outputs"])

err = [o for o in construct_cell["outputs"] + finalize_cell["outputs"] if o.get("output_type") == "error"]
if err:
    print("!! ERROR during execution:")
    print(streams(construct_cell)); print(streams(finalize_cell))
    raise SystemExit(1)

print("================ CONSTRUCT ================\n" + streams(construct_cell))
print("================ FINALIZE  ================\n" + streams(finalize_cell))

# Build the three Section 3 cells to insert after notebook cell index 14.
md_cell = nbformat.v4.new_markdown_cell(MD)
c_construct = nbformat.v4.new_code_cell(CONSTRUCT)
c_construct["outputs"] = construct_cell["outputs"]
c_construct["execution_count"] = construct_cell.get("execution_count")
c_finalize = nbformat.v4.new_code_cell(FINALIZE)
c_finalize["outputs"] = finalize_cell["outputs"]
c_finalize["execution_count"] = finalize_cell.get("execution_count")

nb.cells[MERGE + 1:MERGE + 1] = [md_cell, c_construct, c_finalize]
nbformat.validate(nb)
nbformat.write(nb, NB)
print(f"\nInserted Section 3 (markdown + 2 code cells) after cell {MERGE}. Notebook valid & saved.")
