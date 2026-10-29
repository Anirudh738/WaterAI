"""Alerts derived from history + an acknowledge/resolve state kept in data/alert_state.json."""
from __future__ import annotations

import json
import threading
import time
from typing import Optional

from .config import ROOT
from .schemas import Reading
from .screening import THRESHOLDS, sensor_status

RANK_ALERT = {"safe": 0, "unknown": 0, "warning": 1, "unsafe": 2}
STATE_FILE = ROOT / "data" / "alert_state.json"
LABEL = {"ph": "pH", "tds": "TDS", "ntu": "Turbidity", "temp": "Temperature", "level": "Tank level"}
UNIT = {"ph": "", "tds": " mg/L", "ntu": " NTU", "temp": " °C", "level": "%"}
NEXT_STEP = {
    ("ph", "unsafe"): "Stop drinking use. Re-check the pH probe with a 7.0 buffer, then get a lab test.",
    ("ph", "warning"): "Watch the trend; recalibrate the pH probe if it keeps drifting.",
    ("tds", "unsafe"): "Stop drinking use and switch the supply off. Collect a sample for a lab test.",
    ("tds", "warning"): "Check whether the water source changed. Re-test within the hour.",
    ("ntu", "unsafe"): "Do not drink. Let sediment settle, inspect the tank and inlet, and lab-test before use.",
    ("ntu", "warning"): "Inspect the tank inlet; recent refill or rain may have stirred sediment.",
    ("temp", "warning"): "Shade the tank or pipes; warm water speeds germ growth.",
    ("temp", "unknown"): "Check the DS18B20 wiring and that the probe is under water.",
    ("level", "warning"): "Check the pump and float logic; confirm the ultrasonic sensor is clear.",
}


class AlertStore:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.state: dict[str, dict] = {}
        try:
            self.state = json.loads(STATE_FILE.read_text())
        except Exception:
            self.state = {}

    def set(self, alert_id: str, state: str) -> dict:
        with self.lock:
            self.state[alert_id] = {"state": state, "at": int(time.time())}
            STATE_FILE.parent.mkdir(exist_ok=True)
            STATE_FILE.write_text(json.dumps(self.state))
            return self.state[alert_id]

    def get(self, alert_id: str) -> str:
        return self.state.get(alert_id, {}).get("state", "open")


def derive_alerts(readings: list[Reading], anomalies: list[dict], now: Optional[float] = None, t: dict = THRESHOLDS) -> list[dict]:
    """One alert per episode (when a sensor enters warning/unsafe), plus stale-data, gap and anomaly alerts."""
    now = time.time() if now is None else now
    out: list[dict] = []
    prev: dict[str, str] = {}
    calm_since: dict[str, int] = {}
    last_ts: Optional[int] = None
    for r in readings:
        if last_ts is not None and r.ts - last_ts > 10 * 60:
            mins = round((r.ts - last_ts) / 60)
            out.append(_alert(f"gap-{last_ts}", last_ts, "warning", "device", f"No data for {mins} min",
                              f"The device sent nothing between these times ({mins} min). Screening was Unknown during the gap.",
                              "Check device power and Wi-Fi. Look for brown-outs or router restarts.", None, "data"))
            prev, calm_since = {}, {}
        last_ts = r.ts
        for k in ("ph", "tds", "ntu", "temp", "level"):
            st, reason = sensor_status(k, getattr(r, k), t)
            if st in ("warning", "unsafe"):
                # new episode only if escalating, or if the sensor had been back to normal for >= 15 min (debounce)
                worse = RANK_ALERT[st] > RANK_ALERT.get(prev.get(k, "safe"), 0)
                if worse:
                    v = getattr(r, k)
                    sev = "info" if k == "level" else ("critical" if st == "unsafe" else "warning")
                    out.append(_alert(f"{k}-{st}-{r.ts}", r.ts, sev, k,
                                      reason if k == "level" else f"{LABEL[k]} {st.upper()}: {v}{UNIT[k]}", reason,
                                      NEXT_STEP.get((k, st), "Re-check the sensor and the source."), v, "threshold"))
                    prev[k] = st
                calm_since.pop(k, None)
            else:
                calm_since.setdefault(k, r.ts)
                if r.ts - calm_since[k] >= 15 * 60:
                    prev[k] = "safe"
    if readings and now - readings[-1].ts > t["stale_after_sec"]:
        age = int(now - readings[-1].ts)
        out.append(_alert(f"stale-{readings[-1].ts}", int(now), "critical", "device", f"Device data is stale ({age}s old)",
                          "No fresh reading. Screening shows Unknown — stale data is never treated as Safe.",
                          "Check ESP32 power, Wi-Fi and the data source.", None, "data"))
    for a in anomalies:
        out.append(_alert(f"anomaly-{a['sensor']}-{a['ts']}", a["ts"], "info" if a["hypotheses"][0].startswith("Single-reading") else "warning", a["sensor"],
                          f"Unusual {LABEL[a['sensor']]} {'jump' if a['direction'] == 'up' else 'drop'}",
                          f"{LABEL[a['sensor']]} reached {a['value']}{UNIT[a['sensor']]} vs a baseline of {a['baseline']}{UNIT[a['sensor']]}. "
                          f"Possible (unconfirmed) causes: {'; '.join(a['hypotheses'][:2])}.",
                          "Compare with neighbouring readings and inspect the sensor before acting.", a["value"], "anomaly"))
    out.sort(key=lambda a: a["ts"], reverse=True)
    return out[:200]


def _alert(id_, ts, severity, sensor, title, explanation, next_step, value, kind) -> dict:
    return {"id": id_, "ts": int(ts), "severity": severity, "sensor": sensor, "title": title,
            "explanation": explanation, "next_step": next_step, "value": value, "kind": kind}
