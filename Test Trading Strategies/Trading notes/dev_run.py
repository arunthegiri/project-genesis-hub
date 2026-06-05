"""
Dev harness: load cached upstream state, set up the same imports as notebook
Section 0, run the Batch 4 setup cell, then run requested section(s) or a timing
probe.  Usage:  python dev_run.py [setup|probe|rf|shap|lgbm|lstm|all]
"""
import os, sys, json, pickle, time, warnings, copy
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np, pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import precision_score, recall_score, f1_score, roc_auc_score
from sklearn.utils.class_weight import compute_class_weight
import lightgbm as lgb
import optuna, shap, torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset
optuna.logging.set_verbosity(optuna.logging.WARNING)
warnings.filterwarnings("ignore")

NB_DIR = "/Users/phantom/Quant/Anake/Test Trading Strategies"
os.chdir(NB_DIR)                                  # artifacts saved alongside notebook
sys.path.insert(0, os.path.join(NB_DIR, "Trading notes"))
import batch4_sources as B

RANDOM_SEED = 42
np.random.seed(RANDOM_SEED); torch.manual_seed(RANDOM_SEED)
torch.set_num_threads(os.cpu_count() or 4)

st = pickle.load(open(os.path.join(NB_DIR, "Trading notes", "_batch4_cache.pkl"), "rb"))
G = dict(globals())
G.update(st)                                      # merged, feat_clean, FOLDS, LABEL_CONFIG, RANDOM_SEED

def run(src, label):
    print(f"\n########## {label} ##########", flush=True)
    exec(compile(src, f"<{label}>", "exec"), G)

mode = sys.argv[1] if len(sys.argv) > 1 else "setup"
run(B.SEC_SETUP_CODE, "SETUP")

if mode == "probe":
    X_all, y_all = G["X_all"], G["y_all"]; MF = G["MODEL_FOLDS"]; CLASSES = G["CLASSES"]
    f = MF[-1]
    Xtr, ytr = X_all.iloc[f["train_pos"]], y_all.iloc[f["train_pos"]]
    Xte, yte = X_all.iloc[f["test_pos"]],  y_all.iloc[f["test_pos"]]
    print(f"\n[probe] last fold train {len(Xtr):,} test {len(Xte):,}")
    # RF one fold
    t=time.time()
    rf=RandomForestClassifier(n_estimators=500,max_depth=12,min_samples_leaf=30,
        class_weight="balanced",random_state=42,n_jobs=-1).fit(Xtr,ytr)
    print(f"[probe] RF 500-tree fit (1 fold): {time.time()-t:.0f}s")
    # LGBM one fit (mid params)
    t=time.time()
    m=lgb.LGBMClassifier(objective="multiclass",num_class=3,class_weight="balanced",
        n_estimators=500,num_leaves=128,learning_rate=0.05,random_state=42,n_jobs=-1,verbose=-1).fit(Xtr,ytr)
    print(f"[probe] LGBM 500-est fit (1 fold): {time.time()-t:.0f}s")
    # LSTM throughput: time ~20 batches of one epoch on capped train
    import numpy as _np
    RED = json.load(open("feature_list_tech5_v1.json"))["features"] if os.path.exists("feature_list_tech5_v1.json") else list(X_all.columns)[:40]
    Xr = X_all[RED].to_numpy(_np.float32); y01=(y_all.to_numpy()+1).astype(_np.int64)
    SEQ=30; NF=len(RED); dev=torch.device("cpu")
    tr_pos=f["train_pos"]; tr_pos=tr_pos[tr_pos>=SEQ-1][-150000:]
    sc=StandardScaler().fit(Xr[:int(tr_pos.max())+1]); fs=sc.transform(Xr).astype(_np.float32)
    class DS(torch.utils.data.Dataset):
        def __init__(s,e): s.e=_np.asarray(e)
        def __len__(s): return len(s.e)
        def __getitem__(s,i): e=s.e[i]; return torch.from_numpy(fs[e-SEQ+1:e+1]), int(y01[e])
    dl=DataLoader(DS(tr_pos),batch_size=1024,shuffle=True)
    class Net(nn.Module):
        def __init__(s): super().__init__(); s.l=nn.LSTM(NF,128,2,batch_first=True,dropout=0.3); s.h=nn.Linear(128,3)
        def forward(s,x): o,_=s.l(x); return s.h(o[:,-1,:])
    net=Net().to(dev); opt=torch.optim.Adam(net.parameters(),lr=1e-3); crit=nn.CrossEntropyLoss()
    t=time.time(); nb=0
    for xb,yb in dl:
        opt.zero_grad(); loss=crit(net(xb),yb); loss.backward(); opt.step(); nb+=1
        if nb>=20: break
    dt=time.time()-t; per=dt/nb
    n_batches=int(_np.ceil(len(tr_pos)/1024))
    print(f"[probe] LSTM {nb} batches {dt:.1f}s -> {per*1000:.0f}ms/batch; "
          f"full epoch ~{per*n_batches:.0f}s on {len(tr_pos):,} seqs ({n_batches} batches)")
    print(f"[probe] est 5 folds × 20 epochs ≈ {per*n_batches*20*5/60:.0f} min")
elif mode == "rf":
    run(B.SEC7_CODE, "SEC7_RF"); run(B.SEC7_SHAP_CODE, "SEC7_SHAP")
elif mode == "shap":
    run(B.SEC7_SHAP_CODE, "SEC7_SHAP")
elif mode == "lgbm":
    run(B.SEC8_CODE, "SEC8"); run(B.SEC8_EVAL_CODE, "SEC8_EVAL")
elif mode == "lstm":
    run(B.SEC9_CODE, "SEC9")
elif mode == "all":
    for s,l in [(B.SEC7_CODE,"SEC7_RF"),(B.SEC7_SHAP_CODE,"SEC7_SHAP"),
                (B.SEC8_CODE,"SEC8"),(B.SEC8_EVAL_CODE,"SEC8_EVAL"),
                (B.SEC9_CODE,"SEC9"),(B.SEC9_TABLE_CODE,"TABLE")]:
        run(s,l)
print("\n[dev_run done]")
