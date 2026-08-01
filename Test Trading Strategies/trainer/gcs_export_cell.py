# gcs_export_cell.py — standalone snippet, NOT imported/run as part of the
# trainer package.
#
# WHERE THIS GOES: paste this cell into `Test Trading Strategies/FirstRRC.ipynb`
# as a NEW cell immediately after Cell 32 (the "Section 3 addendum: remove
# NVDA stock-split artifact bars" cell, the last cell in the notebook as of
# this writing). Do NOT edit FirstRRC.ipynb directly here — this file is only
# the source snippet to copy in by hand.
#
# At that point in notebook execution, `feat_clean` (61 cols: 56 engineered +
# hmm_regime + regime_0/1/2/3, split-date bars already removed) and `merged`
# (full frame incl. `merged["label"]`, the -1/0/1 triple-barrier label) are
# both live in-kernel. This cell exports both to GCS for trainer/train.py to
# consume. Reference: firstRRCpipelinefinalinstructions.md Section A1.

import gcsfs, os

GCS_BUCKET = os.environ["ANANKE_GCS_BUCKET"]      # MUST SET, no gs:// prefix
GCS_PATH   = f"gs://{GCS_BUCKET}/ananke/v1"

# feat_clean = post-SHAP feature matrix (split-date artifacts removed, NaNs dropped)
# Align labels onto feat_clean's index — feat_clean.index ⊂ merged.index
labels = merged["label"].reindex(feat_clean.index)
assert labels.notna().all(), "label NaN leaked into feat_clean — alignment bug"

feat_clean.to_parquet(f"{GCS_PATH}/feat_clean.parquet")
labels.to_frame("label").to_parquet(f"{GCS_PATH}/labels.parquet")
print(f"Exported {len(feat_clean):,} rows × {feat_clean.shape[1]} features to {GCS_PATH}")
# Expect ~567,231 rows × 61 features (verified against notebook Cell 32 output).
# NVDA-target, wide-joined: SPY/AMD/TSLA/MSFT are feature COLUMNS, not stacked rows.
# The 61 → 55 SHAP drop happens in train.py, NOT here — export all 61.
