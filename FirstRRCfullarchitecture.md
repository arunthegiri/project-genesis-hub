# FirstRRC — Full Pipeline Architecture

How the FirstRRC model goes from a Jupyter notebook, through GCP Vertex AI training, into the Hermes C++ execution engine, and what the Ananke frontend actually touches.

> Ground truth note: this document is written from the executed notebook outputs, shell scripts, and `.last_image` — not the older docs, which drifted in places (flagged inline where relevant).

---

## 1. The big picture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ LOCAL (docker compose: timescaledb + Spring backend + Jupyter + frontend)   │
│                                                                             │
│  TimescaleDB ──► FirstRRC.ipynb ──► feat_clean.parquet + labels.parquet     │
│  (1-min bars      (feature store:                                         │
│   5 symbols)       567,181 × 61)                                          │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ gcsfs write
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ GCP (project `firstrrc`, region `us-central1`)                              │
│                                                                             │
│  gs://firstrrc-ananke-data/ananke/v1/                                       │
│       ├── feat_clean.parquet / labels.parquet   (training data)             │
│       ├── models/rf_v1.onnx                     (225 MB ONNX RandomForest)  │
│       ├── configs/rf_v1_deploy.json             (55-feature deploy contract)│
│       └── hmm_params.json                       (4-state Gaussian HMM)      │
│                                                                             │
│  Artifact Registry: us-central1-docker.pkg.dev/firstrrc/ananke-training/    │
│                     firstrrc-trainer:<tag>      (custom py3.13 image)       │
│                                                                             │
│  Vertex AI custom job `firstrrc-batch4` (c2-standard-16)                    │
│       └── runs `python -m trainer.train`  (trainer/train.py)                │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ gcloud storage cp (manual pull)
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ LOCAL SERVING (no cloud inference anywhere)                                 │
│                                                                             │
│  hermes/  (C++20 engine, ONNX Runtime 1.18, runs on host)                   │
│    models/rf_v1.onnx + configs/rf_v1_deploy.json + configs/hmm_params.json  │
│    feed (Alpaca WS) → FeatureCalculator (55 feats) → ONNX predict           │
│        → Themis risk gate → Alpaca paper orders → TimescaleDB logging       │
│                                                                             │
│  Frontend (TanStack Start) sees FirstRRC via exactly TWO bridges:           │
│    1. /backtesting → Models tab → static public/hermes/rf_v1_backtest.json  │
│    2. /models + /live → Spring /api/models|strategies (DB projection)       │
└─────────────────────────────────────────────────────────────────────────────┘
```

The defining architectural fact: **training is cloud, inference is local.** Vertex AI is used once, as a batch training job. There is no Vertex Endpoint, no online prediction service, no BigQuery, no cloudbuild/terraform anywhere in the repo. The trained model comes back as files and is served by a C++ process on the host.

---

## 2. Stage 1 — The Jupyter notebook (`Test Trading Strategies/FirstRRC.ipynb`)

Runs in the dockerized JupyterLab (host port **8890**; the compose `jupyter` service mounts `Test Trading Strategies/` and `ananke-sdk/`, with `ANANKE_API_URL=http://stock-tracker:8080`).

### 2.1 Data load
- `get_data(symbol, "2020-07-27", "2026-06-04", "1min")` from the local **Ananke SDK** (`ananke-sdk/`) for **NVDA, MSFT, AMD, TSLA, SPY**.
- `get_data` is a self-healing fetch: checks coverage in TimescaleDB (`stock_prices` hypertable), triggers one async backfill through the Spring Boot API if there are gaps, then reads. No GCS/BigQuery at this stage — the source of truth is the local TimescaleDB.

### 2.2 Merge
- Per-symbol frames cleaned (UTC index, dedup, lowercase OHLCV), then **outer-joined on timestamp** into one wide frame with prefixed columns (`nvda_close`, `spy_close`, …).
- `ffill(limit=5)` per symbol; the frame is **anchored on NVDA** (rows dropped only when NVDA itself is missing). One-hot `is_<sym>` flags added.

### 2.3 Feature engineering (Section 3 of the notebook)
Builds **56 base features** on the merged frame, reusing `ananke.indicators` where available and hand-rolled pandas semantics elsewhere:

- Returns/volatility: `logret_{1,5,15,30,60}`, `vol_{5,10,20,60}`, `overnight_gap`, `intraday_range`
- Momentum/oscillators: `rsi_{7,14,21}`, `roc_{5,15,30}`, `stoch_k/d`, MACD line/signal/hist/hist_slope
- Trend: `ema_{9,21,50,200}_dist`, `ema_cross_9_21`, `ema_cross_21_50`, `adx_14` (Wilder, `ewm(alpha=1/14)`)
- Bollinger: `bb_pctb`, `bb_bandwidth`, `bb_squeeze` (100-bar rolling 20th-percentile quantile of bandwidth)
- Mean reversion: `zscore_{20,60}`, `dist_vwap`, `vwap_z`
- Volume: `vol_ratio_20`, `obv`/`obv_slope`, `vwpm`, `adl`/`adl_slope`
- Cross-asset: `beta_spy_20`, `corr_spy_20`, `relstr_amd_20` — this is why SPY and AMD are in the universe even though only NVDA is traded
- Time: hour/DoW sin-cos, `min_since_open`, `min_to_close` (390-minute RTH), first/last-30 flags

### 2.4 Labels — triple-barrier
- On NVDA: `HORIZON=60` bars, profit-take `PT=0.0025`, stop-loss `SL=0.0015`, symmetric for long/short.
- First-touch barrier scan via a numpy loop → `label ∈ {−1 SHORT, 0 NEUTRAL, +1 LONG}`; the trailing 60 bars get NaN (no full horizon).

### 2.5 Cross-validation design — purged walk-forward
- `PURGE=60, EMBARGO=60, N_FOLDS=5`, monthly test folds, `MIN_TEST_BARS=5000` guard (NVDA has a coverage gap 2025-02 → 2026-02).
- Expanding train window with embargo holes carved out around earlier test folds — the purge/embargo equals the label horizon so no label can leak across the train/test boundary.

### 2.6 HMM regime layer (Section 6)
- Daily NVDA features: `["rvol", "ret", "vol_ratio"]` (intraday realized vol, close-to-close log return, day volume / 20-day mean).
- Split days excluded via a `SPLIT_RET=0.40` guard (catches the 2021-07-20 4:1 and 2024-06-10 10:1 NVDA splits; those bars are dropped from the dataset entirely).
- `StandardScaler` + `GaussianHMM(n_components=4, covariance_type="full", n_iter=500)` on ~1,467 daily observations.
- The fitted params are dumped to `/tmp/hmm_params.json` (scaler, startprob, transmat, means, covars — all in standardized space). This file is a first-class serving artifact.
- Day-level regime is broadcast down to bars as `hmm_regime` + one-hots `regime_0..3`, bringing the feature store to **61 columns**.
- Manual regime readings: 0 = high-volume uptrend, 1 = low-volume drift, 2 = calm bull, **3 = high-vol risk-off** — regime 3 is the one the risk layer (`suppress_regime: 3`) refuses to trade in.

### 2.7 Export to GCS (Section A1)
- The export cell (source snippet: `trainer/gcs_export_cell.py`) aligns labels to `feat_clean`, drops the contiguous trailing-NaN label run (asserted ≤ HORIZON), asserts no NaNs remain, and writes via gcsfs:
  - `gs://$ANANKE_GCS_BUCKET/ananke/v1/feat_clean.parquet`
  - `gs://$ANANKE_GCS_BUCKET/ananke/v1/labels.parquet`
- Executed output: **567,181 rows × 61 features** to bucket `firstrrc-ananke-data`. Local fallback `/tmp/ananke_v1_local_export` when `ANANKE_GCS_BUCKET` is unset.

> Doc drift: several docs cite 567,231 rows. Executed outputs show 567,216 after split-day removal and 567,181 exported (35 trailing unlabeled bars dropped).

### 2.8 Supporting script — `trainer/export_hmm_params.py`
A standalone reproduction of the notebook's HMM cells that re-pulls the 5 symbols from TimescaleDB, refits the HMM, and **validates a ≥99% regime-label match against the notebook's `hmm_regime` column** (achieved 100.0000%, identity confusion matrix) before writing `hmm_params.json`. This is a correctness gate so the serving-side regime detector is provably the same model the trainer saw.

---

## 3. Stage 2 — Vertex AI training (`Test Trading Strategies/trainer/`)

### 3.1 How the job gets to GCP
Two env vars drive everything and are never hardcoded (rule from `pipelinefix/AGENT_JUPYTER.md`):

| Var | Role |
|---|---|
| `ANANKE_GCP_PROJECT` | GCP project (`firstrrc`, number `92826687926`) |
| `ANANKE_GCS_BUCKET` | bucket name without `gs://` (`firstrrc-ananke-data`) |
| `ANANKE_TRAINER_IMAGE`, `ANANKE_N_TRIALS` (40), `ANANKE_MACHINE_TYPE` (`c2-standard-16`) | optional overrides |

1. **`build_push_container.sh`** — docker-builds the trainer image (`linux/amd64`) and pushes to Artifact Registry `us-central1-docker.pkg.dev/$PROJECT/ananke-training/firstrrc-trainer:<tag>`; records the URI in `trainer/.last_image`.
2. **`Dockerfile`** — `python:3.13-slim` + `libgomp1` (LightGBM), installs `requirements-lock.txt` (exact pins validated in a local conda env: sklearn 1.8.0, lightgbm 4.6.0, optuna 4.9.0, shap 0.52.0, imbalanced-learn 0.14.1, skl2onnx 1.20.0, onnxruntime 1.23.2, gcsfs, pyarrow…), bakes in the `trainer/` package, `ENTRYPOINT ["python", "-m", "trainer.train"]`.
3. **`submit_vertex.sh`** — `gcloud ai custom-jobs create --region=us-central1 --display-name=firstrrc-batch4 --worker-pool-spec=machine-type=c2-standard-16,replica-count=1,container-image-uri=…` with `--args` for `--data-path`, `--labels-path`, `--output-path` all pointing at `gs://…/ananke/v1/…`.
4. The job runs under the Compute Engine default service account, which the human setup checklist (`pipelinefix/GCP_SETUP_CHECKLIST.md`) grants `roles/storage.objectAdmin` on the bucket — that's the entire IAM story.

> Historical pivot (documented in `trainer/RUN_ERRORS.md`): the original plan used Vertex's prebuilt `scikit-learn-cpu.0-23` image (Python 3.7) with a `--python-package-uris` tarball. It crashed 5 times on dependency conflicts and was abandoned for the custom pinned container. Some sections of `firstRRCpipelinefinalinstructions.md` (§A4) still describe the retired flow — the shell scripts are the current truth.

### 3.2 What `trainer/train.py` does (the Vertex entrypoint, ~566 lines)

1. **`load_data`** — reads both parquets from GCS via gcsfs.
2. **`build_xy`** — asserts the 61-column store, then selects the **55 contract features in the exact Section-2 order**. The 61→55 drop is fixed, not re-learned: `regime_3, ema_cross_21_50, is_last_bar, ema_cross_9_21, first_30_flag, is_first_bar` (the bottom ~10% by mean |SHAP| from the notebook's selection analysis — recorded in `feature_list_tech5_v1.json`).
3. **`build_folds`** — verbatim port of the notebook's purged walk-forward (purge/embargo 60, 5 folds).
4. **`train_fold`** — SMOTE on the **train partition only**, `RandomForestClassifier(n_estimators=300, max_depth=16, …)` plus a diagnostic `LGBMClassifier`; metric is macro-F1.
5. **`run_optuna_study`** — 40 trials over n_estimators (100–500), max_depth {8,12,16,24,32}, min_samples_leaf, class_weight; objective = mean out-of-fold macro-F1.
6. **`shap_confirmation`** — TreeExplainer in interventional mode with a 100-row background; **warn-only guardrail**, never auto-drops features (the auto-drop is what hung earlier runs before max_depth was capped at 16).
7. **`refit_final_rf`** — full data + SMOTE with the best hyperparameters.
8. **`compute_thresholds`** — out-of-fold ROC, Youden's J → buy/sell thresholds, clamped to [1e-3, 0.999].
9. **`export_onnx_and_contract`** — `skl2onnx.convert_sklearn(..., zipmap=False, target_opset=21)`, asserts the output node is literally named `probabilities`; writes:
   - `rf_v1.onnx` — the model
   - `rf_v1_deploy.json` — the **deploy contract**: ordered 55-feature list, `input_shape [1,55]`, `output_classes ["SHORT","NEUTRAL","LONG"]` (matching sklearn's `classes_ = [-1,0,1]`), tuned thresholds, stop/take-profit, themis risk block (`max_position_pct 0.20`, `daily_loss_limit 0.02`, `max_drawdown 0.10`, `min_confidence`, `suppress_regime 3`, entry windows, `max_trades_per_day 50`), symbols, starting capital. Alpaca keys are deliberately blank.
10. **`_upload_to_gcs`** — pushes both to `gs://…/ananke/v1/models/` and `…/configs/`.

### 3.3 The actual run
Custom job `projects/92826687926/locations/us-central1/customJobs/6395882511985016832` (`firstrrc-batch4`), **succeeded 2026-07-31**: ~15 h on c2-standard-16, ~$12. Best macro-F1 **0.34492** (n_estimators=500, max_depth=16, min_samples_leaf=12, balanced_subsample); thresholds buy=0.3139 / sell=0.3612. The run log is candid that the edge is marginal (~0.01 over a random 3-class baseline).

Artifacts were then pulled by hand (`gcloud storage cp`) into `hermes/models/rf_v1.onnx` (byte-identical, 225 MB, gitignored), `hermes/configs/rf_v1_deploy.json`, and `hermes/configs/hmm_params.json`.

---

## 4. Stage 3 — Hermes: what it is and what it does (`hermes/`)

**Correction to a common assumption:** hermes is not Python and has nothing to do with GCP. It is a **C++20 trading execution engine** (CMake, FetchContent deps: asio, nlohmann/json, httplib, websocketpp, libpqxx, ONNX Runtime). Zero GCP references in the tree. Its world is: Alpaca (data in, orders out), TimescaleDB (logging), and local ONNX files.

### 4.1 The runtime pipeline

```
Alpaca WS 1-min bars ─► HermesEngine.onBar() ─► FeatureCalculator.calculate()  (55 floats)
                                                    │
                              HMMRegime (daily) ────┤
                                                    ▼
                                          ONNXModel.predict()  ─►  Prediction{signal, confidence, probs}
                                                    │
                                                    ▼
                                          themisApprove()  (risk gate)
                                                    │
                                                    ▼
                                          OrderExecutor ─► Alpaca paper REST
                                                    │
                                                    ▼
                                          TradeLogger ─► TimescaleDB (hermes_trades/signals/events)
```

- **`src/engine/FeatureCalculator.{hpp,cpp}`** (~900 lines) — the heart of train/serve parity. Header states every value replicates the exact pandas semantics of FirstRRC.ipynb Section 3: `ewm(adjust=False)`, Wilder `alpha=1/N` for RSI/ATR/ADX, rolling std with ddof=1, numpy-"linear" quantile interpolation for the Bollinger squeeze.
  - **Stateful features** (OBV/ADL cumulative sums + slopes) advance in `update()` before window eviction.
  - **Cross-asset**: `updateCompanion("SPY"/"AMD", bar)` — companions are *fed but never traded*; closes are carried forward on stale ticks, NaN until first bar, **never zeroed** (a zeroed input would silently poison the model).
  - `calculate()` returns the features in **exactly the contract order** — the 55-name order is the contract (a permutation is a silent bug, per the brief).
  - Known accepted limitation: recursive indicators (EMA/RSI/MACD/ADX) seed from the oldest bar in the bounded lookback window, so they drift slightly from notebook values as old bars evict.
- **`src/engine/HMMRegime.{hpp,cpp}`** — loads `hmm_params.json`, runs a **causal online forward filter** in log-space (logSumExp, Gauss-Jordan covariance inversion). Deliberate design deviation: the notebook uses Viterbi (which peeks ahead); live serving can't, so the causal forward filter is the documented train/serve nuance. Wired into backtests via `setRegime()`; live daily computation is not yet wired.
- **`src/engine/HermesEngine.{hpp,cpp}`** — the wiring. One FeatureCalculator per traded symbol, auto-subscribes companion feeds iff the contract's feature list references them. `processBar()`: EOD flatten → exits (stop-loss checked first if both levels are in the bar's range — conservative) → no re-entry while in position → wait for warmup → features → predict → **long-only V1** (SELL signals are dropped) → Themis → enter. Session logic keys off **bar timestamps, not wall clock**, so live and replay run the same code path.
- **Themis** (the risk layer, named in the contract's `themis` block): min confidence, daily loss limit vs day-start capital, max drawdown vs peak, entry window (09:30+15 min → 16:00−15 min ET, hand-rolled US-DST math because macOS libc++ lacks the tz database), max trades/day, regime suppression.
- **Sizing/exits**: `qty = capital × max_position_pct / close`; stops at `close × (1 ∓ SL/TP)`; exit reasons `stop_loss | take_profit | eod`. Blank Alpaca creds → simulated fills (`sim-N` order ids).
- **`src/inference/ONNXModel.{hpp,cpp}`** — ONNX Runtime C++ API (expects runtime at `/usr/local/onnxruntime`), finds the `probabilities` output (why `zipmap=False` and the asserted node name matter), maps classes via the contract's `output_classes`, applies buy/sell thresholds; if neither crosses → HOLD **regardless of argmax**.
- **`src/feed/MarketDataFeed`** — Alpaca WebSocket (`wss://stream.data.alpaca.markets/v2/iex` paper / `/v2/sip` live), exponential-backoff reconnect.
- **`src/execution/OrderExecutor`** — Alpaca REST (`paper-api.` / `api.alpaca.markets`), market/day orders.
- **`src/logging/TradeLogger`** — libpqxx → TimescaleDB; auto-creates `hermes_trades`, `hermes_signals`, `hermes_events`; **never throws** (stderr only) so a DB hiccup can't kill trading.
- **`src/main.cpp`** — loads a config JSON, overrides Alpaca keys from `ALPACA_API_KEY/SECRET` env vars (secrets never in config files), and serves `GET /health`, `GET /status`, `POST /stop` on `:9090`.

### 4.2 The backtest driver — `tools/backtest_main.cpp`
`hermes_backtest <config> <bars.csv> <daily_regime.csv> <out.json>` replays timestamp-grouped bars through the **real HermesEngine** (companions before primary, regimes injected at UTC day boundaries), with Alpaca creds forced blank. It computes stats (win rate, profit factor, max DD from the equity curve, annualized Sharpe from daily returns) and writes a **frontend-shaped JSON** `{model, performance, equity (≤600 pts), trades}` with `"engine": "hermes-cpp"`. Header comment: *"no Java backend, no Python inference in the path."*

The real run (`backtest_data/rf_v1_backtest.json`, 2026-08-01): 875 trades on 3 months of NVDA 1-min bars, 46.6% win rate, +6.59% on $100k, profit factor 1.47, max DD 0.47%.

### 4.3 Testing philosophy
Parity is enforced, not assumed: `tests/gen_expected.py` reimplements the notebook's Cell-16 formulas (importing `ananke.indicators`), generates a 180-bar fixture with overnight gaps and companion feeds, and `test_features.cpp` compares **all 51 non-HMM contract features against pandas ground truth at 1e-4 tolerance**. Similar fixture tests cover the HMM forward filter (vs numpy), ONNX inference, Alpaca JSON parsing, and a full offline engine loop (with a live TimescaleDB when `HERMES_DB_TEST_DSN` is set).

---

## 5. What the frontend hits, and why

The frontend (`src/`, TanStack Start SSR) touches the FirstRRC pipeline through **exactly two bridges** — and deliberately never through a serving API.

### 5.1 Bridge 1: `/backtesting` → Models tab → static JSON
- `src/components/backtesting/HermesModelPanel.tsx` → `fetchHermesBacktest()` (`src/lib/api/hermes.ts`) → **`GET /hermes/rf_v1_backtest.json`**, a static asset in `public/hermes/` served by the frontend itself. It intentionally bypasses `apiFetch` and the Spring backend.
- That file is a **manual byte-copy** of `hermes/backtest_data/rf_v1_backtest.json`. Refreshing it = re-run the C++ backtest and copy the file. There is no sync automation.
- Why: the Java backend cannot run the ML model at all, so the only way to show real FirstRRC results is to pre-compute them in the engine that can (hermes) and ship the output as static data.

### 5.2 Bridge 2: `/models` + `/live` → Spring backend → DB projection
- The Java backend never calls Vertex, Python, hermes, or ONNX. `ModelController`/`ModelService` is a **read projection over the `strategies` and `backtest_results` tables** — there is no `models` table. Name/version are parsed from the strategy-name `_v<N>` suffix (`rf_v1` → model `rf`, version `v1`); the contract summary (features, thresholds, classes) is read out of the strategy's `definition` jsonb.
- `/models` (`src/routes/models.tsx`): `GET /api/models`, `GET /api/models/{name}/{version}`, `POST …/deploy {mode}`, `DELETE …/…` (archive) — deploy/archive just flip status columns.
- `/live` (`src/routes/live.tsx`): `GET /api/account` + `GET /api/positions` (Alpaca proxies via `LiveController`) + `GET /api/strategies/active` — i.e., it shows the Alpaca-side *effects* of what hermes is doing, while hermes itself trades out-of-band (host process → Alpaca directly).
- Strategy ingestion (the other direction): Jupyter → `Kairos.export()` in the SDK → `POST /api/strategies` → `strategies` + `backtest_results` rows. `/backtesting` Strategies tab reads them back via `GET /api/strategies[/name]` and can re-run **only** `rsi_crossover`/`ema_crossover` definitions through `BacktestEngineService` (a pure-Java port of the SDK's Kairos). An ML strategy like `rf_v1` throws "cannot be re-run from the dashboard" — the frontend even has a dedicated banner for this (`backtesting.tsx`).

### 5.3 Dead ends by design
- `GET /api/trades/range` (would show the hermes C++ trade log) — **not implemented**; `tradesApi.rangeSafe` catches 404/501 and renders an inline notice.
- `/metrics` — pure `PendingPage` stub awaiting `GET /api/metrics/strategy|engine`.
- The `/live` empty state suggests `k.deploy('strategy_name')`, but that function doesn't exist in `ananke-sdk` — deploy is REST-only.
- `ChartPanel` on `/` also calls `strategiesApi.get(name)` to overlay a stored strategy's trades on the main chart.

---

## 6. Design choices worth naming

1. **Cloud for training, metal for inference.** Vertex is used as a one-shot batch job, not a platform. No endpoint, no GPU, no online serving. Rationale: 1-min-bar trading needs deterministic low-latency local inference, and a 225 MB RandomForest in ONNX Runtime on the host is simpler and cheaper than a permanently-running Vertex Endpoint. The cost of that choice is the manual `gcloud storage cp` handoff.

2. **The deploy contract is the architecture.** `rf_v1_deploy.json` (features in order, classes, thresholds, themis block) is the single artifact that decouples the training world from the serving world. Trainer and engine never share code — they share *one JSON file plus strict conventions* (55-order, `zipmap=False`, `probabilities` node name, class names SHORT/NEUTRAL/LONG). Every parity rule in the briefs ("order is law", "never zero inputs") exists to protect that seam.

3. **Parity by construction + parity by test.** The C++ FeatureCalculator reimplements pandas formulas exactly (documented per-function), and the test suite compares against pandas-generated ground truth at 1e-4. Where exact parity is impossible (Viterbi → causal forward filter; windowed seeding of recursive indicators), the deviation is documented as accepted rather than hidden.

4. **The 61/55 split separates *store* from *contract*.** The notebook ships a 61-column superset; the fixed SHAP-based drop to 55 lives in `train.py`, so feature selection is versioned with training while the export stays stable.

5. **SMOTE only on train folds, thresholds from OOF predictions, purge = embargo = horizon.** All three are leakage discipline: the walk-forward, the resampling, and the decision thresholds each only ever see information that would have been available at trade time.

6. **Bar-time, not wall-time.** Hermes drives sessions off bar timestamps so the identical code path serves live trading and historical replay — which is what makes the backtest JSON trustworthy as a preview of live behavior.

7. **Failure isolation in the engine.** The trade logger can never throw; blank Alpaca keys degrade to simulated fills; optional deps gate the binary down to a config-validator. Trading must not die because observability did.

8. **The frontend consumes results, not models.** The UI's two bridges (static backtest JSON; DB projection of strategies) mean the ML stack can change completely without a frontend redeploy — but also that nothing in the UI can trigger training or ML re-backtests. The "cannot be re-run" banner is the honest surfacing of that boundary.

9. **Secrets and env discipline.** GCP identity travels only via `ANANKE_GCP_PROJECT`/`ANANKE_GCS_BUCKET` + ADC; Alpaca keys via env vars only; config files keep them blank. The GCP setup itself is deliberately a human checklist, not automation.

10. **Regime-aware risk as a first-class feature.** The HMM isn't just a feature — regime 3 (high-vol risk-off) is wired into Themis as a hard trade suppressor, so the model's own regime detection gates its capital exposure.

---

## 7. Known gaps / honest caveats

- **Model edge is thin**: best macro-F1 0.3449, ~0.01 over a random 3-class baseline (`trainer/RUN_ERRORS.md` says this plainly). The backtest's +6.59% should be read in that light.
- **Live regime computation isn't wired** — `HMMRegime` is tested but only backtests inject regimes via `setRegime()`. A live session needs the daily HMM update loop (README "Part 11" is the pending real paper session).
- **Manual artifact copies** in both directions: GCS → hermes, and hermes → `public/hermes/`. No automation either way.
- **Doc drift**: row counts (567,231 cited vs 567,181 actual), the retired prebuilt-image flow in `firstRRCpipelinefinalinstructions.md` §A4, and `k.deploy()` referenced in the UI but unimplemented in the SDK.
- **Dead dispatch**: `FeatureCalculator` still handles `regime_3` even though it's a dropped feature — harmless, but present.
- **`Java backend copy/`** is a byte-identical duplicate of `Java backend/src`; `Test Trading Strategies/Trading notes/` contains an abandoned earlier plan (LSTM/ensemble/Kelly batches) that was superseded by the pipelinefix plan — neither is part of the live architecture.

---

## Appendix — key files

| Stage | File | Role |
|---|---|---|
| Notebook | `Test Trading Strategies/FirstRRC.ipynb` | Feature store, labels, folds, HMM, GCS export |
| Contract source | `Test Trading Strategies/feature_list_tech5_v1.json` | The 55-feature ordered list + dropped 6 |
| Trainer | `Test Trading Strategies/trainer/train.py` | Vertex entrypoint (CV → Optuna → ONNX + contract) |
| Container | `trainer/Dockerfile`, `requirements-lock.txt`, `build_push_container.sh` | Pinned py3.13 training image → Artifact Registry |
| Submission | `trainer/submit_vertex.sh` | `gcloud ai custom-jobs create` |
| Run log | `trainer/RUN_ERRORS.md` | Failures, pivots, final job results |
| HMM gate | `trainer/export_hmm_params.py` | Refit + 100% parity validation → `hmm_params.json` |
| Build spec | `pipelinefix/firstRRCpipelinefinalinstructions.md`, `AGENT_JUPYTER.md`, `AGENT_HERMES.md`, `GCP_SETUP_CHECKLIST.md` | The 4-track plan and agent charters |
| Engine | `hermes/src/engine/*`, `hermes/src/inference/ONNXModel.*` | Feature parity + local inference + Themis |
| Backtest | `hermes/tools/backtest_main.cpp` → `hermes/backtest_data/rf_v1_backtest.json` | Replay through the real engine |
| Frontend bridges | `public/hermes/rf_v1_backtest.json`, `src/lib/api/hermes.ts`, `src/components/backtesting/HermesModelPanel.tsx`, `src/routes/models.tsx`, `src/routes/live.tsx` | The two UI touchpoints |
| Backend projection | `Java backend/src/main/java/com/stocktracker/controller/ModelController.java`, `service/ModelService.java`, `controller/StrategyController.java` | `/api/models`, `/api/strategies` over DB rows |
