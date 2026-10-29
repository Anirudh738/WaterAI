# WaterIQ AI — AI-Based Smart Water Monitoring System

ESP32 + 5 sensors (pH, TDS, turbidity, DS18B20 temperature, JSN-SR04T tank level) → FastAPI → React dashboard with an AI assistant.
Runs fully in **demo mode** with no hardware, no Firebase and no API key.

## Run it (one command)

Only **Python 3.9+** is needed. The built website is already inside the zip, so Node.js is not required.

| Computer | Command (inside the `wateriq-ai` folder) |
|---|---|
| **Windows** (cmd) | `python run.py`  — or double-click **start.bat** |
| **Mac / Linux** (Terminal) | `python3 run.py` — or `./start.sh` |

First run installs packages (1–3 min, needs internet). Then the browser opens **http://localhost:8000** by itself.
The dashboard detects the backend automatically and shows **BACKEND · DEMO DATA** in the header. Stop with **Ctrl+C**.
If port 8000 is busy, it uses the next free port and prints the address.

**Developer mode (hot reload, needs Node.js 20+), two terminals:**

```bash
# terminal 1 — backend
cd backend
python -m venv .venv        # Mac: python3
.venv\Scripts\activate      # Mac: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# terminal 2 — frontend
cd frontend
npm install
npm run dev                 # http://localhost:5173  (/api is proxied to :8000)
```

After changing frontend code, run `npm run build` so `run.py` serves the new version.

**Tests:** `cd frontend && npm test` · `cd backend && pytest -q`

## Two kinds of "demo", clearly labelled

| Header badge | What it means |
|---|---|
| **DEMO MODE** (amber) | Data generated in the browser. Used automatically when no backend answers. Has demo scenarios (normal, contamination event, pH sensor fault, device offline) in Device Settings. |
| **BACKEND · DEMO DATA** (amber) | Default when started with `run.py`: data comes from the backend, which runs `DATA_SOURCE=demo`. |
| **LIVE DEVICE DATA** (green) | Backend runs `DATA_SOURCE=esp32` or `firebase`. Demo data is never mixed in. |

## Pages

Dashboard · Live Monitoring (1 h / 24 h / 7 d / 30 d) · AI Assistant (English + हिन्दी) · AI Insights (anomalies, tank forecast, data quality) · Alerts (acknowledge / resolve) · Reports (CSV download + printable report / Save as PDF) · Device Settings (thresholds, calibration, pump control, data mode).

## Safety screening

Rules follow BIS IS 10500:2012 and the project's decision table (pH 6.5–8.5, TDS ≤ 500 acceptable, turbidity ≤ 1 NTU acceptable / 5 permissible, TDS probe max 1,000 → Unsafe).

- Missing, invalid or stale (> 60 s) readings → **Unknown**, never Safe.
- "Safe" means *these 5 sensors are within limits*. It is **not** a potability certificate: no bacteria, nitrate, fluoride, arsenic or heavy-metal sensing. Confirm with a lab test.
- The rule engine always runs, with or without the AI.

## The three AI models — current honest status

| Model | Job | Status now |
|---|---|---|
| Random Forest | Safe / Warning / Unsafe | **Not trained** (no lab-labelled dataset yet). Rule engine decides. Train with `python train_models.py --csv your_labelled.csv`. The model can only make a verdict stricter, never downgrade it to Safe. |
| Linear Regression | Tank-level forecast | **Active** — scikit-learn fit on the last 30 min, live. Shows a data-quality warning when the fit is unreliable (pump switched, R² < 0.6, < 20 min of data). |
| Isolation Forest | Anomaly detection | **Active in the backend** — unsupervised, fitted on the last 7 days. In browser demo mode a lighter statistical detector is used (labelled). |

## Environment variables (`backend/.env`, copy from `.env.example`)

| Variable | Default | Purpose |
|---|---|---|
| `DATA_SOURCE` | `demo` | `demo` · `esp32` (device POSTs to the server) · `firebase` |
| `DEVICE_API_KEY` | — | Shared secret the ESP32 sends as `X-Device-Key` |
| `FIREBASE_DB_URL`, `FIREBASE_AUTH` | — | Realtime Database URL + database secret / ID token |
| `LLM_PROVIDER` | `anthropic` | `anthropic` or `openai` (any OpenAI-compatible server via `LLM_BASE_URL`) |
| `LLM_API_KEY` | — | Empty = rule-based assistant, labelled **DEMO-GENERATED** |
| `LLM_MODEL` | `claude-haiku-5-5` | Required for `openai` |
| `PUMP_CONTROL_TOKEN` | — | Empty = real pump control disabled. Demo pump is always simulated. |

Keys stay on the server. The browser never sees them.

## API

`GET /api/health` · `GET /api/readings/latest` · `GET /api/readings/history?range=1h|24h|7d|30d` · `GET /api/water/status` · `POST /api/ai/ask` · `GET /api/alerts` · `POST /api/alerts/{id}/acknowledge|resolve|reopen` · `GET /api/forecasts/latest` · `GET /api/anomalies` · `GET /api/device` · `POST /api/device/pump` · `POST /api/readings` (ESP32) · `GET /api/device/commands` (ESP32). Interactive docs: http://localhost:8000/docs

## Hardware integration guide

**Option A — ESP32 → this server (simplest)**

1. `backend/.env`: `DATA_SOURCE=esp32`, `DEVICE_API_KEY=<random string>`, `PUMP_CONTROL_TOKEN=<another random string>`.
2. Flash `esp32/aquaguard_esp32.ino` (Arduino IDE, board "ESP32 Dev Module", libraries: OneWire, DallasTemperature, ArduinoJson 7). Set Wi-Fi, `SERVER` = your laptop's LAN IP (`ipconfig getifaddr en0` on Mac), and the same `DEVICE_KEY`.
3. Start the server with `python run.py`. The dashboard switches to backend data automatically.

Packet the ESP32 sends every 10 s (`ts` = unix **seconds**, NTP-synced):

```json
{"ts":1761634800,"ph":7.21,"tds":318,"ntu":0.8,"temp":27.4,"level":72,"pump":false}
```

Out-of-range values are stored as `null` (never clamped); timestamps in the future or > 7 days old are rejected.

**Option B — ESP32 → Firebase → this server.** Write the latest packet to `/devices/unit-01/live` and each packet to `/devices/unit-01/history/{ts}` (key = unix seconds). Set `DATA_SOURCE=firebase` and `FIREBASE_DB_URL`. Pump commands are written to `/devices/unit-01/commands/pump` as `{on, ts, by}`.

**Wiring notes:** analog sensors on ADC1 pins (GPIO 32–39; ADC2 fails with Wi-Fi on) · voltage divider on 5 V sensor outputs · ultrasonic ≥ 25 cm above full level · calibrate pH with 4.0 / 7.0 buffers and turbidity against known NTU samples before trusting numbers.

**Pump safety:** the AI assistant has no access to the pump. A real pump command needs `PUMP_CONTROL_TOKEN`, passes server checks (level known, data fresh, tank not full, water not Unsafe) and is rate-limited to one per 10 s. The firmware re-checks locally and refuses unsafe ON commands.

## Remaining work before real deployment

- Calibrate all sensors and fill in calibration constants in the firmware.
- Collect lab-checked labelled samples → train and evaluate the Random Forest (80/20 split, confusion matrix).
- Bench + 7-day field test against the targets in the project deck.
- SMS / push notifications (alerts are in-app only for now).
- User login for multi-user deployments (current pump auth is a single shared token).
