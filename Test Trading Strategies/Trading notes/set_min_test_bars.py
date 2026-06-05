"""
Set MIN_TEST_BARS = 5000 in the Section 5 fold-generation cell (cell 19) of
FirstRRC.ipynb and re-run it (plus its dependency chain) to regenerate the fold table
with genuine outputs. Cell 20 (Batch-2 summary) also lists the folds, so it is
refreshed too to keep the notebook consistent.
"""
import nbformat
from nbclient import NotebookClient

NB = "/Users/phantom/Quant/Anake/Test Trading Strategies/FirstRRC.ipynb"
WORKDIR = "/Users/phantom/Quant/Anake/Test Trading Strategies"
FOLD_IDX, SUMMARY_IDX = 19, 20
CHAIN = [3, 7, 8, 9, 10, 14, 16, FOLD_IDX, SUMMARY_IDX]   # run order (skip unchanged 17)

nb = nbformat.read(NB, as_version=4)

# --- edit cell 19 source: MIN_TEST_BARS 1000 -> 5000 ---
old = "".join(nb.cells[FOLD_IDX]["source"])
assert "MIN_TEST_BARS = 1000" in old, "expected literal MIN_TEST_BARS = 1000 not found"
new = old.replace("MIN_TEST_BARS = 1000", "MIN_TEST_BARS = 5000")
nb.cells[FOLD_IDX]["source"] = new

src = {i: ("".join(nb.cells[i]["source"]) if i != FOLD_IDX else new) for i in CHAIN}

tmp = nbformat.v4.new_notebook()
tmp.metadata = nb.metadata
setup = ("%matplotlib inline\n"
         "import os, numpy as np, pandas as pd\n"
         "import matplotlib, matplotlib.pyplot as plt\n"
         "from sqlalchemy import create_engine, text")
tmp.cells = [nbformat.v4.new_code_cell(setup)]
tmp.cells += [nbformat.v4.new_code_cell(src[i]) for i in CHAIN]

print("Re-running fold chain with MIN_TEST_BARS = 5000 ...")
NotebookClient(tmp, timeout=1200, kernel_name="python3",
               resources={"metadata": {"path": WORKDIR}}).execute()
print("Execution complete.\n")

def streams(cell):
    return "".join("".join(o.get("text", [])) if o.get("output_type") == "stream"
                   else ("ERROR: %s: %s" % (o.get("ename"), o.get("evalue")) if o.get("output_type") == "error" else "")
                   for o in cell["outputs"])

for k, idx in enumerate(CHAIN):
    tcell = tmp.cells[1 + k]
    nb.cells[idx]["outputs"] = tcell["outputs"]
    nb.cells[idx]["execution_count"] = tcell.get("execution_count")

print("================ SECTION 5 FOLD TABLE (cell 19) ================")
print(streams(tmp.cells[1 + CHAIN.index(FOLD_IDX)]))
print("================ BATCH-2 SUMMARY (cell 20) =====================")
print(streams(tmp.cells[1 + CHAIN.index(SUMMARY_IDX)]))

nbformat.validate(nb)
nbformat.write(nb, NB)
print("\nNotebook updated & valid:", NB)
