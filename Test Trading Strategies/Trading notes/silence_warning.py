"""
Silence the `to_period` tz-drop UserWarning in the Section 5 cell (cell 19) of
FirstRRC.ipynb by converting the already-UTC index to tz-naive before .to_period("M")
(month bucketing is identical). Re-runs the chain to confirm the warning is gone and
the fold table is unchanged, refreshing genuine outputs.
"""
import nbformat
from nbclient import NotebookClient

NB = "/Users/phantom/Quant/Anake/Test Trading Strategies/FirstRRC.ipynb"
WORKDIR = "/Users/phantom/Quant/Anake/Test Trading Strategies"
FOLD_IDX, SUMMARY_IDX = 19, 20
CHAIN = [3, 7, 8, 9, 10, 14, 16, FOLD_IDX, SUMMARY_IDX]

nb = nbformat.read(NB, as_version=4)
old = "".join(nb.cells[FOLD_IDX]["source"])
needle = 'months     = valid_idx.to_period("M")'
assert needle in old, "expected to_period line not found"
new = old.replace(needle, 'months     = valid_idx.tz_localize(None).to_period("M")')
nb.cells[FOLD_IDX]["source"] = new

src = {i: ("".join(nb.cells[i]["source"]) if i != FOLD_IDX else new) for i in CHAIN}
tmp = nbformat.v4.new_notebook(); tmp.metadata = nb.metadata
setup = ("%matplotlib inline\nimport os, numpy as np, pandas as pd\n"
         "import matplotlib, matplotlib.pyplot as plt\n"
         "from sqlalchemy import create_engine, text")
tmp.cells = [nbformat.v4.new_code_cell(setup)] + [nbformat.v4.new_code_cell(src[i]) for i in CHAIN]

print("Re-running fold chain after tz-naive fix ...")
NotebookClient(tmp, timeout=1200, kernel_name="python3",
               resources={"metadata": {"path": WORKDIR}}).execute()
print("Execution complete.\n")

fold_cell = tmp.cells[1 + CHAIN.index(FOLD_IDX)]
warned = any(o.get("output_type") == "stream" and o.get("name") == "stderr"
             and "UserWarning" in "".join(o.get("text", [])) for o in fold_cell["outputs"])
print("Any UserWarning/stderr remaining in cell 19:", warned)

for k, idx in enumerate(CHAIN):
    nb.cells[idx]["outputs"] = tmp.cells[1 + k]["outputs"]
    nb.cells[idx]["execution_count"] = tmp.cells[1 + k].get("execution_count")

print("\n================ SECTION 5 FOLD TABLE (cell 19) ================")
print("".join("".join(o.get("text", [])) for o in fold_cell["outputs"] if o.get("output_type") == "stream"))

nbformat.validate(nb); nbformat.write(nb, NB)
print("Notebook updated & valid:", NB)
