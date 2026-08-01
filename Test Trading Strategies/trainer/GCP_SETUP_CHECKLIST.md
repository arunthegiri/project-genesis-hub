# GCP Setup Checklist — FirstRRC Batch 4 (Vertex AI training)

These steps require your Google identity and a browser (Console + local
`gcloud` login). An agent cannot perform them. Once done, the Vertex
submission (`trainer/submit_vertex.sh`) and the notebook's GCS export cell
(both already written and parameterized on the env vars below) will work
without any further code changes.

Reference: `firstRRCpipelinefinalinstructions.md` Section A4 and
`AGENT_JUPYTER.md`.

## Steps

1. **Confirm project + billing.** Pick (or create) the GCP project this will
   run under, and confirm billing is enabled on it. Capture the project ID —
   you'll export it as `ANANKE_GCP_PROJECT`.

2. **Enable APIs** (Console → APIs & Services → Enable, or `gcloud services
   enable`):
   - Vertex AI API (`aiplatform.googleapis.com`)
   - Cloud Storage API (`storage.googleapis.com`)

3. **Create ONE regional bucket in `us-central1`.** Standard storage class is
   fine — this is a few GB of parquet/ONNX artifacts, not a data lake.
   Capture the bucket name (no `gs://` prefix, no trailing slash) — you'll
   export it as `ANANKE_GCS_BUCKET`.

4. **Grant the Compute Engine default service account bucket access.**
   The SA is `PROJECT_NUMBER-compute@developer.gserviceaccount.com` (find
   `PROJECT_NUMBER` under Project Settings). Grant it `roles/storage.objectAdmin`
   scoped to the bucket you just created (bucket-level IAM, not project-wide).

5. **Local auth:**
   ```bash
   gcloud auth login                       # your user identity, browser flow
   gcloud auth application-default login   # ADC, also browser flow
   gcloud config set project "$ANANKE_GCP_PROJECT"
   ```

6. **Set a budget alert** (Billing → Budgets & alerts). $30/month covers one
   `c2-standard-16` custom job (no GPU; ~$0.83/hr, so a full 40-trial run is
   ballpark $10–20 depending on wall-time) plus a few GB of storage. Override
   the machine with `ANANKE_MACHINE_TYPE` if you want to trade cost vs. speed.

7. **Export the two env vars** in your shell (and anywhere `train.py` /
   `submit_vertex.sh` / the notebook's export cells run):
   ```bash
   export ANANKE_GCP_PROJECT="your-project-id"
   export ANANKE_GCS_BUCKET="your-bucket-name"
   ```

## Explicitly do NOT provision

- No GPU (RF/LightGBM are CPU-bound; `n1-standard-8` is sufficient — see
  build doc Section A4 sizing note).
- No Vertex Endpoint (this is a batch training job, not an online-serving
  deployment — Hermes loads the ONNX file directly).
- No Workbench/managed notebook instance (you already have `FirstRRC.ipynb`
  running locally).

**SUPERSEDED (2026-07-23):** the earlier "No Artifact Registry" note is no
longer true. The prebuilt-image + `--python-package-uris` tarball path was
abandoned (Python-3.7 dependency saga, see `RUN_ERRORS.md`); the job now runs
in a custom `python:3.13-slim` container that **does** require Artifact
Registry. One-time setup: enable Artifact Registry API, create repo
`ananke-training` in `us-central1`, and run
`gcloud auth configure-docker us-central1-docker.pkg.dev`.

Skipping these avoids ghost charges from idle provisioned resources.

## After this checklist is done

1. Paste the GCS export cell and re-run it (or the whole notebook) — with
   `ANANKE_GCS_BUCKET` set, it now takes the real `gs://` branch instead of
   the local fallback and uploads `feat_clean.parquet` / `labels.parquet`.
2. Same for the HMM export cell → `hmm_params.json` (still local-only by
   default; uncomment the `gcsfs` upload lines at the bottom of
   `hmm_export_cell.py`'s pasted-in copy, or `gcloud storage cp` it up by
   hand).
3. Build + push the training container, then submit. (The old
   `--python-package-uris` tarball flow is retired — see the SUPERSEDED note
   above; `setup.py` is now only used for local `pip install -e .`, not for
   Vertex.)
   ```bash
   cd "Test Trading Strategies/trainer"
   ./build_push_container.sh          # builds python:3.13-slim image, pushes, writes .last_image
   ./submit_vertex.sh                 # submits using the URI in .last_image
   ```
   Optional overrides: `ANANKE_TRAINER_IMAGE=<uri> ./submit_vertex.sh` to pin a
   specific image, `ANANKE_N_TRIALS=30 ./submit_vertex.sh` to change Optuna
   trials (default 40).
4. Poll the job in the Vertex AI Console (Training → Custom jobs) until it
   completes, then pull the artifacts per build doc Section 4:
   ```bash
   gcloud storage cp gs://${ANANKE_GCS_BUCKET}/ananke/v1/models/rf_v1.onnx        hermes/models/rf_v1.onnx
   gcloud storage cp gs://${ANANKE_GCS_BUCKET}/ananke/v1/configs/rf_v1_deploy.json hermes/configs/rf_v1_deploy.json
   gcloud storage cp gs://${ANANKE_GCS_BUCKET}/ananke/v1/hmm_params.json          hermes/configs/hmm_params.json
   ```
   This is the point where `hermes/configs/rf_v1_deploy.json` should finally
   be overwritten with the real 55-feature contract — not before.
