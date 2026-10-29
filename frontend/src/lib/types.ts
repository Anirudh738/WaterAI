// Shared data shapes. Mirrors the ESP32 packet: { ts, ph, tds, ntu, temp, level }.

export type SensorKey = 'ph' | 'tds' | 'ntu' | 'temp' | 'level'
export type Status = 'safe' | 'warning' | 'unsafe' | 'unknown'
export type DataMode = 'demo' | 'api'

/** One reading set from the device. A null value means the sensor sent nothing / was rejected. */
export interface Reading {
  ts: number // unix ms
  ph: number | null
  tds: number | null // mg/L (ppm)
  ntu: number | null // turbidity, NTU
  temp: number | null // °C
  level: number | null // tank fill, %
  pump?: boolean
}

export interface Thresholds {
  ph: { safeMin: number; safeMax: number; warnMin: number; warnMax: number }
  tds: { safeMax: number; warnMax: number; probeMax: number }
  ntu: { safeMax: number; warnMax: number }
  temp: { validMin: number; validMax: number; warnAbove: number }
  level: { pumpOnBelow: number; pumpOffAbove: number }
  staleAfterSec: number
}

export interface SensorVerdict {
  key: SensorKey
  status: Status
  value: number | null
  reason: string
}

export interface Screening {
  status: Status
  verdicts: Record<SensorKey, SensorVerdict>
  reasons: string[]
  stale: boolean
  ageSec: number | null
  engine: string
}

export type Severity = 'info' | 'warning' | 'critical'
export type AlertState = 'open' | 'acknowledged' | 'resolved'

export interface AlertItem {
  id: string
  ts: number
  severity: Severity
  sensor: SensorKey | 'device' | 'system'
  title: string
  explanation: string
  nextStep: string
  value?: number | null
  kind: 'threshold' | 'anomaly' | 'data'
}

export interface Anomaly {
  ts: number
  sensor: SensorKey
  value: number
  baseline: number
  score: number // robust z-score
  direction: 'up' | 'down'
  hypotheses: string[]
}

export interface Forecast {
  reliable: boolean
  qualityNote: string
  slopePerHour: number | null // % per hour
  r2: number | null
  points: number
  currentLevel: number | null
  trend: 'filling' | 'draining' | 'steady' | 'unknown'
  etaLabel: string | null
  etaMinutes: number | null
  projection: { ts: number; level: number }[]
  method: string
}

export interface DeviceInfo {
  id: string
  name: string
  firmware: string
  rssi: number | null
  online: boolean
  source: string
}
