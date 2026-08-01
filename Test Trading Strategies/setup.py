"""Packaging shim for the Vertex AI custom job (build doc Section A4).

Not part of the pinned spec (the build doc doesn't mention setup.py) — added
because `gcloud ai custom-jobs create --python-package-uris=...` requires a
pip-installable sdist, and `trainer/` as shipped is just loose modules.

install_requires is inlined rather than read from trainer/requirements.txt at
install time: setup.py is re-executed by pip on the remote worker from the
extracted sdist, whose cwd doesn't contain that file (it's not part of the
Python package, sdist only copies .py files under packages=). Keep this list
in sync with trainer/requirements.txt (the build doc's source of truth) by
hand.
"""

from setuptools import setup

requirements = [
    # Container preinstalls scikit-learn 0.23.1/numpy 1.18.5/scipy 1.4.1 on
    # Python 3.7; pip's legacy resolver won't upgrade "already satisfied"
    # packages on its own, so imbalanced-learn silently installed against an
    # incompatible sklearn and crashed at import time. Pin explicitly instead
    # of relying on transitive resolution. scikit-learn capped at <1.1 because
    # 1.1+ dropped Python 3.7 support (this container's ceiling).
    "scikit-learn>=1.0.2,<1.1",
    "scipy>=1.5.0",
    "numpy>=1.21.6",
    # Container preinstalls joblib 0.15.1; lightgbm's sklearn wrapper calls
    # joblib.cpu_count(only_physical_cores=...), a param that only exists in
    # joblib>=1.0. Same unpinned-package-vs-ancient-container pattern as
    # scikit-learn above. Capped <1.3 to stay inside the Python 3.7 range.
    "joblib>=1.1.1,<1.3",
    "lightgbm",
    "optuna",
    "shap",
    # 0.9.1 is the last release supporting Python 3.7 (0.10+ uses
    # positional-only-parameter syntax, a Python 3.8+ construct, which is a
    # SyntaxError on this container's interpreter). Also satisfies its own
    # scikit-learn>=1.0.2 requirement against the pin above.
    "imbalanced-learn==0.9.1",
    "hmmlearn",
    "ta",
    "tqdm",
    "skl2onnx",
    "onnx",
    "onnxruntime",
    "gcsfs",
    "pyarrow",
]

setup(
    name="trainer",
    version="0.1",
    packages=["trainer"],
    install_requires=requirements,
)
