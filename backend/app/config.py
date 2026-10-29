"""Settings from environment variables (and an optional backend/.env file)."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _load_dotenv() -> None:
    env = ROOT / ".env"
    if not env.exists():
        return
    for line in env.read_text(encoding="utf-8").splitlines():
        line = line.split(" #", 1)[0].strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_dotenv()


def _get(k: str, default: str = "") -> str:
    return os.environ.get(k, default).strip()


@dataclass
class Settings:
    data_source: str = field(default_factory=lambda: _get("DATA_SOURCE", "demo").lower())
    device_id: str = field(default_factory=lambda: _get("DEVICE_ID", "unit-01"))
    device_name: str = field(default_factory=lambda: _get("DEVICE_NAME", "Overhead tank · Block A"))
    firebase_db_url: str = field(default_factory=lambda: _get("FIREBASE_DB_URL").rstrip("/"))
    firebase_auth: str = field(default_factory=lambda: _get("FIREBASE_AUTH"))
    firebase_live_path: str = field(default_factory=lambda: _get("FIREBASE_LIVE_PATH", "/devices/unit-01/live"))
    firebase_history_path: str = field(default_factory=lambda: _get("FIREBASE_HISTORY_PATH", "/devices/unit-01/history"))
    firebase_pump_path: str = field(default_factory=lambda: _get("FIREBASE_PUMP_PATH", "/devices/unit-01/commands/pump"))
    device_api_key: str = field(default_factory=lambda: _get("DEVICE_API_KEY"))
    llm_provider: str = field(default_factory=lambda: _get("LLM_PROVIDER", "anthropic").lower())
    llm_api_key: str = field(default_factory=lambda: _get("LLM_API_KEY"))
    llm_model: str = field(default_factory=lambda: _get("LLM_MODEL"))
    llm_base_url: str = field(default_factory=lambda: _get("LLM_BASE_URL"))
    pump_token: str = field(default_factory=lambda: _get("PUMP_CONTROL_TOKEN"))
    cors_origins: list[str] = field(default_factory=lambda: [o.strip() for o in _get("CORS_ORIGINS", "*").split(",") if o.strip()])

    @property
    def demo(self) -> bool:
        return self.data_source == "demo"

    @property
    def llm_configured(self) -> bool:
        return bool(self.llm_api_key)

    @property
    def resolved_model(self) -> str:
        if self.llm_model:
            return self.llm_model
        return "claude-haiku-5-5" if self.llm_provider == "anthropic" else "gpt-4o-mini"


settings = Settings()
