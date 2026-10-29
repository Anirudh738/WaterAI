"""Deterministic BIS IS 10500-based screening. Same rules as the frontend (src/lib/screening.ts).
Missing, stale or invalid data never yields 'safe'."""
from __future__ import annotations

import time
from typing import Optional

from .schemas import VALID_RANGE, Reading

RANK = {"safe": 0, "unknown": 1, "warning": 2, "unsafe": 3}

THRESHOLDS = {
    "ph": {"safe_min": 6.7, "safe_max": 8.3, "warn_min": 6.5, "warn_max": 8.5},
    "tds": {"safe_max": 500, "warn_max": 1000, "probe_max": 1000},
    "ntu": {"safe_max": 1, "warn_max": 5},
    "temp": {"valid_min": 0, "valid_max": 60, "warn_above": 35},
    "level": {"pump_on_below": 20, "pump_off_above": 95},
    "stale_after_sec": 60,
}

DISCLAIMER = (
    "5-sensor screening only (pH, TDS, turbidity, temperature, level). It cannot detect bacteria, nitrate, "
    "fluoride, arsenic or heavy metals and is not a certificate of potability. Confirm with a lab test."
)


def _valid(k: str, v: Optional[float]) -> bool:
    if v is None:
        return False
    lo, hi = VALID_RANGE[k]
    return lo <= v <= hi


def sensor_status(k: str, v: Optional[float], t: dict = THRESHOLDS) -> tuple[str, str]:
    if not _valid(k, v):
        return "unknown", "No valid reading"
    assert v is not None
    if k == "ph":
        p = t["ph"]
        if v < p["warn_min"] or v > p["warn_max"]:
            return "unsafe", f"pH {v:.2f} outside {p['warn_min']}–{p['warn_max']}"
        if v < p["safe_min"] or v > p["safe_max"]:
            return "warning", f"pH {v:.2f} near the limit"
        return "safe", "pH within range"
    if k == "tds":
        p = t["tds"]
        if v >= p["probe_max"]:
            return "unsafe", f"TDS probe maxed out at {p['probe_max']} mg/L — lab test needed"
        if v >= p["warn_max"]:
            return "unsafe", f"TDS {v:.0f} mg/L ≥ {p['warn_max']}"
        if v > p["safe_max"]:
            return "warning", f"TDS {v:.0f} mg/L above {p['safe_max']} mg/L acceptable limit"
        return "safe", "TDS within limit"
    if k == "ntu":
        p = t["ntu"]
        if v > p["warn_max"]:
            return "unsafe", f"Turbidity {v:.2f} NTU > {p['warn_max']}"
        if v > p["safe_max"]:
            return "warning", f"Turbidity {v:.2f} NTU above {p['safe_max']} NTU acceptable limit"
        return "safe", "Turbidity within limit"
    if k == "temp":
        p = t["temp"]
        if v < p["valid_min"] or v > p["valid_max"]:
            return "unknown", f"Temperature {v:.1f} °C implausible — check DS18B20"
        if v > p["warn_above"]:
            return "warning", f"Water is warm ({v:.1f} °C)"
        return "safe", "Temperature normal"
    p = t["level"]
    if v < p["pump_on_below"]:
        return "warning", f"Tank low ({v:.0f}%)"
    if v > p["pump_off_above"]:
        return "warning", f"Tank near overflow ({v:.0f}%)"
    return "safe", "Tank level normal"


def screen(r: Optional[Reading], now: Optional[float] = None, t: dict = THRESHOLDS) -> dict:
    now = time.time() if now is None else now
    if r is None:
        return {"status": "unknown", "reasons": ["No readings received yet"], "stale": True, "age_seconds": None, "sensors": {}}
    age = int(now - r.ts)
    stale = age > t["stale_after_sec"]
    sensors = {}
    for k in ("ph", "tds", "ntu", "temp", "level"):
        st, reason = sensor_status(k, getattr(r, k), t)
        sensors[k] = {"status": st, "value": getattr(r, k), "reason": reason}
    status, reasons = "safe", []
    for k in ("ph", "tds", "ntu"):
        st = sensors[k]["status"]
        if RANK[st] > RANK[status]:
            status = st
        if st != "safe":
            reasons.append(sensors[k]["reason"])
    any_unknown = any(sensors[k]["status"] == "unknown" for k in ("ph", "tds", "ntu"))
    if any_unknown and status == "safe":
        status = "unknown"
    if sensors["temp"]["status"] == "unknown" and status == "safe":
        status = "warning"
        reasons.append("Temperature missing — pH/TDS compensation not possible")
    if stale:
        if status != "unsafe":
            status = "unknown"
        reasons.insert(0, f"Last reading is {age}s old (stale after {t['stale_after_sec']}s)")
    if status == "safe":
        reasons.append("pH, TDS and turbidity are within acceptable BIS limits")
    return {"status": status, "reasons": reasons, "stale": stale, "age_seconds": age, "sensors": sensors}


def worst(a: str, b: str) -> str:
    return a if RANK[a] >= RANK[b] else b
