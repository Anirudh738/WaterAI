"""The three project models, kept honest.

1. Random Forest (water-quality screening): loaded from models/quality_rf.joblib ONLY if it exists
   (train it with train_models.py on a labelled, lab-checked CSV). Without it, the rule engine decides.
   Even with it, the model can only make the verdict stricter — never turn a rule "warning/unsafe/unknown" into "safe".
2. Linear Regression (tank forecast): fitted live with scikit-learn on the last 30 min of level readings.
3. Isolation Forest (anomalies): unsupervised, fitted live on the recent window of each sensor.
"""
from __future__ import annotations

import json
import time
from typing import Optional

import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.linear_model import LinearRegression

from .config import ROOT
from .schemas import Reading
from .screening import RANK, THRESHOLDS

MODELS_DIR = ROOT / "models"
QUALITY_PATH = MODELS_DIR / "quality_rf.joblib"
QUALITY_META = MODELS_DIR / "quality_rf.json"
FEATURES = ["ph", "tds", "ntu", "temp"]


# --------------------------------------------------------------------------- 1. Random Forest
class QualityModel:
    def __init__(self) -> None:
        self.model = None
        self.meta: dict = {}
        self.error: Optional[str] = None
        if QUALITY_PATH.exists():
            try:
                import joblib

                self.model = joblib.load(QUALITY_PATH)
                self.meta = json.loads(QUALITY_META.read_text()) if QUALITY_META.exists() else {}
            except Exception as e:  # corrupt / incompatible artifact → fall back to rules, say so
                self.error = f"Could not load {QUALITY_PATH.name}: {e}"
                self.model = None

    @property
    def status(self) -> str:
        if self.model is None:
            return "not-trained (rule engine active)" if not self.error else f"load-failed (rule engine active)"
        return "trained" + ("" if self.meta.get("validated") else " (NOT lab-validated)")

    def predict(self, r: Optional[Reading]) -> Optional[dict]:
        if self.model is None or r is None:
            return None
        vals = [getattr(r, k) for k in FEATURES]
        if any(v is None for v in vals):
            return {"label": None, "note": "Model skipped: a required reading is missing"}
        x = np.array([vals], dtype=float)
        label = str(self.model.predict(x)[0]).lower()
        proba = None
        if hasattr(self.model, "predict_proba"):
            p = self.model.predict_proba(x)[0]
            proba = {str(c).lower(): round(float(v), 3) for c, v in zip(self.model.classes_, p)}
        return {"label": label, "probabilities": proba, "meta": self.meta}


def combine(rule_status: str, model_out: Optional[dict]) -> str:
    """Model may only escalate. 'unknown' from rules is never upgraded."""
    if not model_out or not model_out.get("label") or model_out["label"] not in RANK:
        return rule_status
    m = model_out["label"]
    if rule_status == "unknown":
        return "unsafe" if m == "unsafe" else "unknown"
    return m if RANK[m] > RANK[rule_status] else rule_status


# --------------------------------------------------------------------------- 2. Linear Regression
def human_mins(m: float) -> str:
    if m < 60:
        return f"{round(m)} min"
    h, r = int(m // 60), round(m % 60)
    return f"{h} h {r} min" if r else f"{h} h"


def forecast_tank(readings: list[Reading], now: Optional[float] = None, t: dict = THRESHOLDS) -> dict:
    now = time.time() if now is None else now
    window = [r for r in readings if r.ts >= now - 30 * 60 and r.level is not None]
    last = readings[-1] if readings else None
    base = {
        "reliable": False,
        "quality_note": "",
        "slope_per_hour": None,
        "r2": None,
        "points": len(window),
        "current_level": last.level if last else None,
        "trend": "unknown",
        "eta_minutes": None,
        "eta_label": None,
        "projection": [],
        "method": "scikit-learn LinearRegression on the last 30 min of tank level",
        "model": "Linear Regression",
    }
    if last is None or now - last.ts > t["stale_after_sec"]:
        return {**base, "quality_note": "Latest level reading is stale or missing — forecast disabled."}
    if len(window) < 15:
        return {**base, "quality_note": f"Only {len(window)} level readings in the last 30 min (need ≥ 15)."}
    span_min = (window[-1].ts - window[0].ts) / 60
    if span_min < 20:
        return {**base, "quality_note": f"Only {span_min:.0f} min of history (need ≥ 20 min)."}

    t0 = window[0].ts
    x = np.array([[(r.ts - t0) / 3600] for r in window])
    y = np.array([r.level for r in window], dtype=float)
    reg = LinearRegression().fit(x, y)
    slope = float(reg.coef_[0])
    r2 = float(reg.score(x, y)) if np.var(y) > 0 else 1.0
    pump_changed = any(r.pump != window[0].pump for r in window)
    steady = abs(slope) < 0.5
    reliable = (not pump_changed) and (steady or r2 >= 0.6)
    x_now = (now - t0) / 3600
    current = float(reg.predict([[x_now]])[0])
    trend = "steady" if steady else ("filling" if slope > 0 else "draining")
    eta = None
    if trend == "draining":
        target = t["level"]["pump_on_below"]
        eta = max(0.0, (current - target) / -slope * 60)
        label = f"Reaches {target}% (pump-on level) in ~{human_mins(eta)}"
    elif trend == "filling":
        target = t["level"]["pump_off_above"]
        eta = max(0.0, (target - current) / slope * 60)
        label = f"Reaches {target}% (pump-off level) in ~{human_mins(eta)}"
    else:
        label = "Level roughly steady (< 0.5 %/h change)"
    horizon = min(eta if eta is not None else 180, 360)
    projection = []
    for k in range(25):
        ts = now + horizon * 60 * k / 24
        lvl = float(reg.predict([[(ts - t0) / 3600]])[0])
        projection.append({"ts": int(ts), "level": round(min(100, max(0, lvl)), 1)})
    note = f"Fit on {len(window)} points over {span_min:.0f} min, R² = {r2:.2f}."
    if pump_changed:
        note = "Pump switched during the last 30 min, so a straight-line fit is unreliable."
    elif not reliable:
        note = f"Usage is irregular (R² = {r2:.2f} < 0.60) — treat the estimate as rough."
    return {
        **base,
        "reliable": reliable,
        "quality_note": note,
        "slope_per_hour": round(slope, 3),
        "r2": round(r2, 3),
        "current_level": last.level,
        "trend": trend,
        "eta_minutes": round(eta, 1) if eta is not None else None,
        "eta_label": label,
        "projection": projection,
    }


# --------------------------------------------------------------------------- 3. Isolation Forest
HYPOTHESES = {
    "tds-up": ["Sewage or saline water entering the supply", "Switch to a different source (e.g. borewell)", "Loose probe or electrical noise, if a single spike"],
    "tds-down": ["Rainwater or RO water mixing in", "Probe lifted out of the water or an air bubble on it"],
    "ntu-up": ["Sediment stirred up during refill or after rain", "Pipe repair or burst upstream", "Algae / biofilm growth", "Air bubble past the optical sensor, if very brief"],
    "ntu-down": ["Sediment settling after a disturbance"],
    "ph-down": ["pH probe drift — recalibrate", "Acidic contamination", "Dissolved CO₂ from a new source"],
    "ph-up": ["Alkaline cleaning-agent residue", "pH probe drift"],
    "temp-up": ["Sun heating the tank or pipes", "Temperature probe exposed to air"],
    "temp-down": ["Cold water from a new source", "Probe exposed to air at night"],
}
MIN_DEV = {"ph": 0.15, "tds": 40.0, "ntu": 0.5, "temp": 2.0}  # ignore tiny wiggles even if "isolated"


def detect_anomalies(readings: list[Reading], window_sec: int = 7 * 86400) -> list[dict]:
    """Per sensor: features = [value, deviation from rolling median]. Isolation Forest scores every point;
    a point is an anomaly only if the forest isolates it AND it deviates meaningfully from its local baseline.
    Consecutive flagged points become one event."""
    if not readings:
        return []
    end = readings[-1].ts
    rs = [r for r in readings if r.ts >= end - window_sec]
    events: list[dict] = []
    for k in ("ph", "tds", "ntu", "temp"):
        pts = [(r.ts, getattr(r, k)) for r in rs if getattr(r, k) is not None]
        if len(pts) < 120:
            continue
        ts = np.array([p[0] for p in pts])
        v = np.array([p[1] for p in pts], dtype=float)
        # rolling median baseline over the previous ~2 h of points (fast approximation: strided median)
        base = _rolling_median(v, 121)
        dev = v - base
        long_med = float(np.median(v))
        x = np.column_stack([v, dev])
        forest = IsolationForest(n_estimators=100, contamination=0.01, random_state=0).fit(x)
        flagged = (forest.predict(x) == -1) & (np.abs(dev) >= MIN_DEV[k])
        scores = -forest.score_samples(x)
        # 1) contiguous flagged runs → segments
        segs: list[list[int]] = []  # [first, last, peak]
        i = 0
        while i < len(v):
            if not flagged[i]:
                i += 1
                continue
            j = i
            while j + 1 < len(v) and flagged[j + 1] and ts[j + 1] - ts[j] <= 600:
                j += 1
            peak = i + int(np.argmax(np.abs(dev[i : j + 1])))
            # a move back toward the long-term normal is a recovery, not a new anomaly
            if abs(v[peak] - long_med) >= abs(base[peak] - long_med):
                segs.append([i, j, peak])
            i = j + 1
        # 2) merge segments of the same direction less than 30 min apart into one event
        merged: list[list[int]] = []
        for sg in segs:
            if merged:
                m = merged[-1]
                same_dir = np.sign(dev[m[2]]) == np.sign(dev[sg[2]])
                if same_dir and ts[sg[0]] - ts[m[1]] <= 1800:
                    m[3] += sg[1] - sg[0] + 1
                    m[1] = sg[1]
                    if abs(dev[sg[2]]) > abs(dev[m[2]]):
                        m[2] = sg[2]
                    continue
            merged.append([sg[0], sg[1], sg[2], sg[1] - sg[0] + 1])
        for first, last, peak, npts in merged:
            direction = "up" if dev[peak] > 0 else "down"
            hyps = list(HYPOTHESES.get(f"{k}-{direction}", ["Unusual change — check the sensor and source"]))
            if npts <= 2 and ts[last] - ts[first] < 120:
                hyps.insert(0, "Single-reading spike: most likely a sensor glitch or noise")
            events.append({
                "ts": int(ts[peak]),
                "sensor": k,
                "value": round(float(v[peak]), 2),
                "baseline": round(float(base[peak]), 2),
                "score": round(float(scores[peak]), 3),
                "direction": direction,
                "points": int(npts),
                "duration_min": round(float(ts[last] - ts[first]) / 60, 1),
                "hypotheses": hyps,
                "model": "Isolation Forest (unsupervised, fitted on the recent window)",
            })
    events.sort(key=lambda e: e["ts"], reverse=True)
    return events


def _rolling_median(v: np.ndarray, w: int) -> np.ndarray:
    """Trailing median (uses only past points, so a jump stands out against what came before)."""
    n = len(v)
    out = np.empty(n)
    step = max(1, w // 12)
    # recompute the median every `step` points; good enough and fast for ~50k points
    for start in range(0, n, step):
        lo = max(0, start - w)
        hist = v[lo:start] if start > 0 else v[:1]
        out[start : start + step] = np.median(hist) if len(hist) else v[start]
    return out
