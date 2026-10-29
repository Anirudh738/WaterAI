"""Data shapes. A reading mirrors the ESP32 packet: {ts, ph, tds, ntu, temp, level}."""
from __future__ import annotations

import time
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

VALID_RANGE = {"ph": (0.0, 14.0), "tds": (0.0, 1000.0), "ntu": (0.0, 3000.0), "temp": (-55.0, 125.0), "level": (0.0, 100.0)}


class Reading(BaseModel):
    ts: int = Field(..., description="Unix time in SECONDS (device clock, NTP-synced)")
    ph: Optional[float] = None
    tds: Optional[float] = None
    ntu: Optional[float] = None
    temp: Optional[float] = None
    level: Optional[float] = None
    pump: Optional[bool] = None


class IncomingReading(Reading):
    """Packet POSTed by the ESP32. Out-of-range values are rejected (stored as null), never clamped."""

    @field_validator("ts")
    @classmethod
    def ts_sane(cls, v: int) -> int:
        now = time.time()
        if v > now + 60:
            raise ValueError("timestamp is in the future — check the device's NTP sync")
        if v < now - 7 * 86400:
            raise ValueError("timestamp is more than 7 days old")
        return v

    def sanitized(self) -> tuple["Reading", list[str]]:
        issues: list[str] = []
        data = self.model_dump()
        for k, (lo, hi) in VALID_RANGE.items():
            v = data.get(k)
            if v is None:
                continue
            if not (lo <= v <= hi):
                issues.append(f"{k}={v} outside physical range {lo}–{hi}; stored as null")
                data[k] = None
        return Reading(**data), issues


class AskRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=2000)
    language: Literal["en", "hi"] = "en"
    context: Optional[dict] = None


class PumpRequest(BaseModel):
    on: bool
