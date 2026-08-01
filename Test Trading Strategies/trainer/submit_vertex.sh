#!/usr/bin/env bash
# submit_vertex.sh — submit the Batch 4 (rf_v1) training job to Vertex AI,
# running inside the custom python:3.13-slim container.
#
# This replaces the old prebuilt-image + --python-package-uris tarball approach.
# The Python-3.7 prebuilt image (scikit-learn-cpu.0-23) was abandoned after five
# dependency crashes — see RUN_ERRORS.md. The trainer code is now baked into the
# image (build_push_container.sh), so we pass container-image-uri, NOT
# executor-image-uri + python-package-uris + python-module.
#
# Prereqs:
#   1. ./build_push_container.sh   (builds + pushes the image, writes .last_image)
#   2. feat_clean.parquet / labels.parquet uploaded to
#      gs://${ANANKE_GCS_BUCKET}/ananke/v1/  (notebook GCS export cell)
#   3. Vertex's Compute Engine default SA has roles/storage.objectAdmin on the
#      bucket; local auth via `gcloud auth application-default login`.
#
# Env:
#   ANANKE_GCP_PROJECT   (required)
#   ANANKE_GCS_BUCKET    (required)
#   ANANKE_TRAINER_IMAGE (optional; defaults to the URI in trainer/.last_image)
#   ANANKE_N_TRIALS      (optional; Optuna trials, defaults to 40)

set -euo pipefail

if [[ -z "${ANANKE_GCS_BUCKET:-}" ]]; then
  echo "ERROR: ANANKE_GCS_BUCKET is unset. Set it before submitting the Vertex job." >&2
  exit 1
fi

if [[ -z "${ANANKE_GCP_PROJECT:-}" ]]; then
  echo "ERROR: ANANKE_GCP_PROJECT is unset. Set it before submitting the Vertex job." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
IMAGE_URI="${ANANKE_TRAINER_IMAGE:-}"
if [[ -z "${IMAGE_URI}" ]]; then
  if [[ -f "${SCRIPT_DIR}/.last_image" ]]; then
    IMAGE_URI="$(cat "${SCRIPT_DIR}/.last_image")"
  else
    echo "ERROR: no image. Run ./build_push_container.sh first, or set ANANKE_TRAINER_IMAGE." >&2
    exit 1
  fi
fi

N_TRIALS="${ANANKE_N_TRIALS:-40}"

# c2-standard-16: compute-optimized (high-clock vCPUs), better $/fit than n1 for
# the dense RF/LightGBM work here. 16 cores stays in the range where RF n_jobs=-1
# still scales before SMOTE's single-threaded resampling becomes the serial floor
# (Amdahl) — bigger boxes (30+ vCPU) mostly pay for cores SMOTE can't use.
# Override with ANANKE_MACHINE_TYPE if needed.
MACHINE_TYPE="${ANANKE_MACHINE_TYPE:-c2-standard-16}"

# Custom container: --worker-pool-spec takes container-image-uri (the image's
# ENTRYPOINT is `python -m trainer.train`; --args are appended to it). No
# python-module / executor-image-uri / python-package-uris — those are only for
# the prebuilt-image + sdist path we no longer use.
gcloud ai custom-jobs create \
  --project="${ANANKE_GCP_PROJECT}" \
  --region=us-central1 \
  --display-name=firstrrc-batch4 \
  --worker-pool-spec=machine-type=${MACHINE_TYPE},replica-count=1,container-image-uri="${IMAGE_URI}" \
  --args="--data-path=gs://${ANANKE_GCS_BUCKET}/ananke/v1/feat_clean.parquet,--labels-path=gs://${ANANKE_GCS_BUCKET}/ananke/v1/labels.parquet,--output-path=gs://${ANANKE_GCS_BUCKET}/ananke/v1/,--n-trials=${N_TRIALS}"

echo ">> submitted firstrrc-batch4 (machine=${MACHINE_TYPE}, n-trials=${N_TRIALS}) using image: ${IMAGE_URI}"
