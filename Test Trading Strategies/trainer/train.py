"""trainer/train.py — Batch 4: FirstRRC rf_v1 training + ONNX export.

Vertex AI custom-job entrypoint (python-module=trainer.train). Loads the
Batch-3 feature store (`feat_clean`, 61 cols) and labels exported from
FirstRRC.ipynb (see gcs_export_cell.py / build doc Section A1), selects the
canonical 55-feature contract (Section 2 of
firstRRCpipelinefinalinstructions.md — LAW, order matters), reproduces the
notebook's purged walk-forward CV folds, trains RandomForest (+ LightGBM as a
diagnostic comparison) per fold with SMOTE on train folds only, runs an
Optuna study to tune the RF, confirms the fixed 55-feature selection against
fresh per-fold SHAP rankings (warn-only, never auto-drops), refits a final RF
on the full labeled set, derives buy/sell probability thresholds from OOF
ROC curves, and exports the model to ONNX (zipmap=False) plus the deploy
contract JSON that Hermes's EngineConfig / ONNXModel consume.

Reference: /Users/phantom/Quant/Anake/pipelinefix/firstRRCpipelinefinalinstructions.md
Sections 0, 0.5, 2, 3, and TRACK A (A1-A4).
"""

import argparse
import json
import logging
import os
import sys

import numpy as np
import pandas as pd

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("trainer.train")


# ---------------------------------------------------------------------------
# Section 2 — The Feature Contract, 55 Features, Exact Order (LAW)
# Source of truth: Test Trading Strategies/feature_list_tech5_v1.json
# "features" array. This list MUST stay byte-identical (order included) to
# that JSON, to the contract written below, and to Hermes FeatureCalculator
# ::calculate()'s output order. A permutation here is a silent, untested
# correctness bug (build doc Section 6, first bullet).
# ---------------------------------------------------------------------------
FEATURE_COLS = [
    "logret_1", "logret_5", "logret_15", "logret_30", "logret_60",
    "vol_5", "vol_10", "vol_20", "vol_60",
    "overnight_gap", "intraday_range",
    "rsi_7", "rsi_14", "rsi_21",
    "roc_5", "roc_15", "roc_30",
    "stoch_k", "stoch_d",
    "ema_9_dist", "ema_21_dist", "ema_50_dist", "ema_200_dist",
    "macd_line", "macd_signal", "macd_hist", "macd_hist_slope",
    "adx_14",
    "bb_pctb", "bb_bandwidth", "bb_squeeze",
    "zscore_20", "zscore_60",
    "dist_vwap", "vwap_z",
    "vol_ratio_20",
    "obv", "obv_slope",
    "vwpm",
    "adl", "adl_slope",
    "beta_spy_20", "corr_spy_20", "relstr_amd_20",
    "hour_sin", "hour_cos", "dow_sin", "dow_cos",
    "min_since_open", "min_to_close", "last_30_flag",
    "hmm_regime", "regime_0", "regime_1", "regime_2",
]

# Section 2 / Section A2 step 3 — six columns present in the 61-col
# feat_clean export that are dropped before training (fixed, SHAP-derived
# list; the drop happens HERE, not in the notebook).
DROPPED = [
    "regime_3", "ema_cross_21_50", "is_last_bar",
    "ema_cross_9_21", "first_30_flag", "is_first_bar",
]

# Section 3 — Label Encoding & Output Column Order (LAW). sklearn sorts
# classes_ = [-1, 0, 1]; skl2onnx emits probability columns in that order.
OUTPUT_CLASSES = ["SHORT", "NEUTRAL", "LONG"]  # cols 0/1/2 <-> classes -1/0/1


def parse_args(argv=None):
    bucket = os.environ.get("ANANKE_GCS_BUCKET")
    default_base = f"gs://{bucket}/ananke/v1" if bucket else None

    parser = argparse.ArgumentParser(description="FirstRRC Batch 4 — rf_v1 trainer")
    parser.add_argument(
        "--data-path",
        default=f"{default_base}/feat_clean.parquet" if default_base else None,
        help="gs:// URI to the 61-col feat_clean parquet (default: "
        "gs://$ANANKE_GCS_BUCKET/ananke/v1/feat_clean.parquet)",
    )
    parser.add_argument(
        "--labels-path",
        default=f"{default_base}/labels.parquet" if default_base else None,
        help="gs:// URI to the labels parquet (default: "
        "gs://$ANANKE_GCS_BUCKET/ananke/v1/labels.parquet)",
    )
    parser.add_argument(
        "--output-path",
        default=f"{default_base}/" if default_base else None,
        help="gs:// URI prefix to upload models/rf_v1.onnx and "
        "configs/rf_v1_deploy.json under (default: "
        "gs://$ANANKE_GCS_BUCKET/ananke/v1/)",
    )
    parser.add_argument(
        "--n-trials",
        type=int,
        default=40,
        help="Optuna trial count (doc: keep modest, 30-50, for n1-standard-8)",
    )
    parser.add_argument(
        "--shap-sample-rows",
        type=int,
        default=500,
        help="Max rows per fold's test set to run through shap.TreeExplainer "
        "(SHAP confirmation is a guardrail/log, not the selection mechanism "
        "— the 55-feature drop is already fixed at step 3).",
    )
    args = parser.parse_args(argv)

    missing = [
        name
        for name, val in (
            ("--data-path", args.data_path),
            ("--labels-path", args.labels_path),
            ("--output-path", args.output_path),
        )
        if val is None
    ]
    if missing:
        parser.error(
            f"{', '.join(missing)} not provided and ANANKE_GCS_BUCKET is unset "
            "— set the env var or pass the arg(s) explicitly."
        )
    return args


# ---------------------------------------------------------------------------
# Step 2 (A2): load feat_clean + labels from GCS
# ---------------------------------------------------------------------------
def load_data(data_path: str, labels_path: str):
    logger.info("Loading feat_clean from %s", data_path)
    feat_clean = pd.read_parquet(data_path)
    logger.info("Loading labels from %s", labels_path)
    labels = pd.read_parquet(labels_path)
    logger.info(
        "Loaded feat_clean %s, labels %s", feat_clean.shape, labels.shape
    )
    return feat_clean, labels


# ---------------------------------------------------------------------------
# Step 3 (A2): build X, y on the canonical 55, Section 2 order
# ---------------------------------------------------------------------------
def build_xy(feat_clean: pd.DataFrame, labels: pd.DataFrame):
    assert feat_clean.shape[1] == 61, f"expected 61 cols, got {feat_clean.shape[1]}"
    assert set(FEATURE_COLS).isdisjoint(DROPPED)
    assert len(FEATURE_COLS) == 55

    X = feat_clean[FEATURE_COLS].values.astype(np.float32)  # 55, Section 2 order
    y = labels["label"].values.astype(int)  # -1/0/1  (NOT label_binary)

    logger.info("X shape %s, y shape %s", X.shape, y.shape)
    unique, counts = np.unique(y, return_counts=True)
    logger.info(
        "Label distribution: %s",
        {int(k): int(v) for k, v in zip(unique, counts)},
    )
    return X, y


# ---------------------------------------------------------------------------
# Step 4 (A2): purged walk-forward folds — VERBATIM from the build doc's
# Section A2 step 4 code block (which operates on feat_clean.index directly,
# unlike notebook Cell 22's `merged.index[merged["label"].notna()]` — the two
# are equivalent here because A1's export already reindexed/asserted labels
# non-NaN against feat_clean.index before upload). Do not alter this logic.
# ---------------------------------------------------------------------------
def build_folds(feat_clean: pd.DataFrame):
    PURGE, EMBARGO, N_FOLDS = 60, 60, 5
    valid_idx = feat_clean.index
    pos_all = np.arange(len(valid_idx))
    months = valid_idx.tz_localize(None).to_period("M")

    MIN_TEST_BARS = 5000
    month_counts = pd.Series(months).value_counts()
    eligible = month_counts[month_counts >= MIN_TEST_BARS].index.sort_values()
    test_months = eligible[-N_FOLDS:]

    FOLDS = []
    embargo_holes = []
    for i, m in enumerate(test_months, 1):
        test_pos = pos_all[months == m]
        ts0, ts1 = test_pos[0], test_pos[-1]
        train_end = ts0 - PURGE
        train_pos = pos_all[pos_all < max(train_end, 0)]
        for h0, h1 in embargo_holes:
            train_pos = train_pos[(train_pos < h0) | (train_pos > h1)]
        FOLDS.append({"fold": i, "train_pos": train_pos, "test_pos": test_pos})
        embargo_holes.append((ts1 + 1, min(ts1 + EMBARGO, len(valid_idx) - 1)))

    for f in FOLDS:
        logger.info(
            "Fold %d: n_train=%d n_test=%d",
            f["fold"], len(f["train_pos"]), len(f["test_pos"]),
        )
    return FOLDS


# ---------------------------------------------------------------------------
# Step 5 (A2): per-fold RF + LGBM training, SMOTE on train folds only.
# LGBM is trained purely as a diagnostic comparison point per the doc's
# "fit RandomForestClassifier and LGBMClassifier on each fold ... evaluate";
# only the RF is Optuna-tuned, SHAP-confirmed, refit, and exported (A3) —
# LGBM's metric is logged for comparison and not used downstream.
# ---------------------------------------------------------------------------
def train_fold(X, y, train_pos, test_pos, rf_params=None):
    from imblearn.over_sampling import SMOTE
    from lightgbm import LGBMClassifier
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.metrics import f1_score

    X_train, y_train = X[train_pos], y[train_pos]
    X_test, y_test = X[test_pos], y[test_pos]

    # SMOTE on the training fold only — never resample the test set.
    smote = SMOTE(random_state=42)
    X_train_res, y_train_res = smote.fit_resample(X_train, y_train)

    # max_depth capped at 16 (was None/unbounded). This baseline RF is a
    # diagnostic + the model SHAP's TreeExplainer runs against (step 7);
    # unbounded trees reached depth 30-50+ and made TreeExplainer cost
    # (~trees x leaves x depth^2) explode to >1h/fold. The exported model
    # uses Optuna's best_params, not this one, so the cap only bounds the
    # baseline F1/SHAP guardrail — not production accuracy.
    rf_kwargs = dict(
        n_estimators=300, max_depth=16, min_samples_leaf=1,
        class_weight=None, n_jobs=-1, random_state=42,
    )
    if rf_params:
        rf_kwargs.update(rf_params)
    rf = RandomForestClassifier(**rf_kwargs)
    rf.fit(X_train_res, y_train_res)
    rf_pred = rf.predict(X_test)
    rf_f1 = f1_score(y_test, rf_pred, average="macro")

    lgbm = LGBMClassifier(
        n_estimators=300, num_leaves=31, objective="multiclass",
        class_weight="balanced", n_jobs=-1, random_state=42, verbose=-1,
    )
    lgbm.fit(X_train_res, y_train_res)
    lgbm_pred = lgbm.predict(X_test)
    lgbm_f1 = f1_score(y_test, lgbm_pred, average="macro")

    rf_proba = rf.predict_proba(X_test)  # columns in rf.classes_ order
    return {
        "rf": rf, "rf_f1": rf_f1, "rf_proba": rf_proba, "rf_classes": rf.classes_,
        "lgbm_f1": lgbm_f1,
        "y_test": y_test, "test_pos": test_pos,
    }


# ---------------------------------------------------------------------------
# Step 6 (A2): Optuna study — tune the RF, objective = mean OOF macro-F1
# across folds (doc: "macro-F1 or balanced accuracy, not raw accuracy").
# ---------------------------------------------------------------------------
def run_optuna_study(X, y, folds, n_trials):
    import optuna
    from imblearn.over_sampling import SMOTE
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.metrics import f1_score

    def objective(trial):
        params = {
            "n_estimators": trial.suggest_int("n_estimators", 100, 500, step=50),
            # max_depth=None (unbounded) dropped from the search 2026-07-29.
            # On the full 567k-row dataset those draws dominate wall-time
            # (superlinear fit cost + they were the SHAP TreeExplainer blowup),
            # and they generalize worse than the bounded depths. Bounding the
            # tuning space mirrors the max_depth=16 cap already on the baseline
            # RF (train_fold) and keeps the full 40-trial Vertex run tractable.
            "max_depth": trial.suggest_categorical(
                "max_depth", [8, 12, 16, 24, 32]
            ),
            "min_samples_leaf": trial.suggest_int("min_samples_leaf", 1, 20),
            "class_weight": trial.suggest_categorical(
                "class_weight", [None, "balanced", "balanced_subsample"]
            ),
        }
        fold_scores = []
        for fold in folds:
            train_pos, test_pos = fold["train_pos"], fold["test_pos"]
            X_train, y_train = X[train_pos], y[train_pos]
            X_test, y_test = X[test_pos], y[test_pos]

            smote = SMOTE(random_state=42)
            X_train_res, y_train_res = smote.fit_resample(X_train, y_train)

            rf = RandomForestClassifier(
                n_jobs=-1, random_state=42, **params,
            )
            rf.fit(X_train_res, y_train_res)
            pred = rf.predict(X_test)
            fold_scores.append(f1_score(y_test, pred, average="macro"))
        return float(np.mean(fold_scores))

    study = optuna.create_study(direction="maximize", study_name="rf_v1_batch4")
    study.optimize(objective, n_trials=n_trials, show_progress_bar=False)

    logger.info("Optuna best macro-F1: %.4f", study.best_value)
    logger.info("Optuna best params: %s", study.best_params)
    return study.best_params


# ---------------------------------------------------------------------------
# Step 7 (A2): SHAP confirmation — guardrail only, never auto-drops.
# ---------------------------------------------------------------------------
def shap_confirmation(fold_results, feature_cols, sample_rows):
    import shap

    abs_shap_sum = np.zeros(len(feature_cols))
    total_rows = 0

    for fr in fold_results:
        rf = fr["rf"]
        test_pos = fr["test_pos"]
        n = min(sample_rows, len(test_pos))
        if n == 0:
            continue
        sample_idx = test_pos[:n]
        X_sample = fr.get("X_test_full")
        if X_sample is None:
            continue
        # feature_perturbation="interventional" with a small fixed background
        # instead of the default "tree_path_dependent". Combined with the
        # depth-16 cap on the baseline RF, this keeps TreeExplainer bounded
        # (the default recursive path-dependent algorithm was the >1h/fold
        # hang). check_additivity=False skips a costly full-tree verification
        # pass that isn't needed for a warn-only ranking guardrail.
        n_bg = min(100, len(X_sample))
        background = X_sample[:n_bg]
        explainer = shap.TreeExplainer(
            rf, data=background, feature_perturbation="interventional"
        )
        shap_values = explainer.shap_values(X_sample[:n], check_additivity=False)
        # shap_values: list of (n, n_features) per class, or (n, n_features, n_classes)
        if isinstance(shap_values, list):
            stacked = np.abs(np.stack(shap_values, axis=0)).sum(axis=0)  # (n, n_features)
        else:
            stacked = np.abs(shap_values).sum(axis=-1)
        abs_shap_sum += stacked.sum(axis=0)
        total_rows += n

    if total_rows == 0:
        logger.warning("SHAP confirmation skipped — no rows available.")
        return

    mean_abs_shap = abs_shap_sum / total_rows
    ranking = sorted(
        zip(feature_cols, mean_abs_shap), key=lambda kv: kv[1], reverse=True
    )
    logger.info("SHAP mean |value| ranking (desc):")
    for rank, (name, val) in enumerate(ranking, 1):
        logger.info("  %2d. %-20s %.6f", rank, name, val)

    bottom_6 = {name for name, _ in ranking[-6:]}
    for name in feature_cols:
        if name in bottom_6:
            logger.warning(
                "Retained feature '%s' ranks in the bottom 6 by mean |SHAP| "
                "on this refresh — historical SHAP selection may have "
                "drifted on new data. NOT auto-dropping; flag for human "
                "review.",
                name,
            )


# ---------------------------------------------------------------------------
# Step 8 (A2): refit final RF on all folds combined (full labeled set) with
# best Optuna params.
# NOTE / judgment call: "all folds combined" is read here as the full
# labeled dataset (X, y in their entirety) rather than the union of
# per-fold train_pos, since that full set is what's actually available for
# a production refit once CV has selected hyperparameters. SMOTE is applied
# to this full training set exactly as it was applied per-fold.
# ---------------------------------------------------------------------------
def refit_final_rf(X, y, best_params):
    from imblearn.over_sampling import SMOTE
    from sklearn.ensemble import RandomForestClassifier

    smote = SMOTE(random_state=42)
    X_res, y_res = smote.fit_resample(X, y)

    final_rf = RandomForestClassifier(n_jobs=-1, random_state=42, **best_params)
    final_rf.fit(X_res, y_res)
    logger.info("Final RF refit on %d rows (post-SMOTE) with params %s", len(y_res), best_params)
    return final_rf


# ---------------------------------------------------------------------------
# Step 9 (A2): capture buy/sell thresholds from OOF ROC curves.
# NOTE / judgment call: thresholds are derived from the concatenated
# out-of-fold probabilities produced by the per-fold RF models trained
# during Optuna's final pass over `folds` (train_fold, called again with the
# best params) using one-vs-rest ROC curves (LONG-vs-rest for buy_threshold,
# SHORT-vs-rest for sell_threshold), selecting the Youden's-J-optimal
# threshold (argmax(tpr - fpr)) on each. This is the "genuinely open"
# judgment the build doc calls out for A2 step 9 / A3.
# ---------------------------------------------------------------------------
def compute_thresholds(X, y, folds, best_params):
    from sklearn.metrics import roc_curve

    oof_proba_long = []
    oof_proba_short = []
    oof_y = []

    for fold in folds:
        fr = train_fold(X, y, fold["train_pos"], fold["test_pos"], rf_params=best_params)
        classes = list(fr["rf_classes"])
        long_col = classes.index(1)
        short_col = classes.index(-1)
        oof_proba_long.append(fr["rf_proba"][:, long_col])
        oof_proba_short.append(fr["rf_proba"][:, short_col])
        oof_y.append(fr["y_test"])

    y_all = np.concatenate(oof_y)
    proba_long = np.concatenate(oof_proba_long)
    proba_short = np.concatenate(oof_proba_short)

    fpr_l, tpr_l, thr_l = roc_curve((y_all == 1).astype(int), proba_long)
    buy_thr = float(thr_l[np.argmax(tpr_l - fpr_l)])

    fpr_s, tpr_s, thr_s = roc_curve((y_all == -1).astype(int), proba_short)
    sell_thr = float(thr_s[np.argmax(tpr_s - fpr_s)])

    # ROC thresholds can include +inf at the start of the curve; guard against
    # a degenerate 0.0 / inf threshold slipping into the contract (doc watch
    # list: "Thresholds left at 0.0 ... Themis evaluates every signal").
    buy_thr = min(max(buy_thr, 1e-3), 0.999) if np.isfinite(buy_thr) else 0.55
    sell_thr = min(max(sell_thr, 1e-3), 0.999) if np.isfinite(sell_thr) else 0.55

    logger.info("Buy threshold (LONG, OOF ROC, Youden's J): %.4f", buy_thr)
    logger.info("Sell threshold (SHORT, OOF ROC, Youden's J): %.4f", sell_thr)
    return buy_thr, sell_thr


# ---------------------------------------------------------------------------
# Section A3: skl2onnx export + contract generation.
# ---------------------------------------------------------------------------
def export_onnx_and_contract(final_rf, buy_thr, sell_thr, output_path):
    from skl2onnx import convert_sklearn
    from skl2onnx.common.data_types import FloatTensorType
    import onnx

    initial_type = [("float_input", FloatTensorType([None, len(FEATURE_COLS)]))]
    # target_opset pinned to 21: the Hermes C++ ONNX Runtime (1.18) supports
    # ai.onnx up to opset 21; newer skl2onnx defaults to 22, which ORT rejects
    # at load ("Opset 22 is under development"). 21 covers every op this RF
    # export emits. Bump this only in lockstep with the runtime Hermes ships.
    onx = convert_sklearn(
        final_rf, initial_types=initial_type,
        options={type(final_rf): {"zipmap": False}},
        target_opset=21,
    )

    # Verify the output node name Hermes searches for
    proto = onnx.load_from_string(onx.SerializeToString())
    out_names = [o.name for o in proto.graph.output]
    assert "probabilities" in out_names, f"Expected 'probabilities', got {out_names}"

    # Write ONNX
    onnx.save(proto, "/tmp/rf_v1.onnx")

    # Write the real 55-feature deploy contract (Section 7 schema)
    contract = {
        "strategy_name": "rf_v1",
        "model_file": "models/rf_v1.onnx",
        "features": FEATURE_COLS,  # 55, Section 2 order
        "input_shape": [1, len(FEATURE_COLS)],  # [1, 55]
        "output_type": "probabilities",
        "output_classes": OUTPUT_CLASSES,
        "buy_threshold": buy_thr,  # from A2 step 9
        "sell_threshold": sell_thr,  # from A2 step 9
        "stop_loss": 0.0015, "take_profit": 0.0025,
        "starting_capital": 100000.0,
        "deploy_mode": "paper", "symbols": ["NVDA"],
        "themis": {
            "max_position_pct": 0.20, "daily_loss_limit": 0.02,
            "max_drawdown": 0.10, "min_confidence": 0.55,
            "suppress_regime": 3, "no_trade_open_min": 15,
            "no_trade_close_min": 15, "max_trades_per_day": 50,
        },
        "alpaca_key": "", "alpaca_secret": "",  # injected from env, keep blank
        "db_connection_string": "postgresql://postgres:postgres@localhost:5432/stockdb",
        "http_port": 9090,
    }
    with open("/tmp/rf_v1_deploy.json", "w") as f:
        json.dump(contract, f, indent=2)

    logger.info("Wrote /tmp/rf_v1.onnx and /tmp/rf_v1_deploy.json")

    # Upload both to GCS (prose immediately following the A3 code block).
    # Only applies for a real gs:// output path — a local --output-path (used
    # to exercise this end-to-end before ANANKE_GCS_BUCKET/Vertex exist) skips
    # the upload; the artifacts above are already written to /tmp.
    if output_path.startswith("gs://"):
        _upload_to_gcs(output_path)
    else:
        logger.info(
            "output-path %r is not gs:// — skipping GCS upload (local run)",
            output_path,
        )
    return proto, contract


def _upload_to_gcs(output_path: str):
    import gcsfs

    base = output_path.rstrip("/")
    fs = gcsfs.GCSFileSystem()
    model_dst = f"{base}/models/rf_v1.onnx"
    contract_dst = f"{base}/configs/rf_v1_deploy.json"
    fs.put("/tmp/rf_v1.onnx", model_dst)
    fs.put("/tmp/rf_v1_deploy.json", contract_dst)
    logger.info("Uploaded model to %s", model_dst)
    logger.info("Uploaded contract to %s", contract_dst)


def main(argv=None):
    args = parse_args(argv)

    feat_clean, labels = load_data(args.data_path, args.labels_path)
    X, y = build_xy(feat_clean, labels)
    folds = build_folds(feat_clean)

    # Step 5: per-fold RF + LGBM baseline pass (diagnostic; default params)
    fold_results = []
    for fold in folds:
        fr = train_fold(X, y, fold["train_pos"], fold["test_pos"])
        # keep a reference to the raw test features for SHAP (step 7)
        fr["X_test_full"] = X[fold["test_pos"]]
        fold_results.append(fr)
        logger.info(
            "Fold %d — RF macro-F1: %.4f, LGBM macro-F1: %.4f",
            fold["fold"], fr["rf_f1"], fr["lgbm_f1"],
        )

    # Step 6: Optuna study on the RF
    best_params = run_optuna_study(X, y, folds, args.n_trials)

    # Step 7: SHAP confirmation (guardrail, warn-only)
    shap_confirmation(fold_results, FEATURE_COLS, args.shap_sample_rows)

    # Step 8: refit final RF with best params
    final_rf = refit_final_rf(X, y, best_params)

    # Step 9: thresholds from OOF ROC curves (re-run per-fold with best params)
    buy_thr, sell_thr = compute_thresholds(X, y, folds, best_params)

    # Step 10 / A3: export
    export_onnx_and_contract(final_rf, buy_thr, sell_thr, args.output_path)

    logger.info("Batch 4 training complete.")


if __name__ == "__main__":
    sys.exit(main())
