"""Data sources behind one small interface. Pick with DATA_SOURCE=demo | esp32 | firebase.

- demo:     deterministic simulator. Always labelled demo. Pump is simulated.
- esp32:    the ESP32 POSTs readings to /api/readings; pump commands are queued and the ESP32 polls them.
- firebase: reads /live and /history from Firebase Realtime Database (REST); pump command is written to /commands/pump.
"""
from __future__ import annotations

import json
import threading
import time
from collections import deque
from pathlib import Path
from typing import Optional

import httpx

from .config import ROOT, settings
from .demo_data import DemoSimulator
from .schemas import IncomingReading, Reading

DATA_DIR = ROOT / "data"


class SourceError(RuntimeError):
    """Raised when the configured source (e.g. Firebase) cannot be reached. Shown to the user as a friendly error."""


class DataSource:
    name = "base"
    demo = False
    accepts_ingest = False

    def history(self, since: float) -> list[Reading]:
        raise NotImplementedError

    def latest(self) -> Optional[Reading]:
        raise NotImplementedError

    def device(self) -> dict:
        raise NotImplementedError

    def set_pump(self, on: bool) -> dict:
        raise NotImplementedError

    def pending_command(self) -> Optional[dict]:
        return None


# --------------------------------------------------------------------------- demo
class DemoSource(DataSource):
    name = "demo"
    demo = True

    def __init__(self) -> None:
        self.sim = DemoSimulator()
        self.lock = threading.Lock()

    def _tick(self) -> None:
        with self.lock:
            self.sim.advance()

    def history(self, since: float) -> list[Reading]:
        self._tick()
        return [r for r in self.sim.readings if r.ts >= since]

    def latest(self) -> Optional[Reading]:
        self._tick()
        return self.sim.readings[-1] if self.sim.readings else None

    def device(self) -> dict:
        return {
            "id": settings.device_id,
            "name": settings.device_name,
            "firmware": "aquaguard-esp32 v0.3.1 (simulated)",
            "rssi": -61,
            "online": True,
            "source": "Backend demo simulator (DATA_SOURCE=demo)",
        }

    def set_pump(self, on: bool) -> dict:
        with self.lock:
            self.sim.pump = on
        return {"simulated": True, "message": f"Pump {'ON' if on else 'OFF'} (SIMULATED — no hardware command sent)"}


# --------------------------------------------------------------------------- esp32 direct
class Esp32Source(DataSource):
    """Keeps the last 31 days in memory and appends every packet to data/readings.jsonl so a restart keeps history."""

    name = "esp32"
    accepts_ingest = True
    KEEP_SEC = 31 * 86400

    def __init__(self) -> None:
        DATA_DIR.mkdir(exist_ok=True)
        self.file = DATA_DIR / "readings.jsonl"
        self.readings: deque[Reading] = deque()
        self.lock = threading.Lock()
        self.last_seen: Optional[float] = None
        self.rssi: Optional[int] = None
        self.firmware = "unknown"
        self.command: Optional[dict] = None
        self._load()

    def _load(self) -> None:
        if not self.file.exists():
            return
        cutoff = time.time() - self.KEEP_SEC
        for line in self.file.read_text(encoding="utf-8").splitlines():
            try:
                r = Reading(**json.loads(line))
            except Exception:
                continue
            if r.ts >= cutoff:
                self.readings.append(r)

    def ingest(self, pkt: IncomingReading, rssi: Optional[int] = None, firmware: Optional[str] = None) -> tuple[Reading, list[str]]:
        r, issues = pkt.sanitized()
        with self.lock:
            if self.readings and r.ts <= self.readings[-1].ts:
                issues.append("Duplicate or out-of-order timestamp; ignored")
                return r, issues
            self.readings.append(r)
            cutoff = time.time() - self.KEEP_SEC
            while self.readings and self.readings[0].ts < cutoff:
                self.readings.popleft()
            with self.file.open("a", encoding="utf-8") as f:
                f.write(r.model_dump_json(exclude_none=False) + "\n")
            self.last_seen = time.time()
            if rssi is not None:
                self.rssi = rssi
            if firmware:
                self.firmware = firmware
        return r, issues

    def history(self, since: float) -> list[Reading]:
        with self.lock:
            return [r for r in self.readings if r.ts >= since]

    def latest(self) -> Optional[Reading]:
        with self.lock:
            return self.readings[-1] if self.readings else None

    def device(self) -> dict:
        online = self.last_seen is not None and time.time() - self.last_seen < 60
        return {
            "id": settings.device_id,
            "name": settings.device_name,
            "firmware": self.firmware,
            "rssi": self.rssi,
            "online": online,
            "source": "ESP32 direct (POST /api/readings)",
        }

    def set_pump(self, on: bool) -> dict:
        self.command = {"pump": on, "issued_at": int(time.time())}
        return {"simulated": False, "message": f"Pump {'ON' if on else 'OFF'} queued — the ESP32 applies it on its next poll (≤ 10 s)"}

    def pending_command(self) -> Optional[dict]:
        return self.command


# --------------------------------------------------------------------------- firebase
class FirebaseSource(DataSource):
    """Firebase Realtime Database over REST. Layout (project deck, slide 9):
    /devices/unit-01/live = latest packet, /devices/unit-01/history/{ts} = every packet, /devices/unit-01/commands/pump.
    """

    name = "firebase"
    CACHE_SEC = 5

    def __init__(self) -> None:
        if not settings.firebase_db_url:
            raise SourceError("DATA_SOURCE=firebase but FIREBASE_DB_URL is empty")
        self.client = httpx.Client(timeout=10)
        self._cache: dict[str, tuple[float, object]] = {}

    def _get(self, path: str, params: Optional[dict] = None):
        key = path + json.dumps(params or {}, sort_keys=True)
        hit = self._cache.get(key)
        if hit and time.time() - hit[0] < self.CACHE_SEC:
            return hit[1]
        p = dict(params or {})
        if settings.firebase_auth:
            p["auth"] = settings.firebase_auth
        try:
            res = self.client.get(f"{settings.firebase_db_url}{path}.json", params=p)
        except httpx.HTTPError as e:
            raise SourceError(f"Firebase unreachable: {e.__class__.__name__}") from e
        if res.status_code == 401:
            raise SourceError("Firebase refused the request (401). Check FIREBASE_AUTH and database rules.")
        if res.status_code >= 400:
            raise SourceError(f"Firebase error {res.status_code}")
        data = res.json()
        self._cache[key] = (time.time(), data)
        return data

    @staticmethod
    def _parse(obj) -> Optional[Reading]:
        if not isinstance(obj, dict) or "ts" not in obj:
            return None
        try:
            r, _ = IncomingReading.model_validate(obj).sanitized()
            return r
        except Exception:
            return None

    def history(self, since: float) -> list[Reading]:
        raw = self._get(settings.firebase_history_path, {"orderBy": '"$key"', "startAt": f'"{int(since)}"'}) or {}
        items = raw.values() if isinstance(raw, dict) else raw
        out = [r for r in (self._parse(x) for x in items) if r is not None and r.ts >= since]
        out.sort(key=lambda r: r.ts)
        return out

    def latest(self) -> Optional[Reading]:
        return self._parse(self._get(settings.firebase_live_path))

    def device(self) -> dict:
        r = None
        try:
            r = self.latest()
        except SourceError:
            pass
        online = r is not None and time.time() - r.ts < 60
        return {
            "id": settings.device_id,
            "name": settings.device_name,
            "firmware": "reported by device",
            "rssi": None,
            "online": online,
            "source": "Firebase Realtime Database",
        }

    def set_pump(self, on: bool) -> dict:
        params = {"auth": settings.firebase_auth} if settings.firebase_auth else None
        body = {"on": on, "ts": int(time.time()), "by": "dashboard"}
        try:
            res = self.client.put(f"{settings.firebase_db_url}{settings.firebase_pump_path}.json", params=params, json=body)
        except httpx.HTTPError as e:
            raise SourceError(f"Firebase unreachable: {e.__class__.__name__}") from e
        if res.status_code >= 400:
            raise SourceError(f"Firebase rejected the pump command ({res.status_code})")
        return {"simulated": False, "message": f"Pump {'ON' if on else 'OFF'} written to Firebase {settings.firebase_pump_path}"}


def make_source() -> DataSource:
    if settings.data_source == "esp32":
        return Esp32Source()
    if settings.data_source == "firebase":
        return FirebaseSource()
    return DemoSource()
