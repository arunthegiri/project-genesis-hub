"""trainer — Batch 4 (FirstRRC/rf_v1) training package.

Contains train.py, the Vertex AI custom-job entrypoint that loads the
Batch-3 feature store from GCS, trains the deployed rf_v1 RandomForest
model on the canonical 55-feature contract (Section 2 of
firstRRCpipelinefinalinstructions.md), and exports ONNX + the deploy
contract JSON consumed by the Hermes C++ engine.
"""
