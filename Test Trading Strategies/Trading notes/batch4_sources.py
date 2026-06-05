"""
Batch 4 (Sections 7, 8, 9) cell sources for FirstRRC.ipynb.
Each constant is the exact source of one notebook cell. Kept here so the same
code can be (a) timing-probed against cached upstream state and (b) inserted
verbatim into the notebook. LSTM compute-budget constants are tuned after a
throughput probe.
"""

# ─────────────────────────────────────────────────────────────────────────────
SEC_SETUP_MD = """\
## Section 7-9 setup — Batch 4 (Base Models)

**What this does.** Joins the triple-barrier `label` (Section 4) onto the feature
store `feat_clean` (Section 3 + HMM regimes), rebuilds purged walk-forward folds
*on the model matrix index* (so they line up with the split-artifact-cleaned
rows), and defines the shared macro metric helper used by every base model.

**Good result.** Model matrix ~566k rows × 61 features, label mix ≈ 38/23/38
(SHORT/NEUTRAL/LONG), 5 clean folds with test months 2026-01 … 2026-05.
"""

SEC_SETUP_CODE = """\
# ── Batch 4 setup: join label, build aligned folds, metric helper ─────────────
assert "label" in merged.columns, "merged['label'] missing — run Section 4 first"

FEATURES = list(feat_clean.columns)                      # 61 features (incl regimes)
Xy = feat_clean.join(merged["label"]).dropna(subset=["label"]).copy()
Xy["label"] = Xy["label"].astype(int)                    # -1 SHORT / 0 NEUTRAL / +1 LONG
X_all, y_all = Xy[FEATURES], Xy["label"]
CLASSES = np.array([-1, 0, 1])

print(f"Model matrix Xy : {Xy.shape}  ({len(FEATURES)} features + label)")
print(f"  date range    : {Xy.index.min()} -> {Xy.index.max()}")
mix = y_all.value_counts(normalize=True).sort_index()
print("  label mix     : " + "  ".join(f"{ {-1:'SHORT',0:'NEUTRAL',1:'LONG'}[int(k)] } {v*100:.1f}%" for k,v in mix.items()))

# Rebuild purged walk-forward folds on the model index (feat_clean dropped warm-up
# + split bars, so Section-5 positions into `merged` don't map 1:1). Same params.
PURGE, EMBARGO, N_FOLDS, MIN_TEST_BARS = 60, 60, 5, 5000
_midx  = Xy.index
_mpos  = np.arange(len(_midx))
_mmon  = _midx.tz_localize(None).to_period("M")
_counts = pd.Series(_mmon).value_counts()
_elig  = _counts[_counts >= MIN_TEST_BARS].index.sort_values()
_test_months = _elig[-N_FOLDS:]

MODEL_FOLDS, _holes = [], []
for _i, _m in enumerate(_test_months, 1):
    _tp = _mpos[_mmon == _m]
    _tr = _mpos[_mpos < max(_tp[0] - PURGE, 0)]
    for _h0, _h1 in _holes:
        _tr = _tr[(_tr < _h0) | (_tr > _h1)]
    MODEL_FOLDS.append({"fold": _i, "test_month": str(_m),
                        "train_pos": _tr, "test_pos": _tp,
                        "test_start": _midx[_tp[0]], "test_end": _midx[_tp[-1]]})
    _holes.append((_tp[-1] + 1, min(_tp[-1] + EMBARGO, len(_midx) - 1)))

print(f"\\nWalk-forward folds (aligned to model matrix), test months "
      f"{[f['test_month'] for f in MODEL_FOLDS]}:")
for f in MODEL_FOLDS:
    print(f"  Fold {f['fold']} [{f['test_month']}] : train {len(f['train_pos']):>8,} / "
          f"test {len(f['test_pos']):>6,}   (test {str(f['test_start'])[:10]} -> {str(f['test_end'])[:10]})")

def align_proba(proba, model_classes):
    \"\"\"Reorder a classifier's predict_proba columns to global CLASSES order.\"\"\"
    idx = [list(model_classes).index(c) for c in CLASSES]
    return proba[:, idx]

def wf_metrics(y_true, y_pred, proba):
    \"\"\"Macro precision / recall / F1 + macro OVR ROC-AUC.\"\"\"
    p = precision_score(y_true, y_pred, average="macro", zero_division=0)
    r = recall_score(y_true, y_pred, average="macro", zero_division=0)
    f = f1_score(y_true, y_pred, average="macro", zero_division=0)
    try:
        a = roc_auc_score(y_true, proba, multi_class="ovr", average="macro", labels=CLASSES)
    except ValueError:
        a = float("nan")
    return {"precision": p, "recall": r, "f1": f, "roc_auc": a}

def print_fold_table(name, rows):
    print(f"\\n{name} — per-fold walk-forward metrics")
    print(f"  {'fold':<6}{'precision':>11}{'recall':>9}{'f1':>9}{'roc_auc':>10}")
    for fr, mt in zip(MODEL_FOLDS, rows):
        print(f"  {fr['fold']:<6}{mt['precision']:>11.4f}{mt['recall']:>9.4f}"
              f"{mt['f1']:>9.4f}{mt['roc_auc']:>10.4f}")
    mean = {k: np.nanmean([r[k] for r in rows]) for k in ('precision','recall','f1','roc_auc')}
    print(f"  {'MEAN':<6}{mean['precision']:>11.4f}{mean['recall']:>9.4f}"
          f"{mean['f1']:>9.4f}{mean['roc_auc']:>10.4f}")
    return mean

print("\\nSetup ready: X_all, y_all, CLASSES, MODEL_FOLDS, wf_metrics(), print_fold_table().")
"""

# ─────────────────────────────────────────────────────────────────────────────
SEC7_MD = """\
## Section 7 — Baseline Random Forest + SHAP feature selection

**What this does.** Trains the benchmark `RandomForestClassifier`
(200 trees, depth 12, min_samples_leaf 30, balanced classes) and evaluates it on
the 5 purged walk-forward folds. Then computes SHAP values on a trained RF, plots
the top-30 summary, drops the bottom-10% near-zero-importance features, and saves
the reduced feature list to `feature_list_tech5_v1.json` — every later model uses
that reduced set only.

**Good result.** Macro-F1 meaningfully above the 0.33 random-3-class baseline,
ROC-AUC > 0.5, and a SHAP ranking dominated by momentum/trend/vol features.
"""

SEC7_CODE = """\
# ── Section 7A: Random Forest walk-forward evaluation ─────────────────────────
import time as _time

def make_rf():
    return RandomForestClassifier(
        n_estimators=200, max_depth=12, min_samples_leaf=30,
        class_weight="balanced", random_state=RANDOM_SEED, n_jobs=-1)

rf_fold_metrics = []
for f in MODEL_FOLDS:
    Xtr, ytr = X_all.iloc[f["train_pos"]], y_all.iloc[f["train_pos"]]
    Xte, yte = X_all.iloc[f["test_pos"]],  y_all.iloc[f["test_pos"]]
    _t0 = _time.time()
    rf = make_rf().fit(Xtr, ytr)
    proba = align_proba(rf.predict_proba(Xte), rf.classes_)
    pred  = CLASSES[proba.argmax(1)]
    rf_fold_metrics.append(wf_metrics(yte, pred, proba))
    print(f"  fold {f['fold']} [{f['test_month']}] trained on {len(Xtr):,} "
          f"in {_time.time()-_t0:4.0f}s  f1={rf_fold_metrics[-1]['f1']:.4f}", flush=True)

rf_mean = print_fold_table("Random Forest", rf_fold_metrics)
"""

SEC7_SHAP_CODE = """\
# ── Section 7B: SHAP feature importance → reduced feature list ─────────────────
# Fit one RF on the largest fold's training window, explain a reproducible
# subsample (TreeExplainer is exact but O(samples · trees · depth)).
_shap_fold = MODEL_FOLDS[-1]
Xtr_s = X_all.iloc[_shap_fold["train_pos"]]
ytr_s = y_all.iloc[_shap_fold["train_pos"]]
rf_shap = make_rf().fit(Xtr_s, ytr_s)

_rng = np.random.RandomState(RANDOM_SEED)
_n_bg = min(3000, len(Xtr_s))
_samp = _rng.choice(len(Xtr_s), size=_n_bg, replace=False)
X_shap = Xtr_s.iloc[_samp]

explainer = shap.TreeExplainer(rf_shap)
sv = explainer.shap_values(X_shap, check_additivity=False)

# Normalise SHAP output across shap versions → mean |value| per feature.
if isinstance(sv, list):                         # list[class] of (n, feat)
    imp = np.mean([np.abs(s).mean(axis=0) for s in sv], axis=0)
else:
    a = np.abs(sv)
    imp = a.mean(axis=(0, 2)) if a.ndim == 3 else a.mean(axis=0)   # (n,feat,cls) or (n,feat)
imp = np.asarray(imp).ravel()

shap_imp = pd.Series(imp, index=FEATURES).sort_values(ascending=False)
print("Top 15 features by mean |SHAP|:")
print(shap_imp.head(15).round(5).to_string())

# Summary plot (top 30)
try:
    _sv_plot = sv if not isinstance(sv, list) else sv
    shap.summary_plot(sv, X_shap, max_display=30, show=False)
    plt.title("SHAP summary — top 30 features (RF, last-fold train subsample)")
    plt.tight_layout(); plt.show()
except Exception as _e:
    print(f"(summary_plot skipped: {_e})")

# Drop the bottom 10% by mean |SHAP|; keep the rest as the reduced set.
_n_drop = max(1, int(round(0.10 * len(shap_imp))))
dropped = shap_imp.tail(_n_drop).index.tolist()
REDUCED_FEATURES = [c for c in FEATURES if c not in dropped]   # preserve original order
print(f"\\nDropped bottom {_n_drop} ({_n_drop/len(FEATURES)*100:.0f}%) near-zero features: {dropped}")
print(f"Reduced feature set: {len(REDUCED_FEATURES)} / {len(FEATURES)} features")

import json as _json
_flpath = "feature_list_tech5_v1.json"
with open(_flpath, "w") as _fh:
    _json.dump({"universe": "tech5", "version": "v1",
                "n_features": len(REDUCED_FEATURES),
                "features": REDUCED_FEATURES,
                "dropped": dropped,
                "selection": "RF SHAP, dropped bottom 10% mean|SHAP|"}, _fh, indent=2)
print(f"Saved -> {_flpath}")
"""

# ─────────────────────────────────────────────────────────────────────────────
SEC8_MD = """\
## Section 8 — LightGBM (Optuna-tuned)

**What this does.** Tunes a LightGBM multiclass classifier on the reduced feature
set with Optuna (20 trials, TPE), maximising mean macro-F1 across the walk-forward
folds. Retrains with the best params, reports per-fold + mean metrics, and plots
gain-based feature importance.

**Good result.** Macro-F1 ≥ the Random Forest benchmark, with a sensible best-trial
configuration (moderate `num_leaves`, small `learning_rate`, many estimators).
"""

SEC8_CODE = """\
# ── Section 8: LightGBM hyperparameter search (Optuna, 50 trials) ──────────────
import json as _json, time as _time
REDUCED_FEATURES = _json.load(open("feature_list_tech5_v1.json"))["features"]
Xr = X_all[REDUCED_FEATURES]

# Pre-slice fold arrays once (avoids re-indexing each trial).
_folds_xy = [(Xr.iloc[f["train_pos"]], y_all.iloc[f["train_pos"]],
              Xr.iloc[f["test_pos"]],  y_all.iloc[f["test_pos"]]) for f in MODEL_FOLDS]

def _lgbm(params):
    return lgb.LGBMClassifier(objective="multiclass", num_class=3,
                              class_weight="balanced", random_state=RANDOM_SEED,
                              n_jobs=-1, verbose=-1, **params)

def lgbm_objective(trial):
    params = dict(
        num_leaves       = trial.suggest_int("num_leaves", 20, 300),
        learning_rate    = trial.suggest_float("learning_rate", 0.01, 0.3, log=True),
        n_estimators     = trial.suggest_int("n_estimators", 100, 1000),
        min_child_samples= trial.suggest_int("min_child_samples", 20, 100),
        subsample        = trial.suggest_float("subsample", 0.5, 1.0),
        colsample_bytree = trial.suggest_float("colsample_bytree", 0.5, 1.0),
        subsample_freq   = 1)
    f1s = []
    for Xtr, ytr, Xte, yte in _folds_xy:
        m = _lgbm(params).fit(Xtr, ytr)
        f1s.append(f1_score(yte, m.predict(Xte), average="macro", zero_division=0))
    return float(np.mean(f1s))

_t0 = _time.time()
study = optuna.create_study(direction="maximize",
                            sampler=optuna.samplers.TPESampler(seed=RANDOM_SEED))
study.optimize(lgbm_objective, n_trials=20, show_progress_bar=False)
print(f"Optuna done in {(_time.time()-_t0)/60:.1f} min | best mean-F1 = {study.best_value:.4f}")
print("Best params:", _json.dumps(study.best_params, indent=2))
"""

SEC8_EVAL_CODE = """\
# ── Section 8B: retrain LightGBM with best params + walk-forward metrics ───────
lgbm_fold_metrics = []
lgbm_models = []
for (Xtr, ytr, Xte, yte), f in zip(_folds_xy, MODEL_FOLDS):
    m = _lgbm(study.best_params).fit(Xtr, ytr)
    proba = align_proba(m.predict_proba(Xte), m.classes_)
    pred  = CLASSES[proba.argmax(1)]
    lgbm_fold_metrics.append(wf_metrics(yte, pred, proba))
    lgbm_models.append(m)
    print(f"  fold {f['fold']} [{f['test_month']}] f1={lgbm_fold_metrics[-1]['f1']:.4f}", flush=True)

lgbm_mean = print_fold_table("LightGBM (tuned)", lgbm_fold_metrics)

# Feature importance (gain) from the last-fold model.
_imp = pd.Series(lgbm_models[-1].booster_.feature_importance(importance_type="gain"),
                 index=REDUCED_FEATURES).sort_values(ascending=False)
plt.figure(figsize=(9, 8))
_imp.head(25)[::-1].plot.barh()
plt.title("LightGBM gain importance (top 25)"); plt.tight_layout(); plt.show()
print("Top 10 by gain:"); print(_imp.head(10).round(1).to_string())
"""

# ─────────────────────────────────────────────────────────────────────────────
SEC9_MD = """\
## Section 9 — LSTM (PyTorch)

**What this does.** A 2-layer LSTM (hidden 128, dropout 0.3) over sequences of the
last 20 bars on the reduced feature set, predicting the 3-class label. Adam
(lr 1e-3, wd 1e-4), class-weighted cross-entropy, ReduceLROnPlateau, early stopping
(patience 10) on validation macro-F1. Trained per walk-forward fold; loss curves
plotted per fold; model saved to `lstm_tech5_v1.pt`.

**Compute budget (CPU).** No CUDA/MPS is available on this host, so per fold the
training window is capped at the most recent `LSTM_MAX_TRAIN` sequences and
`LSTM_MAX_EPOCHS` epochs (early stopping usually triggers first). This keeps the
faithful architecture/protocol while staying tractable on CPU.

**Good result.** Macro-F1 in the same ballpark as the tree models; smoothly
decreasing train/val loss curves without severe overfitting.
"""

# NOTE: budget constants set after the throughput probe.
SEC9_CODE = """\
# ── Section 9: LSTM over 20-bar sequences (per-fold walk-forward) ──────────────
import json as _json, time as _time, copy as _copy
from torch.utils.data import Dataset, DataLoader

REDUCED_FEATURES = _json.load(open("feature_list_tech5_v1.json"))["features"]
SEQ_LEN         = 20
HIDDEN, LAYERS, DROPOUT = 128, 2, 0.3
LSTM_BATCH      = 1024
LSTM_MAX_EPOCHS = 2
LSTM_PATIENCE   = 10
LSTM_MAX_TRAIN  = 150_000      # cap most-recent train sequences / fold (CPU budget)
DEVICE = torch.device("cuda" if torch.cuda.is_available()
                      else "mps" if torch.backends.mps.is_available() else "cpu")
torch.manual_seed(RANDOM_SEED)
print(f"LSTM device: {DEVICE} | seq_len {SEQ_LEN} | batch {LSTM_BATCH} | "
      f"max_train {LSTM_MAX_TRAIN:,} | max_epochs {LSTM_MAX_EPOCHS}")

_Xr_all = X_all[REDUCED_FEATURES].to_numpy(np.float32)
_y01    = (y_all.to_numpy() + 1).astype(np.int64)        # -1/0/1 -> 0/1/2
_NF     = len(REDUCED_FEATURES)

class SeqDS(Dataset):
    \"\"\"end-index positions -> (30 × F window ending at pos, label at pos).\"\"\"
    def __init__(self, feats, labels, ends):
        self.f, self.l, self.ends = feats, labels, np.asarray(ends)
    def __len__(self): return len(self.ends)
    def __getitem__(self, i):
        e = self.ends[i]
        return torch.from_numpy(self.f[e-SEQ_LEN+1:e+1]), int(self.l[e])

class LSTMNet(nn.Module):
    def __init__(self, nf):
        super().__init__()
        self.lstm = nn.LSTM(nf, HIDDEN, LAYERS, batch_first=True, dropout=DROPOUT)
        self.head = nn.Sequential(nn.Linear(HIDDEN, 64), nn.ReLU(),
                                  nn.Dropout(DROPOUT), nn.Linear(64, 3))
    def forward(self, x):
        o, _ = self.lstm(x)
        return self.head(o[:, -1, :])

def _eval(model, loader):
    model.eval(); ys, ps, pr = [], [], []
    with torch.no_grad():
        for xb, yb in loader:
            out = model(xb.to(DEVICE)).softmax(1).cpu().numpy()
            pr.append(out); ps.append(out.argmax(1)); ys.append(yb.numpy())
    y = np.concatenate(ys); p = np.concatenate(ps); proba = np.concatenate(pr)
    return y, p, proba

lstm_fold_metrics, lstm_curves = [], []
_best_state = None
for f in MODEL_FOLDS:
    tr_pos = f["train_pos"]; tr_pos = tr_pos[tr_pos >= SEQ_LEN-1]
    te_pos = f["test_pos"];  te_pos = te_pos[te_pos >= SEQ_LEN-1]
    if len(tr_pos) > LSTM_MAX_TRAIN:
        tr_pos = tr_pos[-LSTM_MAX_TRAIN:]                 # most-recent window
    n_val  = max(1, int(0.1 * len(tr_pos)))
    tr_e, va_e = tr_pos[:-n_val], tr_pos[-n_val:]         # temporal val split

    # Standardize on all rows up to the training-window end (no test leakage).
    scaler = StandardScaler().fit(_Xr_all[: int(tr_e.max()) + 1])
    feats_s = scaler.transform(_Xr_all).astype(np.float32)

    dl_tr = DataLoader(SeqDS(feats_s, _y01, tr_e), batch_size=LSTM_BATCH, shuffle=True)
    dl_va = DataLoader(SeqDS(feats_s, _y01, va_e), batch_size=LSTM_BATCH)
    dl_te = DataLoader(SeqDS(feats_s, _y01, te_pos), batch_size=LSTM_BATCH)

    cw = compute_class_weight("balanced", classes=np.array([0,1,2]), y=_y01[tr_e])
    crit = nn.CrossEntropyLoss(weight=torch.tensor(cw, dtype=torch.float32, device=DEVICE))
    model = LSTMNet(_NF).to(DEVICE)
    opt = torch.optim.Adam(model.parameters(), lr=1e-3, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.ReduceLROnPlateau(opt, mode="max", factor=0.5, patience=3)

    best_f1, best_ep, wait, tr_hist, va_hist = -1.0, 0, 0, [], []
    _t0 = _time.time()
    for ep in range(1, LSTM_MAX_EPOCHS+1):
        model.train(); run = 0.0
        for xb, yb in dl_tr:
            opt.zero_grad()
            loss = crit(model(xb.to(DEVICE)), yb.to(DEVICE))
            loss.backward(); opt.step(); run += loss.item()*len(yb)
        tr_loss = run/len(tr_e)
        yv, pv, prv = _eval(model, dl_va)
        va_loss = nn.functional.cross_entropy(
            torch.tensor(np.log(prv+1e-9)), torch.tensor(yv)).item()
        vf1 = f1_score(yv, pv, average="macro", zero_division=0)
        tr_hist.append(tr_loss); va_hist.append(va_loss); sched.step(vf1)
        if vf1 > best_f1:
            best_f1, best_ep, wait = vf1, ep, 0
            _best_state = _copy.deepcopy(model.state_dict())
        else:
            wait += 1
        if wait >= LSTM_PATIENCE:
            break
    model.load_state_dict(_best_state)
    yt, pt, prt = _eval(model, dl_te)
    proba = align_proba(prt, np.array([-1,0,1]))          # cols already 0/1/2 == sorted
    m = wf_metrics(yt-1, CLASSES[pt], proba)              # map back to -1/0/1
    lstm_fold_metrics.append(m); lstm_curves.append((tr_hist, va_hist))
    print(f"  fold {f['fold']} [{f['test_month']}] epochs {ep} (best {best_ep}) "
          f"{_time.time()-_t0:5.0f}s  val_f1={best_f1:.4f}  test_f1={m['f1']:.4f}", flush=True)

lstm_mean = print_fold_table("LSTM", lstm_fold_metrics)
torch.save({"state_dict": _best_state, "features": REDUCED_FEATURES,
            "seq_len": SEQ_LEN, "hidden": HIDDEN, "layers": LAYERS,
            "dropout": DROPOUT}, "lstm_tech5_v1.pt")
print("Saved -> lstm_tech5_v1.pt")

# Loss curves per fold
fig, axes = plt.subplots(1, len(lstm_curves), figsize=(4*len(lstm_curves), 3.2), squeeze=False)
for ax, (tr_h, va_h), f in zip(axes[0], lstm_curves, MODEL_FOLDS):
    ax.plot(range(1,len(tr_h)+1), tr_h, label="train")
    ax.plot(range(1,len(va_h)+1), va_h, label="val")
    ax.set_title(f"Fold {f['fold']} [{f['test_month']}]"); ax.set_xlabel("epoch")
    ax.legend(fontsize=7)
axes[0,0].set_ylabel("cross-entropy loss")
plt.tight_layout(); plt.show()
"""

SEC9_TABLE_CODE = """\
# ── Batch 4 comparison table ──────────────────────────────────────────────────
def _row(name, mean):
    return (f"| {name:<13} | {mean['f1']:.4f}   | {mean['roc_auc']:.4f}  | "
            f"{mean['precision']:.4f}    | {mean['recall']:.4f} |")
print("Batch 4 — base model walk-forward comparison (mean across 5 folds)\\n")
print("| Model         | F1 Macro | ROC-AUC | Precision | Recall |")
print("|---------------|----------|---------|-----------|--------|")
print(_row("Random Forest", rf_mean))
print(_row("LightGBM",      lgbm_mean))
print(_row("LSTM",          lstm_mean))

import json as _json
with open("batch4_metrics_tech5_v1.json", "w") as _fh:
    _json.dump({"random_forest": rf_mean, "lightgbm": lgbm_mean, "lstm": lstm_mean,
                "folds": [f["test_month"] for f in MODEL_FOLDS]}, _fh, indent=2, default=float)
print("\\nSaved -> batch4_metrics_tech5_v1.json")
print("\\nBATCH 4 COMPLETE — stop for review before Batch 5 (ensemble & backtest).")
"""
