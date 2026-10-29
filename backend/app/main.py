"""WaterIQ AI backend. Run:  uvicorn app.main:app --port 8000   (from the backend/ folder)

Serves the API under /api and, if frontend/dist exists, the built dashboard at /.
"""
from __future__ import annotations

import hmac
import time
from datetime import datetime
from typing import Literal, Optional

from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from . import llm
from .alerts import AlertStore, derive_alerts
from .config import ROOT, settings
from .ml import QualityModel, combine, detect_anomalies, forecast_tank
from .schemas import AskRequest, IncomingReading, PumpRequest, Reading
from .screening import DISCLAIMER, THRESHOLDS, screen
from .sources import DataSource, SourceError, make_source

VERSION = "1.0.0"
RANGES = {"1h": 3600, "24h": 86400, "7d": 7 * 86400, "30d": 30 * 86400}

app = FastAPI(title="WaterIQ AI", version=VERSION, description="AI-based smart water monitoring — ESP32 + 5 sensors")
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["*"], allow_headers=["*"])

_source_error: Optional[str] = None
try:
    source: Optional[DataSource] = make_source()
except SourceError as e:  # e.g. firebase selected without a URL — keep the API up and explain
    source, _source_error = None, str(e)

quality = QualityModel()
alert_store = AlertStore()
_cache: dict[str, tuple[float, object]] = {}
_last_pump_cmd = 0.0


@app.exception_handler(SourceError)
async def _source_error_handler(_, exc: SourceError):
    return JSONResponse(status_code=503, content={"detail": str(exc)})


def src() -> DataSource:
    if source is None:
        raise HTTPException(503, _source_error or "Data source not configured")
    return source


def cached(key: str, ttl: float, fn):
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    val = fn()
    _cache[key] = (time.time(), val)
    return val


def history(seconds: int) -> list[Reading]:
    return src().history(time.time() - seconds)


def downsample(rs: list[Reading], bucket_sec: int) -> list[dict]:
    """Average into fixed buckets (keeps the last reading exact). Missing values stay null; gaps stay gaps."""
    if bucket_sec <= 10 or not rs:
        return [r.model_dump() for r in rs]
    out, cur, key = [], [], None
    for r in rs:
        b = r.ts // bucket_sec
        if key is not None and b != key:
            out.append(_avg(cur))
            cur = []
        key = b
        cur.append(r)
    if cur:
        out.append(_avg(cur))
    return out


def _avg(group: list[Reading]) -> dict:
    d: dict = {"ts": group[-1].ts, "pump": group[-1].pump}
    for k in ("ph", "tds", "ntu", "temp", "level"):
        vals = [getattr(r, k) for r in group if getattr(r, k) is not None]
        d[k] = round(sum(vals) / len(vals), 3) if vals else None
    return d


def status_payload() -> dict:
    latest = src().latest()
    rule = screen(latest)
    model_out = quality.predict(latest) if not rule["stale"] else None
    final = combine(rule["status"], model_out)
    return {
        **rule,
        "status": final,
        "rule_status": rule["status"],
        "engine": "BIS IS 10500 rule engine" + (" + Random Forest (escalate-only)" if model_out and model_out.get("label") else ""),
        "model": {"random_forest": quality.status, "output": model_out},
        "reading": latest.model_dump() if latest else None,
        "demo": src().demo,
        "data_source": src().name,
        "disclaimer": DISCLAIMER,
        "checked_at": int(time.time()),
    }


def anomalies_7d() -> list[dict]:
    def run():
        rs = history(7 * 86400)
        return detect_anomalies(rs)
    return cached("anomalies", 30, run)


def server_context() -> dict:
    """Grounding data for the LLM, built from the server's own data source."""
    rs = history(86400)
    st = status_payload()
    stats = {}
    for k in ("ph", "tds", "ntu", "temp", "level"):
        vals = [(r.ts, getattr(r, k)) for r in rs if getattr(r, k) is not None]
        if vals:
            lo, hi = min(vals, key=lambda p: p[1]), max(vals, key=lambda p: p[1])
            stats[k] = {"min": lo[1], "min_at": _iso(lo[0]), "max": hi[1], "max_at": _iso(hi[0]),
                        "mean": round(sum(v for _, v in vals) / len(vals), 3), "count": len(vals)}
    fc = forecast_tank(rs)
    fc.pop("projection", None)
    return {
        "data_mode": "DEMO (simulated data)" if src().demo else f"REAL device data via {src().name}",
        "generated_at": _iso(time.time()),
        "latest_reading": {**st["reading"], "ts": _iso(st["reading"]["ts"])} if st["reading"] else None,
        "screening": {k: st[k] for k in ("status", "reasons", "stale", "age_seconds")},
        "thresholds": THRESHOLDS,
        "last_24h": stats,
        "anomalies_7d": [{**a, "ts": _iso(a["ts"])} for a in anomalies_7d()[:8]],
        "tank_forecast": fc,
    }


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts).astimezone().isoformat(timespec="seconds")


# =========================================================================== endpoints
@app.get("/api/health")
def health():
    err = llm.configured_error()
    info = llm.llm_info()
    if err:
        info = {"configured": False, "provider": None, "model": None, "error": err}
    return {
        "ok": source is not None,
        "data_source": settings.data_source,
        "demo": settings.demo,
        "source_error": _source_error,
        "llm": info,
        "models": {
            "quality": f"Random Forest: {quality.status}",
            "forecast": "Linear Regression: active (fitted live on last 30 min)",
            "anomaly": "Isolation Forest: active (unsupervised, fitted live on last 7 days)",
        },
        "pump_control": "simulated" if settings.demo else ("enabled (token required)" if settings.pump_token else "disabled (set PUMP_CONTROL_TOKEN)"),
        "version": VERSION,
    }


@app.get("/api/readings/latest")
def readings_latest():
    r = src().latest()
    return {"reading": r.model_dump() if r else None, "demo": src().demo, "source": src().name}


@app.get("/api/readings/history")
def readings_history(range: Literal["1h", "24h", "7d", "30d"] = Query("24h")):
    secs = RANGES[range]
    rs = history(secs)
    bucket = {"1h": 0, "24h": 0, "7d": 60, "30d": 60}[range]
    return {"range": range, "resolution_sec": bucket or 10, "demo": src().demo, "source": src().name, "readings": downsample(rs, bucket)}


@app.post("/api/readings", status_code=201)
def ingest(pkt: IncomingReading, x_device_key: str = Header(""), x_rssi: Optional[int] = Header(None), x_firmware: Optional[str] = Header(None)):
    """ESP32 → server. Only when DATA_SOURCE=esp32. Requires header X-Device-Key = DEVICE_API_KEY."""
    s = src()
    if not s.accepts_ingest:
        raise HTTPException(409, f"Ingest is only enabled when DATA_SOURCE=esp32 (current: {s.name})")
    if not settings.device_api_key or not hmac.compare_digest(x_device_key, settings.device_api_key):
        raise HTTPException(401, "Invalid or missing X-Device-Key")
    r, issues = s.ingest(pkt, x_rssi, x_firmware)  # type: ignore[attr-defined]
    st = screen(r)
    return {"stored": not any("ignored" in i for i in issues), "issues": issues, "status": st["status"]}


@app.get("/api/water/status")
def water_status():
    return status_payload()


@app.get("/api/forecasts/latest")
def forecasts_latest():
    return {**forecast_tank(history(3600)), "demo": src().demo}


@app.get("/api/anomalies")
def anomalies():
    return {"anomalies": anomalies_7d(), "demo": src().demo}


@app.get("/api/alerts")
def alerts(state: Optional[Literal["open", "acknowledged", "resolved"]] = None):
    def build():
        return derive_alerts(history(30 * 86400), anomalies_7d())
    items = [{**a, "state": alert_store.get(a["id"])} for a in cached("alerts", 15, build)]
    if state:
        items = [a for a in items if a["state"] == state]
    return {"alerts": items, "demo": src().demo}


@app.post("/api/alerts/{alert_id}/{action}")
def alert_action(alert_id: str, action: Literal["acknowledge", "resolve", "reopen"]):
    new = {"acknowledge": "acknowledged", "resolve": "resolved", "reopen": "open"}[action]
    return {"id": alert_id, **alert_store.set(alert_id, new)}


@app.post("/api/ai/ask")
def ai_ask(req: AskRequest):
    # Client context is used when sent (it is what the user sees, e.g. browser demo data); else the server builds its own.
    ctx = req.context or server_context()
    if not llm.llm_info()["configured"] or llm.configured_error():
        return {"source": "demo", "provider": None, "model": None, "answer": llm.rule_answer(req.question, req.language, ctx),
                "note": llm.configured_error() or "No LLM_API_KEY on the server — this is a rule-based demo answer."}
    try:
        answer = llm.ask_llm(req.question, req.language, ctx)
    except llm.LlmError as e:
        return {"source": "demo", "provider": None, "model": None, "answer": llm.rule_answer(req.question, req.language, ctx),
                "note": f"{e}. Showing a rule-based demo answer instead."}
    return {"source": "llm", "provider": settings.llm_provider, "model": settings.resolved_model, "answer": answer}


@app.get("/api/device")
def device():
    return src().device()


@app.post("/api/device/pump")
def pump(req: PumpRequest, authorization: str = Header("")):
    """Pump control. Demo source → simulated. Real source → needs PUMP_CONTROL_TOKEN + server-side safety checks.
    The AI assistant has no access to this endpoint."""
    global _last_pump_cmd
    s = src()
    if not s.demo:
        if not settings.pump_token:
            raise HTTPException(403, "Pump control is disabled on this server (PUMP_CONTROL_TOKEN not set)")
        token = authorization.removeprefix("Bearer ").strip()
        if not hmac.compare_digest(token, settings.pump_token):
            raise HTTPException(401, "Invalid pump control token")
    if time.time() - _last_pump_cmd < 10:
        raise HTTPException(429, "Wait 10 s between pump commands (protects the relay and motor)")
    latest = s.latest()
    st = screen(latest)
    if req.on:
        if latest is None or latest.level is None:
            raise HTTPException(409, "Blocked: tank level unknown — the pump could overflow the tank")
        if st["stale"]:
            raise HTTPException(409, "Blocked: device data is stale — cannot confirm tank level")
        if latest.level >= THRESHOLDS["level"]["pump_off_above"]:
            raise HTTPException(409, f"Blocked: tank already at {latest.level:.0f}%")
        if st["status"] == "unsafe":
            raise HTTPException(409, "Blocked: water screening is UNSAFE — filling is interlocked")
    res = s.set_pump(req.on)
    _last_pump_cmd = time.time()
    return {"ok": True, "pump": req.on, **res}


@app.get("/api/device/commands")
def device_commands(x_device_key: str = Header("")):
    """ESP32 polls this for queued pump commands (DATA_SOURCE=esp32)."""
    if not settings.device_api_key or not hmac.compare_digest(x_device_key, settings.device_api_key):
        raise HTTPException(401, "Invalid or missing X-Device-Key")
    return {"command": src().pending_command()}


# --------------------------------------------------------------------------- built frontend (optional)
DIST = ROOT.parent / "frontend" / "dist"
if DIST.exists():
    app.mount("/", StaticFiles(directory=DIST, html=True), name="frontend")
