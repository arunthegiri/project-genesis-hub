#!/bin/bash
# Generates a minimal 5-feature, 3-class RandomForest model exported to ONNX,
# plus a matching deploy contract, for the Part 4 inference test.
#
# Outputs (next to this script):
#   tests/test_model.onnx     — TreeEnsembleClassifier, input [N,5] -> probs [N,3]
#   tests/test_contract.json  — EngineConfig contract (5 features, 3 classes)
#
# Requires: scikit-learn, skl2onnx (pip install skl2onnx).
set -e
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

OUTDIR="$DIR" python - <<'PY'
import os, json
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from skl2onnx import convert_sklearn
from skl2onnx.common.data_types import FloatTensorType

out = os.environ["OUTDIR"]

# Deterministic synthetic data: 5 features, 3 classes keyed off feature 0.
# Class order matches the contract: 0=SHORT, 1=NEUTRAL, 2=LONG.
rng = np.random.default_rng(0)
N = 600
X = rng.normal(size=(N, 5)).astype(np.float32)
y = np.digitize(X[:, 0], [-0.43, 0.43]).astype(np.int64)

clf = RandomForestClassifier(n_estimators=20, max_depth=4, random_state=0)
clf.fit(X, y)

# zipmap=False -> probabilities come out as a plain float tensor [N,3]
# (not a sequence of maps), which the C++ runtime can read directly.
onx = convert_sklearn(
    clf, "rf_test",
    initial_types=[("float_input", FloatTensorType([None, 5]))],
    options={id(clf): {"zipmap": False}},
    target_opset=12)

model_path = os.path.join(out, "test_model.onnx")
with open(model_path, "wb") as f:
    f.write(onx.SerializeToString())

contract = {
    "strategy_name": "rf_test",
    "model_file": "tests/test_model.onnx",
    "features": ["rsi_14", "ema_9", "ema_21", "volume_ratio", "hmm_regime"],
    "input_shape": [1, 5],
    "output_type": "probabilities",
    "output_classes": ["SHORT", "NEUTRAL", "LONG"],
    "buy_threshold": 0.5,
    "sell_threshold": 0.5,
    "stop_loss": 0.0015,
    "take_profit": 0.0025,
    "starting_capital": 100000.0,
    "deploy_mode": "paper",
    "symbols": ["NVDA"],
    "alpaca_key": "",
    "alpaca_secret": "",
    "db_connection_string": "",
    "http_port": 9090,
}
with open(os.path.join(out, "test_contract.json"), "w") as f:
    json.dump(contract, f, indent=2)

print("wrote", model_path)
print("wrote", os.path.join(out, "test_contract.json"))
print("classes_:", clf.classes_.tolist())
PY
