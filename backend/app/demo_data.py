"""Deterministic simulated data (seeded). Used ONLY when DATA_SOURCE=demo, and always labelled demo."""
from __future__ import annotations

import math
import random
import time
from datetime import datetime

from .schemas import Reading

MIN = 60


def _pulse(ts: float, start: float, dur_min: float, ramp_min: float) -> float:
    x = (ts - start) / MIN
    if x < 0 or x > dur_min:
        return 0.0
    if x < ramp_min:
        return x / ramp_min
    if x > dur_min - ramp_min:
        return (dur_min - x) / ramp_min
    return 1.0


def _hour(ts: float) -> float:
    d = datetime.fromtimestamp(ts)
    return d.hour + d.minute / 60


def _consumption(ts: float) -> float:
    h = _hour(ts)
    if 6 <= h < 9:
        return 0.34
    if 18 <= h < 21:
        return 0.29
    if 12 <= h < 14:
        return 0.16
    if h < 5:
        return 0.02
    return 0.08


def _baseline(ts: float) -> tuple[float, float, float, float]:
    h = _hour(ts)
    day = math.sin((h - 9) / 24 * 2 * math.pi)
    return 7.22 + 0.07 * day, 318 + 14 * day, 0.42 + 0.08 * max(0.0, math.sin((h - 6) / 24 * 2 * math.pi)), 26.4 + 2.1 * day


class DemoSimulator:
    """30 days of 1-minute history, then a new reading every 10 s while the server runs."""

    def __init__(self, seed: int = 42, days: int = 30):
        self.rng = random.Random(seed)
        self.level = 68.0
        self.pump = False
        self.readings: list[Reading] = []
        end = int(time.time() // MIN * MIN)
        self._generate(end - days * 86400, end)
        self.last_ts = end

    def _step_tank(self, minutes: float) -> None:
        self.level += -_consumption(self.last_ts if hasattr(self, "last_ts") else time.time()) * minutes * (0.8 + 0.4 * self.rng.random())
        self.level += 1.25 * minutes if self.pump else 0
        self.level = min(100.0, max(0.0, self.level))
        if self.level < 20:
            self.pump = True
        if self.level > 95:
            self.pump = False

    def _make(self, ts: int, extra: dict | None = None) -> Reading:
        g = self.rng.gauss
        ph, tds, ntu, temp = _baseline(ts)
        ph += g(0, 0.025)
        tds += g(0, 3.5)
        ntu += abs(g(0, 0.04))
        temp += g(0, 0.08)
        if extra:
            ph += extra.get("ph", 0)
            tds += extra.get("tds", 0)
            ntu += extra.get("ntu", 0)
        return Reading(
            ts=ts,
            ph=round(ph, 2),
            tds=round(min(1000, max(0, tds))),
            ntu=round(max(0.02, ntu), 2),
            temp=round(temp, 1),
            level=round(min(100, max(0, self.level + g(0, 0.3))), 1),
            pump=self.pump,
        )

    def _generate(self, start: int, end: int) -> None:
        gap = end - 26 * 86400 + 3 * 3600
        ph_low = end - 19 * 86400 + 11 * 3600
        rain = end - 12 * 86400 + 15 * 3600
        tds_spike = end - 5 * 86400 + 10 * 3600
        blip = end - 20 * 3600
        glitch = end - 3 * 3600 - 7 * MIN
        for ts in range(start, end + 1, MIN):
            self.last_ts = ts
            self._step_tank(1)
            if gap <= ts < gap + 3 * 3600:
                continue
            extra = {
                "ph": -0.95 * _pulse(ts, ph_low, 150, 50),
                "ntu": 2.6 * _pulse(ts, rain, 260, 70) + 1.05 * _pulse(ts, blip, 35, 10),
                "tds": 330 * _pulse(ts, tds_spike, 190, 35),
            }
            r = self._make(ts, extra)
            if ts == glitch:
                r.tds = 978
            self.readings.append(r)

    def advance(self, now: float | None = None) -> None:
        now = time.time() if now is None else now
        while self.last_ts + 10 <= now:
            self.last_ts += 10
            self._step_tank(10 / 60)
            self.readings.append(self._make(self.last_ts))
        cutoff = now - 31 * 86400
        if self.readings and self.readings[0].ts < cutoff:
            self.readings = [r for r in self.readings if r.ts >= cutoff]
