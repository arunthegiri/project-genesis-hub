# Custom Vertex AI training container for FirstRRC Batch 4 (rf_v1).
#
# Replaces the prebuilt us-docker.pkg.dev/vertex-ai/training/scikit-learn-cpu.0-23
# image (Python 3.7), whose 2020-era preinstalled packages caused the dependency
# saga in RUN_ERRORS.md. This image pins Python 3.13 + the exact validated stack.
#
# Build context is the trainer/ directory itself (NOT its parent) — the parent
# "Test Trading Strategies/" holds a 459 MB .pkl and other large files that must
# not be shovelled into the build context. See build_push_container.sh and
# .dockerignore.
FROM python:3.13-slim

# lightgbm's wheel dynamically links libgomp (OpenMP) at runtime; it is the only
# non-Python system dependency in this stack (numpy/scipy/onnxruntime wheels
# bundle their own native libs).
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

ENV PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# Install deps first (own layer) so code edits don't bust the pip cache layer.
COPY requirements-lock.txt ./
RUN pip install --no-cache-dir -r requirements-lock.txt

# Copy the trainer package (build context = trainer/, so "." is that dir).
# .dockerignore trims notebooks/caches/docs; train.py + __init__.py land at
# /app/trainer/, importable as the top-level `trainer` package from WORKDIR.
COPY . /app/trainer

# Vertex appends the job's --args after this ENTRYPOINT, i.e. the container runs
#   python -m trainer.train --data-path=... --labels-path=... --output-path=... --n-trials=...
ENTRYPOINT ["python", "-m", "trainer.train"]
