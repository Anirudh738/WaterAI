"""One configurable LLM provider (server-side key). Without a key, a rule-based answer is returned and labelled
DEMO-GENERATED. The LLM only ever sees data; it has no tools and can never control the pump."""
from __future__ import annotations

import json
from typing import Optional

import httpx

from .config import settings

SYSTEM_PROMPT = """You are WaterIQ AI, the assistant inside an AI-based smart water monitoring dashboard.
The system has ONE ESP32 unit with five sensors: pH, TDS (mg/L), turbidity (NTU), temperature (°C, DS18B20) and tank level (%, JSN-SR04T).
Thresholds follow BIS IS 10500:2012 and are included in the context.

Rules you must follow:
1. Use ONLY the numbers and timestamps in the CONTEXT JSON. Never invent readings, never claim you accessed the device or a lab.
   If a value is missing, null or stale, say so plainly.
2. If data_mode says DEMO / simulated, say clearly that the values are simulated demo data.
3. Never say the water is "potable" or "safe to drink" as a certainty. These five sensors cannot detect bacteria, nitrate,
   fluoride, arsenic or heavy metals. Recommend a lab test for confirmation when relevant.
4. Structure the answer with these headings (translate headings if answering in Hindi):
   **Measured facts** — values with units and ISO timestamps from the context.
   **Predictions** — forecasts from the context only, with their reliability note.
   **Hypotheses (unconfirmed)** — possible causes, clearly marked as not proven.
   **Next steps** — practical actions.
   Skip a heading if it has nothing useful.
5. You cannot switch the pump or change settings. If asked, explain that pump control is a separate, authorised,
   safety-checked action in the Device Settings page.
6. Be concise and practical. Plain language for a non-expert."""


class LlmError(RuntimeError):
    pass


def ask_llm(question: str, language: str, context: dict) -> str:
    lang = "Hindi (Devanagari script)" if language == "hi" else "English"
    user = f"Answer in {lang}.\n\nCONTEXT (JSON):\n{json.dumps(context, ensure_ascii=False, default=str)[:24000]}\n\nQUESTION:\n{question}"
    try:
        if settings.llm_provider == "anthropic":
            res = httpx.post(
                (settings.llm_base_url or "https://api.anthropic.com") + "/v1/messages",
                headers={"x-api-key": settings.llm_api_key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
                json={"model": settings.resolved_model, "max_tokens": 1200, "system": SYSTEM_PROMPT, "messages": [{"role": "user", "content": user}]},
                timeout=40,
            )
            _raise(res)
            return "".join(b.get("text", "") for b in res.json().get("content", []) if b.get("type") == "text").strip()
        # OpenAI or any OpenAI-compatible server
        res = httpx.post(
            (settings.llm_base_url or "https://api.openai.com/v1").rstrip("/") + "/chat/completions",
            headers={"Authorization": f"Bearer {settings.llm_api_key}"},
            json={"model": settings.resolved_model, "temperature": 0.2, "messages": [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": user}]},
            timeout=40,
        )
        _raise(res)
        return res.json()["choices"][0]["message"]["content"].strip()
    except httpx.HTTPError as e:
        raise LlmError(f"LLM provider unreachable ({e.__class__.__name__})") from e
    except (KeyError, IndexError, ValueError) as e:
        raise LlmError("LLM provider returned an unexpected response") from e


def _raise(res: httpx.Response) -> None:
    if res.status_code == 401:
        raise LlmError("LLM provider rejected the API key (401)")
    if res.status_code == 429:
        raise LlmError("LLM provider rate limit reached (429). Try again shortly.")
    if res.status_code >= 400:
        raise LlmError(f"LLM provider error {res.status_code}")


# --------------------------------------------------------------------------- rule-based fallback
def rule_answer(question: str, language: str, ctx: dict) -> str:
    """Short, deterministic summary used when no LLM key is set. Labelled as demo-generated."""
    hi = language == "hi"
    st = ctx.get("screening", {})
    r = ctx.get("latest_reading") or {}
    fc = ctx.get("tank_forecast") or {}
    lines = ["[DEMO-GENERATED — rule-based answer, no LLM was called]" if not hi else "[डेमो उत्तर — नियम-आधारित, कोई LLM उपयोग नहीं हुआ]", ""]
    lines.append("**Measured facts**" if not hi else "**मापे गए तथ्य**")
    if r:
        lines.append(f"- {r.get('ts')}: pH {r.get('ph')}, TDS {r.get('tds')} mg/L, turbidity {r.get('ntu')} NTU, temp {r.get('temp')} °C, level {r.get('level')}%")
    else:
        lines.append("- No reading available." if not hi else "- कोई रीडिंग उपलब्ध नहीं है।")
    lines.append(f"- Screening: {str(st.get('status', 'unknown')).upper()} — " + "; ".join(st.get("reasons", [])))
    if fc:
        lines += ["", "**Predictions**" if not hi else "**अनुमान**", f"- {fc.get('eta_label') or 'No forecast'} ({fc.get('quality_note', '')})"]
    lines += ["", "**Next steps**" if not hi else "**अगले कदम**",
              "- Set LLM_API_KEY on the server for full answers to: " + question[:120] if not hi else "- पूरे उत्तर के लिए सर्वर पर LLM_API_KEY सेट करें।",
              "- 5-sensor screening is not a potability certificate; confirm with a lab test." if not hi else "- 5 सेंसर की जाँच पीने योग्यता का प्रमाण नहीं है; लैब टेस्ट से पुष्टि करें।"]
    return "\n".join(lines)


def llm_info() -> dict:
    return {"configured": settings.llm_configured, "provider": settings.llm_provider if settings.llm_configured else None,
            "model": settings.resolved_model if settings.llm_configured else None}


def configured_error() -> Optional[str]:
    if settings.llm_configured and settings.llm_provider not in ("anthropic", "openai"):
        return f"Unknown LLM_PROVIDER '{settings.llm_provider}' (use anthropic or openai)"
    if settings.llm_configured and settings.llm_provider == "openai" and not settings.llm_model:
        return "LLM_MODEL must be set for the openai provider"
    return None
