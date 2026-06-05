"""
Run FirstRRC.ipynb's existing code cells (Sections 0-6 + addendum) in one process
and pickle the upstream kernel state needed by Batch 4. Lets Batch 4 development
iterate without re-loading the DB / refitting the HMM each time.
"""
import os, sys, json, pickle, warnings
import matplotlib
matplotlib.use("Agg")
warnings.filterwarnings("ignore")

NB_DIR = "/Users/phantom/Quant/Anake/Test Trading Strategies"
NB = os.path.join(NB_DIR, "FirstRRC.ipynb")
os.chdir(NB_DIR)                                   # SDK import + relative paths resolve here

nb = json.load(open(NB))
code_cells = [(i, "".join(c["source"])) for i, c in enumerate(nb["cells"])
              if c["cell_type"] == "code"]

g = {"__name__": "__main__", "display": lambda *a, **k: None}
for i, src in code_cells:
    print(f"\n===== exec cell {i} =====", flush=True)
    try:
        exec(compile(src, f"<cell {i}>", "exec"), g)
    except Exception as e:
        # Cells 4/5/6 are stray exploratory display cells (e.g. undefined `df`);
        # they build no pipeline state. Warn and continue, validate vars at end.
        print(f"[skipped cell {i}: {type(e).__name__}: {e}]")

required = ("merged", "feat_clean", "FOLDS", "LABEL_CONFIG", "RANDOM_SEED")
missing = [k for k in required if k not in g]
if missing:
    print(f"[FATAL] required vars never defined: {missing}")
    sys.exit(1)
state = {k: g[k] for k in required}
print("\n=== upstream state ===")
print("merged    :", state["merged"].shape)
print("feat_clean:", state["feat_clean"].shape)
print("FOLDS     :", len(state["FOLDS"]))
out = os.path.join(NB_DIR, "Trading notes", "_batch4_cache.pkl")
with open(out, "wb") as fh:
    pickle.dump(state, fh, protocol=5)
print("Saved cache ->", out, f"({os.path.getsize(out)/1e6:.0f} MB)")
