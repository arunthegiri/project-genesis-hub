#!/usr/bin/env bash
# build_push_container.sh — build + push the FirstRRC Batch 4 custom training
# image to Artifact Registry, for the real Vertex AI run.
#
# Prereqs (already provisioned per RUN_ERRORS.md "Why the Python 3.7 track was
# abandoned"): Docker running locally, Artifact Registry API enabled on the
# project, repo `ananke-training` created in us-central1, and
#   gcloud auth configure-docker us-central1-docker.pkg.dev
# run once so docker can push to the registry.
#
# Usage:
#   ./build_push_container.sh [TAG]
# TAG defaults to a UTC timestamp. The pushed image URI is printed AND written
# to trainer/.last_image, which submit_vertex.sh reads by default.

set -euo pipefail

REGION="us-central1"
REPO="ananke-training"
IMAGE_NAME="firstrrc-trainer"

PROJECT="${ANANKE_GCP_PROJECT:-$(gcloud config get-value project 2>/dev/null)}"
if [[ -z "${PROJECT}" || "${PROJECT}" == "(unset)" ]]; then
  echo "ERROR: no project. Set ANANKE_GCP_PROJECT or 'gcloud config set project ...'." >&2
  exit 1
fi

TAG="${1:-$(date -u +%Y%m%d-%H%M%S)}"
IMAGE_URI="${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/${IMAGE_NAME}:${TAG}"

cd "$(dirname "$0")"  # trainer/ — this is the (small) build context

# --platform linux/amd64: Vertex workers are x86_64. (This Mac is Intel x86_64
# too, so it's a native build, but be explicit so it's still correct if the repo
# ever moves to Apple Silicon.)
echo ">> building ${IMAGE_URI}"
docker build --platform linux/amd64 -t "${IMAGE_URI}" -f Dockerfile .

echo ">> pushing ${IMAGE_URI}"
docker push "${IMAGE_URI}"

echo "${IMAGE_URI}" > .last_image
echo ">> done. image URI written to trainer/.last_image:"
echo "${IMAGE_URI}"
