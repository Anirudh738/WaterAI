import time

from fastapi.testclient import TestClient

from app.main import app
from app.ml import combine, forecast_tank
from app.schemas import Reading
from app.screening import screen

c = TestClient(app)


def test_health_reports_demo_and_models():
    j = c.get("/api/health").json()
    assert j["ok"] and j["demo"] is True
    assert "not-trained" in j["models"]["quality"]  # never pretends a model was trained


def test_core_endpoints():
    for path in ["/api/readings/latest", "/api/water/status", "/api/forecasts/latest", "/api/alerts", "/api/device"]:
        assert c.get(path).status_code == 200, path
    h = c.get("/api/readings/history?range=1h").json()
    assert h["demo"] and len(h["readings"]) > 0
    assert c.get("/api/readings/history?range=2y").status_code == 422


def test_ask_without_key_is_labelled_demo():
    j = c.post("/api/ai/ask", json={"question": "Is the water safe?", "language": "hi"}).json()
    assert j["source"] == "demo" and "डेमो" in j["answer"]


def test_alert_actions():
    alerts = c.get("/api/alerts").json()["alerts"]
    aid = alerts[0]["id"]
    assert c.post(f"/api/alerts/{aid}/acknowledge").json()["state"] == "acknowledged"
    assert c.post(f"/api/alerts/{aid}/resolve").json()["state"] == "resolved"
    c.post(f"/api/alerts/{aid}/reopen")


def test_ingest_rejected_in_demo_mode():
    r = c.post("/api/readings", json={"ts": int(time.time()), "ph": 7.0}, headers={"X-Device-Key": "x"})
    assert r.status_code == 409


def test_missing_or_stale_is_never_safe():
    now = time.time()
    assert screen(None)["status"] == "unknown"
    assert screen(Reading(ts=int(now), ph=7.2, tds=None, ntu=0.5, temp=26, level=50), now)["status"] == "unknown"
    assert screen(Reading(ts=int(now - 600), ph=7.2, tds=300, ntu=0.5, temp=26, level=50), now)["status"] == "unknown"
    assert screen(Reading(ts=int(now), ph=7.2, tds=1000, ntu=0.5, temp=26, level=50), now)["status"] == "unsafe"
    assert screen(Reading(ts=int(now), ph=7.2, tds=300, ntu=0.5, temp=26, level=50), now)["status"] == "safe"


def test_model_can_only_escalate():
    assert combine("warning", {"label": "safe"}) == "warning"
    assert combine("safe", {"label": "unsafe"}) == "unsafe"
    assert combine("unknown", {"label": "safe"}) == "unknown"


def test_forecast_draining_tank():
    now = time.time()
    rs = [Reading(ts=int(now - 1800 + i * 10), level=80 - i * 0.05, pump=False) for i in range(180)]
    f = forecast_tank(rs, now)
    assert f["trend"] == "draining" and f["reliable"] and f["eta_minutes"] > 0
    assert forecast_tank(rs[:5], now)["reliable"] is False
