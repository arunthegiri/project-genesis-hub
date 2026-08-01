# Batch 4 (`rf_v1`) Training — Run Log

Chronological record of every training attempt (Vertex AI + local), root causes,
and fixes. Keep this updated as attempts continue — the goal is to never
rediscover the same failure twice.

## Vertex AI attempts (Python 3.7 container — abandoned track)

All of these ran on `us-docker.pkg.dev/vertex-ai/training/scikit-learn-cpu.0-23`
(Python 3.7, scikit-learn 0.23.1 / numpy 1.18.5 / scipy 1.4.1 / joblib 0.15.1
preinstalled). This container is now considered a dead end — see "Why the
Python 3.7 track was abandoned" below.

1. **`8570616731045724160` / `3463112541142515712`** (2026-07-11) — `ImportError:
   cannot import name 'OneToOneFeatureMixin' from 'sklearn.base'`. Unpinned
   `scikit-learn` + `imbalanced-learn` in `setup.py`/`requirements.txt` — pip's
   legacy resolver left the container's ancient sklearn in place while
   installing latest `imbalanced-learn`, which requires `scikit-learn>=1.0.2`.
   **Fix:** pinned `scikit-learn>=1.0.2,<1.1`, `scipy>=1.5.0`, `numpy>=1.21.6`.

2. **`8756218691860824064`** (2026-07-12) — `FileNotFoundError: .../pip-req-build-*/setup.py`.
   Tarball packaged from inside `trainer/` per the (stale) checklist
   instructions, which excluded `setup.py` (lives one level up, sibling to
   `trainer/`). **Fix:** package from `Test Trading Strategies/` (`tar czf
   trainer.tar.gz setup.py trainer`), updated `GCP_SETUP_CHECKLIST.md` and the
   build doc to match. Also had to switch `submit_vertex.sh` from the legacy
   `--python-module`/`--machine-type` flags (rejected by gcloud 575.0.1+) to
   `--worker-pool-spec=...,executor-image-uri=...,python-module=...`.

3. **`8787743889252417536`** (2026-07-12) — `SyntaxError: invalid syntax` in
   `imblearn/utils/_metadata_requests.py` (`def process_routing(_obj, _method,
   /, **kwargs)`) — positional-only-parameter syntax, Python 3.8+ only, on a
   Python 3.7 interpreter. Root cause: `imbalanced-learn` unpinned → pip
   grabbed latest (0.12.4), which dropped Python 3.7 support outright (not
   just a version-compat warning — the package literally doesn't parse).
   **Fix:** pinned `imbalanced-learn==0.9.1` (last release supporting Python 3.7).

4. **`2787260335734652928`** (2026-07-12) — got further this time (through
   SMOTE, through an RF fit on fold 1), then `TypeError: cpu_count() got an
   unexpected keyword argument 'only_physical_cores'` inside
   `lightgbm/compat.py` during `lgbm.fit()`. Root cause: `lightgbm` unpinned →
   latest (4.6.0)'s sklearn wrapper calls `joblib.cpu_count(only_physical_cores=...)`,
   a parameter that only exists in `joblib>=1.0`; container's preinstalled
   `joblib` is 0.15.1. **Fix applied:** pinned `joblib>=1.1.1,<1.3`.

5. **`4119481400506187776`** (2026-07-12) — submitted with the joblib pin
   applied, but **cancelled before completion** per the decision below (not
   because it failed — because the whole track was abandoned mid-flight).

### Why the Python 3.7 track was abandoned

Attempts 1-4 form a clear pattern: every unpinned package resolves to its
*latest* PyPI release, which increasingly assumes Python 3.8+ (or newer
transitive deps than the container ships). Pinning one package at a time only
advances the crash to the next unpinned package — proven twice in a row
(imbalanced-learn → lightgbm/joblib). The container itself (Python 3.7,
released ~2020-era base packages) is fundamentally mismatched with any
current PyPI release of this stack.

**Decision (2026-07-12): move off Python 3.7 entirely**, fully pin every
dependency (not just the ones that have already bitten us) to the exact
versions already validated locally in `FirstRRC.ipynb`'s environment (conda
`conda-base` kernel, Python 3.13.2 — confirmed via `pip freeze`, not guessed),
and build a custom Vertex training container from `python:3.13-slim` rather
than fight prebuilt-image preinstalled versions again. No prebuilt Vertex
sklearn training image goes past Python 3.10
(`sklearn-cpu.1-6.py310`), and several of the exact local pins
(`numpy==2.3.5` needs ≥3.11, `shap==0.52.0` needs ≥3.12) don't have wheels for
any Python version below 3.12 anyway — so a prebuilt image was never going to
work without downgrading below what's tested locally, which is exactly what
we're trying to avoid.

**Full pin set** (from local `pip freeze`, Python 3.13.2):
```
numpy==2.3.5
pandas==3.0.2
scipy==1.17.1
scikit-learn==1.8.0
joblib==1.5.3
lightgbm==4.6.0
optuna==4.9.0
shap==0.52.0
imbalanced-learn==0.14.1
hmmlearn==0.3.3
ta==0.11.0
skl2onnx==1.20.0
onnx==1.21.0
onnxruntime==1.23.2
gcsfs==2026.7.0
pyarrow==24.0.0
```
(`tqdm` dropped — was in `requirements.txt` but never actually imported by
`train.py`; no local-truth version to pin it against.)

Infra provisioned for this: Docker Desktop started locally, Artifact Registry
API enabled on `firstrrc`, repo `ananke-training` created in `us-central1`,
`gcloud auth configure-docker us-central1-docker.pkg.dev` done.

## Local dry runs (Python 3.13, exact pinned stack)

Per hard constraint: **no further Vertex submissions without a passing local
run first.** Local env: conda `ananke-train313` (Python 3.13.5), all 15
packages above installed exactly, `trainer` installed via `pip install -e .
--no-deps`.

### Run 1 (2026-07-12, ~15:08–16:50 PT) — killed manually, not a crash

Sample: last 80,000 rows of the real `feat_clean`/`labels` parquet files
(pulled from `gs://firstrrc-ananke-data/ananke/v1/`), spanning 11 months
(2025-08 → 2026-06), `--n-trials=3 --shap-sample-rows=200`.

**Result: all dependency-related code paths passed cleanly.**
- Step 5 baseline pass: all 5 folds completed (SMOTE → RF → LGBM, no errors).
  ~1.5–2 min/fold.
- Step 6 Optuna study: all 3 trials completed cleanly, ~5–8 min/trial (each
  trial = SMOTE + RF fit × 5 folds).
- **Killed at Step 7 (SHAP confirmation)** after ~1h stuck on
  `shap.TreeExplainer(...).shap_values(...)` for fold 1. Confirmed via macOS
  `sample` profiler that the process was genuinely computing (deep recursive
  stack inside SHAP's compiled `_cext.abi3.so` tree-traversal extension), not
  hung/deadlocked — just extremely slow.

**Root cause (new, unrelated to the dependency saga):** `shap_confirmation()`
(`train.py:524`) runs `TreeExplainer` against the Step-5 baseline RF models,
which are fit with **`max_depth=None`** (`train.py:230`, fully unbounded) and
`n_estimators=300`. TreeExplainer's cost scales roughly with
`trees × leaves × depth²`; unbounded-depth trees on tens of thousands of rows
can reach depth 30–50+ with thousands of leaves per tree, which blows this up
to (empirically) far more than an hour — on a data slice only 1/7th the size
of the full 567k-row dataset. This would very likely take many hours on the
full run, and is orthogonal to the container/dependency work above — more
pinning will not fix it.

**FIXED (2026-07-23) — all three candidate fixes applied to `train.py`:**
- Baseline RF `max_depth: None → 16` (`train_fold`, ~line 230). This is the
  model TreeExplainer runs against; capping depth is what bounds the
  `depth²` blowup. The exported model uses Optuna's `best_params`, so this
  only affects the baseline F1 log + SHAP guardrail, not production accuracy.
- `shap_confirmation` (~line 321): `TreeExplainer(rf, data=background,
  feature_perturbation="interventional")` with a 100-row background, plus
  `shap_values(..., check_additivity=False)` — replaces the default recursive
  `tree_path_dependent` algorithm that hung.
- `--shap-sample-rows` default `2000 → 500`.

### Run 2 (2026-07-23, 10:48–11:30 PT) — CLEAN FINISH through ONNX export ✅

Same sample as Run 1 (last 80,000 rows of the real GCS parquet, 11 months
2025-08→2026-06, 5 folds), `--n-trials=3 --shap-sample-rows=200`. Total wall
time ~42 min. Every stage passed, exit code 0:
- Step 5 baseline: all 5 folds (RF macro-F1 0.32–0.34, LGBM 0.32–0.36), ~1 min/fold.
- Step 6 Optuna: 3/3 trials. Best = trial 2, macro-F1 **0.3343**, params
  `{n_estimators=450, max_depth=16, min_samples_leaf=20, class_weight=balanced_subsample}`.
  (Trials that drew unbounded/deep RFs took 6–8 min — expected, that's the
  search space, not a regression.)
- **Step 7 SHAP: completed in ~85–100s/fold (~6 min total) — vs the >1h/fold
  hang in Run 1.** The fix is validated. Warn-only guardrail flagged the
  expected low-|SHAP| time/regime dummies (`dow_cos, last_30_flag,
  hmm_regime, regime_0/1/2`); NOT auto-dropped.
- Step 8 refit: final RF on 91,956 post-SMOTE rows with best params.
- Step 9 thresholds (OOF ROC, Youden's J): **buy(LONG)=0.3297, sell(SHORT)=0.3887**.
- Step 10 export: `rf_v1.onnx` (63 MB) + `rf_v1_deploy.json` (55-feature
  contract) written. **NOTE:** export always writes to `/tmp/` first, then
  uploads to GCS *only if* `--output-path` is a `gs://` URI (local dir →
  "skipping GCS upload"). Verified the ONNX passes `onnx.checker`, input
  `[None,55]`, outputs `label`+`probabilities`, inference runs.

## Status / next steps

- [x] Diagnose and fix all Python-3.7-container dependency crashes
- [x] Decide to move to Python 3.13, fully pinned, custom container
- [x] Provision Docker + Artifact Registry for the custom image
- [x] Validate the full pinned dependency stack imports cleanly locally
- [x] Validate Steps 1–6 (data load → folds → baseline → Optuna) locally
- [x] **Fix the SHAP `TreeExplainer` performance bottleneck in `train.py`** (2026-07-23)
- [x] Re-run local dry run to a clean finish (through ONNX export) — Run 2, exit 0
- [x] Author the custom container: `trainer/Dockerfile` (python:3.13-slim +
      `requirements-lock.txt` exact pins + baked-in `trainer/`),
      `trainer/build_push_container.sh`, `trainer/.dockerignore`, and rewrite
      `submit_vertex.sh` for `container-image-uri` (2026-07-23). **Built +
      smoke-tested locally** (`firstrrc-trainer:localtest`): all pinned wheels
      resolve on linux/amd64 py3.13, entrypoint runs `python -m trainer.train`,
      all heavy imports load, FEATURE_COLS=55.
- [x] **Container-on-GCS end-to-end test** (2026-07-29) — ran the built image
      against `gs://` in/out with ADC mounted (`-v ~/.config/gcloud/adc.json`,
      `GOOGLE_APPLICATION_CREDENTIALS`), i.e. the EXACT path Vertex runs:
      `--data-path`/`--labels-path`/`--output-path` all `gs://`. 80k sample,
      3 trials, exit 0. Baseline F1s byte-identical to the conda Run 2
      (deterministic reproduction inside the container). **Exercised the two
      previously-untested seams: gcsfs read from GCS, AND `_upload_to_gcs`** —
      `rf_v1.onnx` (5.4 MB, best model max_depth=8) + `rf_v1_deploy.json`
      (55-feature contract, thresholds buy=0.3420/sell=0.3608) landed in GCS.
      Downloaded + re-validated: onnx.checker OK, input [None,55],
      label+probabilities, inference OK. Test prefix `_containertest/` cleaned
      up; real `ananke/v1/` data untouched. **Every code path Vertex will hit
      is now proven locally — the job should run without errors on Vertex.**
- [x] **Optuna search-space fix (2026-07-29):** dropped `max_depth=None` from
      the study (`train.py`, `run_optuna_study` → `[8,12,16,24,32]`) so full-run
      trials stay tractable. Also set `submit_vertex.sh` machine to
      `c2-standard-16` (overridable via `ANANKE_MACHINE_TYPE`). Re-validated in
      a rebuilt container against the local 80k sample — both completed trials
      drew bounded depths (12, 32), never None.
- [x] **Pushed** the container (2026-07-31):
      `us-central1-docker.pkg.dev/firstrrc/ananke-training/firstrrc-trainer:20260731-040244`
- [x] **SUBMITTED the real Vertex job (2026-07-31):** full 567k rows,
      `--n-trials=40`, `c2-standard-16`. Custom job
      `projects/92826687926/locations/us-central1/customJobs/6395882511985016832`
      (display-name firstrrc-batch4), state QUEUED at submit.
      Monitor: `gcloud ai custom-jobs describe <id> --region=us-central1` or
      `... stream-logs <id>`.
- [x] **Vertex job SUCCEEDED (2026-07-31, ended 19:07 UTC, ~15 hr on
      c2-standard-16, ~$12 compute).** All 40 Optuna trials + full-data SHAP
      (no hang — the max_depth=16 + interventional fix held at 567k rows) +
      refit + thresholds + export ran clean. Best macro-F1 **0.34492**
      (Trial 12: n_estimators=500, max_depth=16, min_samples_leaf=12,
      balanced_subsample). Thresholds buy(LONG)=0.3139, sell(SHORT)=0.3612.
      Artifacts landed: `gs://firstrrc-ananke-data/ananke/v1/models/rf_v1.onnx`
      (225 MB) + `.../configs/rf_v1_deploy.json` (55-feat contract, classes
      [SHORT,NEUTRAL,LONG], NVDA).
      **CAVEAT — weak model:** macro-F1 0.345 is only ~0.01 above the 3-class
      random baseline (~0.33). Pipeline is correct; predictive edge is
      marginal (normal for 1-min return classification). Real go/no-go is a
      Hermes backtest of the thresholded strategy, not F1. Near-zero mean|SHAP|
      features on full data: regime_1 (0.000000), overnight_gap, adl, obv,
      dow_sin, dow_cos — candidates to prune in a future feature-set pass.
- [x] **Copied artifacts into hermes (2026-07-31):** `hermes/models/rf_v1.onnx`
      (236,271,008 bytes, byte-matches GCS) + `hermes/configs/rf_v1_deploy.json`
      (real 55-feature contract; replaced the old 5-feature/0.65 placeholder).
      Validated in ananke-train313: onnx.checker OK, input float_input [None,55]
      matches contract 55, outputs label + probabilities[None,3] (no zipmap),
      inference labels -1/0/1, proba rows sum to 1.0, thresholds
      buy=0.3139/sell=0.3612, classes [SHORT,NEUTRAL,LONG]. Contract-consistent.
- [x] **`hmm_params.json` EXPORTED + validated (2026-08-01).** New standalone
      `trainer/export_hmm_params.py` reproduces notebook cells 12/14/25 (5-symbol
      DB pull → prep/outer-join/ffill/anchor merge → daily NVDA features →
      GaussianHMM(4, full, seed 42)) in the `base` env (same hmmlearn 0.3.3 /
      sklearn 1.8.0). Correctness gate PASSED: broadcasting the re-fit
      day-regimes to all 567,181 feat_clean bars gives a **100.0000% match** to
      the `hmm_regime` rf_v1 trained on, confusion matrix is pure identity (no
      label permutation). HMM converged (82 iters). Validated the Hermes load
      path: schema matches HMMRegime.cpp, all 4 full covariances invertible +
      symmetric-PD (won't throw in precompute), startprob/transmat valid.
      Placed at `hermes/configs/hmm_params.json` + uploaded to
      `gs://firstrrc-ananke-data/ananke/v1/hmm_params.json`.
      NOTE: feat_clean labels came from hmmlearn Viterbi (`hmm.predict`);
      Hermes assigns regimes online via forward-filtering (HMMRegime::observeDay)
      — an inherent offline-vs-online design difference, not a params issue.
- [ ] Submit the real Vertex job (full 567k rows, `--n-trials=40`) against the
      custom container
- [ ] Confirm `rf_v1.onnx` + `rf_v1_deploy.json` land in GCS and copy to
      `hermes/models/` / `hermes/configs/`
- [ ] **`hmm_params.json` is separately blocked** — it is NOT produced by
      `train.py` at all. It comes from `hmm_export_cell.py`, a cell meant to
      be pasted into `FirstRRC.ipynb` after the HMM fit; even then it only
      writes to `/tmp/hmm_params.json` locally by default (the GCS upload
      lines are commented out). Needs a separate manual step regardless of
      how the Vertex job goes. Hermes Track B4 blocks on this file.
