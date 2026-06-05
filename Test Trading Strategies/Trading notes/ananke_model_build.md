# Ananke — FirstRRC Model Build Prompts
*Work through these batches in order. Complete and verify each before starting the next.*
*Tell Claude Code to read this file and start at the specified batch.*

---

## HOW TO USE
1. Open Claude Code with `claude --model claude-opus-4-8` for Batches 3-5, Sonnet for the rest
2. Start every session with: `"Read ananke_model_build.md. Read the CONTEXT section first, then execute the batch I specify. Stop at the end of that batch and summarize what was built."`
3. Verify output before moving to the next batch
4. Never skip a batch — each one feeds the next

---

## CONTEXT
*Claude Code must read this before every batch.*

**Project:** Ananke — Algorithmic Trading Development Platform  
**Developer:** Arun Thegiri  
**Goal of this notebook:** Train a production-grade ensemble trading model on 5 symbols, export to Ananke SDK, validate via simulation, then deploy through the C++ execution engine via ONNX.

**Stack:**
- Python, Jupyter Notebook, pandas, numpy, sklearn, lightgbm, hmmlearn, torch, optuna, shap
- Ananke SDK installed at: `ananke-sdk/`
- Key SDK files: `ananke/kairos.py`, `ananke/strategy.py`, `ananke/indicators.py`, `ananke/client.py`
- Data provider: Alpaca Markets API (credentials in `.env`)
- Target notebook: `FirstRRC.ipynb` (not FirstRFC — this is the correct filename)

**Symbols:** NVDA, AMD, SPY, TSLA, MSFT  
**Timeframe:** 1-minute bars, 2020-07-28 → 2026-06-03  
**Random seed:** `RANDOM_SEED = 42` — set everywhere  

**Current notebook state:**
- Section 0 — Environment setup ✅
- Section 1 — NVDA data loaded, 546,130 rows ✅
- Section 2 — All 5 symbols merged, outer join, NVDA spine, forward fill ≤5 bars ✅
- Section 3 — Feature store built ✅
  - DataFrame: `feat_clean` (567,231 rows, 61 features)
  - `merged` DataFrame untouched and available
  - Split artifact fix applied: 2021-07-20 and 2024-06-10 bars removed from `feat_clean`
- Section 4 — Triple barrier labels ✅
  - SHORT 38.4% / NEUTRAL 23.2% / LONG 38.4%
  - 588,481 labelled rows
  - `LABEL_CONFIG` dict stored
  - NOTE: label join to `feat_clean` not yet done — do this at start of Batch 4
- Section 5 — Purged walk-forward folds ✅
  - 5 folds, 60-bar purge, 60-bar embargo
  - `FOLDS` list available
  - Test months: 2026-01, 2026-02, 2026-03, 2026-04, 2026-05
- Section 6 — HMM regime detection ✅
  - 4 regimes identified and labeled:
    - Regime 0 = High-volume uptrend (19.7% of bars)
    - Regime 1 = Low-volume drift (32.8% of bars)
    - Regime 2 = Calm steady bull (35.5% of bars)
    - Regime 3 = High-vol risk-off bearish/choppy (12.0% of bars)
  - Regime 3 is the suppression regime for Batch 5
  - `feat_clean` now has `hmm_regime` + `regime_0..3` columns
  - Strong diagonal transition matrix (persistent regimes)
- Section 7 — Random Forest ⬅ NEXT (Batch 4)
- Sections 8-13 — Not yet built

**Key variables in notebook kernel:**
- `merged` — full 5-symbol OHLCV DataFrame
- `feat_clean` — feature store (567,231 × 61) including HMM regime columns
- `LABEL_CONFIG` — label parameters dict
- `FOLDS` — walk-forward fold list (5 folds)
- `RANDOM_SEED = 42`

**File output locations:**
- Models: save alongside notebook
- Artifacts: `rf_tech5_v1.pkl`, `lgbm_tech5_v1.pkl`, `lstm_tech5_v1.pt`, `ensemble_meta_tech5_v1.pkl`
- Configs: `feature_list_tech5_v1.json`, `label_config_tech5_v1.json`

**Naming convention:** `{model_type}_{universe}_{version}`
- Universe = tech5 (NVDA, AMD, SPY, TSLA, MSFT)

**Rules that apply to every batch:**
- Never shuffle time series data randomly
- No look-ahead bias — every feature uses only data available at bar time
- Add a markdown cell at the top of every section explaining what it does and what a good result looks like
- Print shape and date range after every data transformation
- If anything fails, print a descriptive error and stop cleanly — do not silently continue

---

## BATCH 1 — Data & Features
*Model: Sonnet | Sections: 0, 1, 2, 3*
*STATUS: COMPLETE ✅*

---

## BATCH 2 — Labels & Validation Setup
*Model: Sonnet | Sections: 4, 5*
*STATUS: COMPLETE ✅*

---

## BATCH 3 — Regime Detection (HMM)
*Model: Opus 4.8 | Section: 6*

Read the CONTEXT section and `FirstRRC.ipynb` before writing any code.
Batches 1 and 2 must be complete and verified.

---

### SECTION 6 — Hidden Markov Model
Use `hmmlearn` GaussianHMM to detect market regimes.

**Features for HMM (daily aggregated from 1-min):**
- Daily realized volatility
- Daily return
- Daily volume ratio

Train with `n_components=4` (4 regimes).
- Fit on full training history
- Predict regime for each day
- Map regime back to 1-min bars (all bars that day get that day's regime label)

**Visualize:**
- Plot NVDA price colored by regime
- Print transition matrix
- Print regime characteristics (mean vol, mean return, mean volume per regime)
- Manually label each regime based on characteristics — add a markdown cell with your interpretation:
  e.g. Regime 0 = low vol trending, Regime 1 = high vol choppy, etc.

Add to feature store:
- `hmm_regime` (integer 0-3)
- `regime_0`, `regime_1`, `regime_2`, `regime_3` (one-hot encoded)

**Stop here. Print:**
- Regime distribution (% of bars in each regime)
- Transition matrix
- Visual confirmation that regimes look sensible on the price chart

**Wait for confirmation before continuing.**

---

## BATCH 4 — Base Models
*Model: Opus 4.8 | Sections: 7, 8, 9*

**IMPORTANT: First action in Batch 4 is to join `merged["label"]` onto `feat_clean` by index before any model training begins.**

Read the CONTEXT section and `FirstRRC.ipynb` before writing any code.
Batches 1, 2, and 3 must be complete and verified.

---

### SECTION 7 — Baseline Random Forest
Train a RandomForestClassifier as the benchmark.

- Target: PRIMARY LABEL (3-class)
- Features: full feature store including HMM regime columns
- `class_weight='balanced'`
- `n_estimators=500, max_depth=12, min_samples_leaf=30`
- Evaluate using purged walk-forward folds from Section 5
- Print per-fold and mean: precision, recall, F1, ROC-AUC

**Feature selection via SHAP:**
- Compute SHAP values on the trained RF
- Plot SHAP summary plot (top 30 features)
- Drop features with near-zero SHAP importance (bottom 10%)
- Save reduced feature list as `feature_list_tech5_v1.json`
- All subsequent models use this reduced feature set only

---

### SECTION 8 — LightGBM
Train a LightGBM classifier on the reduced feature set.

Hyperparameter optimization with Optuna (50 trials):
- Optimize for F1 macro on walk-forward validation
- Search space:
  - num_leaves: 20-300
  - learning_rate: 0.01-0.3
  - n_estimators: 100-1000
  - min_child_samples: 20-100
  - subsample: 0.5-1.0
  - colsample_bytree: 0.5-1.0

After optimization:
- Retrain with best params
- Print walk-forward evaluation metrics
- Plot feature importance

---

### SECTION 9 — LSTM (PyTorch)
Build an LSTM to capture temporal patterns RF and LightGBM cannot see.

**Architecture:**
- Input: sequence of last 30 bars × reduced feature set
- LSTM: 2 layers, hidden_size=128, dropout=0.3
- Fully connected output: 3 classes (LONG, SHORT, NEUTRAL)
- Optimizer: Adam, lr=1e-3, weight_decay=1e-4
- Loss: CrossEntropyLoss with class weights
- Scheduler: ReduceLROnPlateau
- Early stopping: patience=10 epochs on validation F1

Plot training and validation loss curves per fold.
Print per-fold and mean metrics.
Save model as `lstm_tech5_v1.pt`.

**Stop here. Print a comparison table:**

| Model | F1 Macro | ROC-AUC | Precision | Recall |
|-------|----------|---------|-----------|--------|
| Random Forest | | | | |
| LightGBM | | | | |
| LSTM | | | | |

**Wait for confirmation before continuing.**

---

## BATCH 5 — Ensemble & Backtest
*Model: Opus 4.8 | Sections: 10, 11, 12*

Read the CONTEXT section and `FirstRRC.ipynb` before writing any code.
Batch 4 metrics must be reviewed and confirmed before running this batch.

---

### SECTION 10 — Stochastic Position Sizing (Kelly Criterion)
Given a trade signal, determine optimal position size.

For each model's signal:
- Use predicted probability as the edge estimate
- Full Kelly = (p * b - q) / b where b = reward/risk ratio (0.25/0.15)
- Use Half Kelly (multiply by 0.5) for safety
- Cap maximum position at 20% of portfolio
- Return 0 if Kelly fraction is negative

Implement as a reusable function:
```python
kelly_size(prob_long, prob_short, reward=0.25, risk=0.15) → float
```

---

### SECTION 11 — Ensemble Meta-Learner
Combine RF, LightGBM, and LSTM predictions into a final signal using stacking.

- Base model probabilities become meta-features
- Add `hmm_regime` as a meta-feature
- Train a Logistic Regression meta-learner on out-of-fold predictions only (no leakage)

**Final signal rules:**
- LONG: ensemble long probability > 0.55 AND regime is not high-vol choppy
- SHORT: ensemble short probability > 0.55 AND regime is not high-vol choppy
- NEUTRAL: everything else

Print updated comparison table including Ensemble row.

---

### SECTION 12 — Simulated Backtest
Run a realistic backtest on the full test period using the ensemble signal.

**Rules:**
- Starting capital: $100,000
- Position sizing: Kelly fraction from Section 10
- Transaction costs: $0.001 per share
- Slippage: fill at next bar open
- Max 1 open position at a time
- Stop loss: -0.15% from entry
- Take profit: +0.25% from entry
- No trading in first and last 15 minutes of session

**Track and plot:**
- Equity curve
- Drawdown curve
- Daily P&L distribution

**Print metrics:**
- Sharpe ratio (annualized)
- Sortino ratio
- Maximum drawdown
- Calmar ratio
- Win rate, average win, average loss
- Total number of trades

**Stop here. Review backtest results carefully before exporting.**  
**Wait for confirmation before continuing.**

---

## BATCH 6 — Ananke Export
*Model: Sonnet | Section: 13*

Read the CONTEXT section, `ananke-sdk/ananke/kairos.py`, `ananke-sdk/ananke/client.py`, and `FirstRRC.ipynb` before writing any code.
Batch 5 backtest must be reviewed and confirmed before running this batch.

---

### SECTION 13 — Ananke Strategy Export
Wrap the ensemble model into an Ananke Strategy using the SDK.

- Signal logic uses the ensemble from Section 11
- Position sizing uses Kelly from Section 10
- Entry/exit rules match Section 12 exactly
- Run `k.simulate()` on the test period
- Print simulation results
- Call `k.export()` with model name `ensemble_tech5_v1`

Save all artifacts:
- `rf_tech5_v1.pkl`
- `lgbm_tech5_v1.pkl`
- `lstm_tech5_v1.pt`
- `ensemble_meta_tech5_v1.pkl`
- `feature_list_tech5_v1.json` — exact ordered list of features the models expect
- `label_config_tech5_v1.json` — barrier params, thresholds, lookforward window

Print final confirmation with all exported file paths and model name.

**Pipeline complete. Ready for C++ engine deployment.**
