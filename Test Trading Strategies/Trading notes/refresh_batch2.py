"""
Re-run the Batch-2 chain of FirstRRC.ipynb against the fully-backfilled DB and write
GENUINE refreshed outputs back into the notebook. Now that all 5 symbols cover
2020-07 -> 2026-06 (no 2025-02..2026-02 gap), the Section 2 merge and the Section 5
purged walk-forward fold selection both change.

Executes, in one shared kernel:
  loaders cells [3,7,8,9,10] -> Section 2 merge [14] -> Section 4 labels [16] ->
  label plot [17] -> Section 5 folds [19] -> Batch-2 summary [20].
Then transplants each cell's real outputs back into the notebook.
"""
import nbformat
from nbclient import NotebookClient

NB = "/Users/phantom/Quant/Anake/Test Trading Strategies/FirstRRC.ipynb"
WORKDIR = "/Users/phantom/Quant/Anake/Test Trading Strategies"
CHAIN = [3, 7, 8, 9, 10, 14, 16, 17, 19, 20]   # notebook cell indices, in run order

nb = nbformat.read(NB, as_version=4)
src = {i: "".join(nb.cells[i]["source"]) for i in CHAIN}

# Temp notebook: a lightweight setup cell (numpy/pandas/matplotlib/sqlalchemy that the
# heavy Section-0 cell would normally provide) followed by the chain in order.
tmp = nbformat.v4.new_notebook()
tmp.metadata = nb.metadata
setup = ("%matplotlib inline\n"
         "import os, numpy as np, pandas as pd\n"
         "import matplotlib, matplotlib.pyplot as plt\n"
         "from sqlalchemy import create_engine, text")
tmp.cells = [nbformat.v4.new_code_cell(setup)]
tmp.cells += [nbformat.v4.new_code_cell(src[i]) for i in CHAIN]

print("Executing Batch-2 chain in a fresh kernel (this runs the triple-barrier loop)...")
NotebookClient(tmp, timeout=1200, kernel_name="python3",
               resources={"metadata": {"path": WORKDIR}}).execute()
print("Execution complete.\n")

def streams(cell):
    out = []
    for o in cell["outputs"]:
        if o.get("output_type") == "stream":
            out.append("".join(o.get("text", [])))
        elif o.get("output_type") == "error":
            out.append("ERROR: %s: %s" % (o.get("ename"), o.get("evalue")))
    return "".join(out)

# tmp.cells[0] is setup; tmp.cells[1+k] corresponds to CHAIN[k]
for k, idx in enumerate(CHAIN):
    tcell = tmp.cells[1 + k]
    nb.cells[idx]["outputs"] = tcell["outputs"]
    nb.cells[idx]["execution_count"] = tcell.get("execution_count")

# Echo the cells the user asked about.
print("================ SECTION 2 MERGE (cell 14) ================")
print(streams(tmp.cells[1 + CHAIN.index(14)]))
print("================ SECTION 5 WALK-FORWARD (cell 19) =========")
print(streams(tmp.cells[1 + CHAIN.index(19)]))
print("================ BATCH-2 SUMMARY (cell 20) ================")
print(streams(tmp.cells[1 + CHAIN.index(20)]))

nbformat.validate(nb)
nbformat.write(nb, NB)
print("\nNotebook updated & valid:", NB)
