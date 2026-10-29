// AquaGuard / WaterIQ AI — ESP32 firmware (starting point, DATA_SOURCE=esp32 mode)
// Reads 5 sensors every 10 s, applies LOCAL safety rules (works offline), POSTs to the backend,
// and polls for pump commands. Libraries: OneWire, DallasTemperature, ArduinoJson (v7).
//
// SAFETY: the local rules below always win. A server command can never turn the pump ON
// when the tank is full or the water screens UNSAFE.

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <time.h>

// ---------- configure
const char* WIFI_SSID   = "your-wifi";
const char* WIFI_PASS   = "your-password";
const char* SERVER      = "http://192.168.1.50:8000";   // laptop running the backend (same Wi-Fi)
const char* DEVICE_KEY  = "change-me-device-key";      // = DEVICE_API_KEY in backend/.env
const char* FIRMWARE    = "aquaguard-esp32 v0.4.0";

// Pins — analog sensors on ADC1 only (GPIO 32–39); ADC2 does not work while Wi-Fi is on.
const int PIN_PH = 34, PIN_TDS = 35, PIN_TURB = 32;
const int PIN_DS18B20 = 4, PIN_TRIG = 5, PIN_ECHO = 18, PIN_RELAY = 26, PIN_BUZZER = 27;

// 5 V sensor outputs go through a voltage divider to protect the 3.3 V pins. 10k/20k → multiply by 1.5.
const float DIVIDER = 1.5;

// Calibration (fill in from your own buffer / standard-solution tests)
float PH_V7 = 2.50, PH_V4 = 3.04;          // probe voltage in pH 7.0 and pH 4.0 buffer
const float TANK_FULL_CM = 30, TANK_EMPTY_CM = 150; // sensor-to-water distance when full / empty (≥ 25 cm blind zone)

// Local thresholds (BIS IS 10500 + project decision table)
const float PH_MIN = 6.5, PH_MAX = 8.5, TDS_MAX = 1000, NTU_MAX = 5, PUMP_ON_BELOW = 20, PUMP_OFF_ABOVE = 95;

OneWire oneWire(PIN_DS18B20);
DallasTemperature ds(&oneWire);
bool pumpOn = false;
long lastCmdTs = 0;

float readVolts(int pin) {            // average 30 samples to cut noise
  uint32_t mv = 0;
  for (int i = 0; i < 30; i++) { mv += analogReadMilliVolts(pin); delay(3); }
  return (mv / 30.0f) / 1000.0f * DIVIDER;
}

float readPH(float v) { return 7.0f + (PH_V7 - v) / ((PH_V4 - PH_V7) / 3.0f); }

float readTDS(float v, float tempC) { // DFRobot SEN0244 formula with temperature compensation
  float cv = v / (1.0f + 0.02f * (tempC - 25.0f));
  return (133.42f * cv * cv * cv - 255.86f * cv * cv + 857.39f * cv) * 0.5f;
}

float readNTU(float v) {              // DFRobot SEN0189 curve — REPLACE with your own NTU calibration
  if (v >= 4.2f) return 0.0f;
  float ntu = -1120.4f * v * v + 5742.3f * v - 4352.9f;
  return ntu < 0 ? 0 : ntu;
}

float readLevelPct() {               // JSN-SR04T ultrasonic
  digitalWrite(PIN_TRIG, LOW); delayMicroseconds(5);
  digitalWrite(PIN_TRIG, HIGH); delayMicroseconds(20);
  digitalWrite(PIN_TRIG, LOW);
  long us = pulseIn(PIN_ECHO, HIGH, 30000);
  if (us == 0) return NAN;            // no echo → unknown (never guess)
  float cm = us * 0.0343f / 2.0f;
  float pct = (TANK_EMPTY_CM - cm) / (TANK_EMPTY_CM - TANK_FULL_CM) * 100.0f;
  return constrain(pct, 0, 100);
}

void setPump(bool on, const char* why) {
  pumpOn = on;
  digitalWrite(PIN_RELAY, on ? HIGH : LOW);
  Serial.printf("Pump %s (%s)\n", on ? "ON" : "OFF", why);
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_TRIG, OUTPUT); pinMode(PIN_ECHO, INPUT);
  pinMode(PIN_RELAY, OUTPUT); pinMode(PIN_BUZZER, OUTPUT);
  setPump(false, "boot");
  ds.begin();
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) delay(250);
  configTime(0, 0, "pool.ntp.org", "time.google.com");   // server needs real unix time
}

void loop() {
  ds.requestTemperatures();
  float temp = ds.getTempCByIndex(0);
  bool tempOk = temp > -55 && temp < 125 && temp != DEVICE_DISCONNECTED_C;
  float ph = readPH(readVolts(PIN_PH));
  float tds = readTDS(readVolts(PIN_TDS), tempOk ? temp : 25.0f);
  float ntu = readNTU(readVolts(PIN_TURB));
  float level = readLevelPct();

  // ---- local safety (works with no Wi-Fi)
  bool unsafe = ph < PH_MIN || ph > PH_MAX || tds >= TDS_MAX || ntu > NTU_MAX;
  digitalWrite(PIN_BUZZER, unsafe ? HIGH : LOW);
  if (unsafe && pumpOn) setPump(false, "interlock: water UNSAFE");
  if (!isnan(level)) {
    if (!pumpOn && level < PUMP_ON_BELOW && !unsafe) setPump(true, "auto: tank low");
    if (pumpOn && level > PUMP_OFF_ABOVE) setPump(false, "auto: tank full");
  } else if (pumpOn) setPump(false, "level unknown");

  time_t now = time(nullptr);
  if (WiFi.status() == WL_CONNECTED && now > 1700000000) {
    // ---- send reading
    JsonDocument doc;
    doc["ts"] = (long)now;
    doc["ph"] = round(ph * 100) / 100.0;
    doc["tds"] = round(tds);
    doc["ntu"] = round(ntu * 100) / 100.0;
    if (tempOk) doc["temp"] = round(temp * 10) / 10.0; else doc["temp"] = nullptr;
    if (!isnan(level)) doc["level"] = round(level * 10) / 10.0; else doc["level"] = nullptr;
    doc["pump"] = pumpOn;
    String body; serializeJson(doc, body);
    HTTPClient http;
    http.begin(String(SERVER) + "/api/readings");
    http.addHeader("Content-Type", "application/json");
    http.addHeader("X-Device-Key", DEVICE_KEY);
    http.addHeader("X-RSSI", String(WiFi.RSSI()));
    http.addHeader("X-Firmware", FIRMWARE);
    int code = http.POST(body);
    Serial.printf("POST %d %s\n", code, body.c_str());
    http.end();

    // ---- poll pump command (applied only if local safety allows)
    http.begin(String(SERVER) + "/api/device/commands");
    http.addHeader("X-Device-Key", DEVICE_KEY);
    if (http.GET() == 200) {
      JsonDocument cmd;
      if (!deserializeJson(cmd, http.getString()) && !cmd["command"].isNull()) {
        long issued = cmd["command"]["issued_at"];
        bool want = cmd["command"]["pump"];
        if (issued > lastCmdTs) {
          lastCmdTs = issued;
          if (!want) setPump(false, "server command");
          else if (!unsafe && !isnan(level) && level < PUMP_OFF_ABOVE) setPump(true, "server command");
          else Serial.println("Server pump ON refused by local safety rules");
        }
      }
    }
    http.end();
  }
  delay(10000);
}
