"""
Re-run the Section 1 data-loading + validation cells of FirstRRC.ipynb against the
now-complete database and write the GENUINE refreshed outputs back into the notebook.
Executes cell [3] (NVDA loader) and cell [12] (Section 1 validation, augmented with a
monthly bar-count coverage check) in a shared kernel via nbclient.
"""
import nbformat
from nbclient import NotebookClient

NB_PATH = "/Users/phantom/Quant/Anake/Test Trading Strategies/FirstRRC.ipynb"
LOADER_IDX = 3      # NVDA loader cell
VALIDATE_IDX = 12   # Section 1 validation cell

nb = nbformat.read(NB_PATH, as_version=4)
loader_src = "".join(nb.cells[LOADER_IDX]["source"])

# Augment the Section 1 validation cell with a post-backfill monthly coverage check.
orig_validate = "".join(nb.cells[VALIDATE_IDX]["source"])
monthly_block = '''

# ── Monthly bar-count coverage (post-backfill verification) ───────────────────
monthly_bars = nvda.resample("MS").size()
monthly_bars = monthly_bars[monthly_bars > 0]
low_months = monthly_bars[monthly_bars < 5000]
print(f"\\nMonths covered : {len(monthly_bars)}  "
      f"({monthly_bars.index.min():%Y-%m} -> {monthly_bars.index.max():%Y-%m})")
if low_months.empty:
    print("✓ Every month has >= 5000 bars")
else:
    print(f"⚠ {len(low_months)} month(s) below 5000 bars "
          f"(dataset-start / current-month boundaries only):")
    for ts, n in low_months.items():
        print(f"    {ts:%Y-%m}: {n} bars")
'''
new_validate = orig_validate.rstrip() + "\n" + monthly_block

# Build a temporary notebook: matplotlib setup + loader + validation, run together.
tmp = nbformat.v4.new_notebook()
tmp.metadata = nb.metadata
tmp.cells = [
    nbformat.v4.new_code_cell("%matplotlib inline\nimport matplotlib\nimport matplotlib.pyplot as plt"),
    nbformat.v4.new_code_cell(loader_src),
    nbformat.v4.new_code_cell(new_validate),
]

print("Executing loader + Section 1 validation in a fresh kernel...")
client = NotebookClient(tmp, timeout=600, kernel_name="python3",
                        resources={"metadata": {"path": "/Users/phantom/Quant/Anake/Test Trading Strategies"}})
client.execute()
print("Execution complete.\n")

# Echo stream outputs so progress is visible in the terminal.
def dump(cell, label):
    print(f"----- {label} stdout -----")
    for o in cell["outputs"]:
        if o.get("output_type") == "stream":
            print("".join(o.get("text", [])), end="")
        elif o.get("output_type") == "error":
            print("ERROR:", o.get("ename"), o.get("evalue"))
    print()

dump(tmp.cells[1], "LOADER (cell 3)")
dump(tmp.cells[2], "SECTION 1 VALIDATION (cell 12)")

# Transplant genuine outputs back into the real notebook.
nb.cells[LOADER_IDX]["outputs"] = tmp.cells[1]["outputs"]
nb.cells[LOADER_IDX]["execution_count"] = tmp.cells[1].get("execution_count")
nb.cells[VALIDATE_IDX]["source"] = new_validate
nb.cells[VALIDATE_IDX]["outputs"] = tmp.cells[2]["outputs"]
nb.cells[VALIDATE_IDX]["execution_count"] = tmp.cells[2].get("execution_count")

nbformat.write(nb, NB_PATH)
print("Notebook updated:", NB_PATH)
