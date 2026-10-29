"""Train the Random Forest water-quality classifier from YOUR labelled data.

    python train_models.py --csv data/labelled_samples.csv [--validated]

CSV columns: ph, tds, ntu, temp, label    (label = safe | warning | unsafe)
Labels should come from BIS limits + lab-checked samples (project deck, slide 10).
Pass --validated ONLY if the labels were confirmed by a lab. The dashboard shows "NOT lab-validated" otherwise.

There is deliberately no option to train on simulated data: a model trained on our own rule outputs would just
copy the rules and look more trustworthy than it is.
"""
from __future__ import annotations

import argparse
import csv
import json
import time
from pathlib import Path

import joblib
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix
from sklearn.model_selection import train_test_split

FEATURES = ["ph", "tds", "ntu", "temp"]
LABELS = {"safe", "warning", "unsafe"}
OUT = Path(__file__).resolve().parent / "models"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True)
    ap.add_argument("--validated", action="store_true", help="labels were confirmed by lab tests")
    a = ap.parse_args()

    X, y = [], []
    with open(a.csv, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            try:
                feats = [float(row[k]) for k in FEATURES]
            except (KeyError, ValueError):
                continue
            label = row.get("label", "").strip().lower()
            if label in LABELS:
                X.append(feats)
                y.append(label)
    if len(X) < 100 or len(set(y)) < 2:
        raise SystemExit(f"Need ≥ 100 labelled rows with ≥ 2 classes (got {len(X)} rows, classes {sorted(set(y))}).")

    X, y = np.array(X), np.array(y)
    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)
    model = RandomForestClassifier(n_estimators=200, class_weight="balanced", random_state=42).fit(Xtr, ytr)
    pred = model.predict(Xte)
    acc = accuracy_score(yte, pred)
    labels = sorted(set(y))
    print(classification_report(yte, pred))
    print("Confusion matrix (rows = true, cols = predicted):", labels)
    print(confusion_matrix(yte, pred, labels=labels))

    OUT.mkdir(exist_ok=True)
    joblib.dump(model, OUT / "quality_rf.joblib")
    meta = {"trained_at": time.strftime("%Y-%m-%d %H:%M"), "rows": int(len(X)), "test_accuracy": round(float(acc), 4),
            "classes": labels, "features": FEATURES, "validated": bool(a.validated), "source_csv": Path(a.csv).name}
    (OUT / "quality_rf.json").write_text(json.dumps(meta, indent=2))
    print(f"\nSaved models/quality_rf.joblib  (test accuracy {acc:.1%}). Restart the backend to load it.")


if __name__ == "__main__":
    main()
