import type { Reading, Screening, SensorKey, SensorVerdict, Status, Thresholds } from './types'

// Deterministic, rule-based safety screening. Works with no LLM and no trained model.
// Rule: missing / stale / invalid data can NEVER produce "safe".

const RANK: Record<Status, number> = { safe: 0, unknown: 1, warning: 2, unsafe: 3 }

/** Physical ranges a real probe can report. Anything outside = invalid (sensor fault or wiring issue). */
export const VALID_RANGE: Record<SensorKey, [number, number]> = {
  ph: [0, 14],
  tds: [0, 1000],
  ntu: [0, 3000],
  temp: [-55, 125],
  level: [0, 100],
}

export function isValid(key: SensorKey, v: number | null | undefined): v is number {
  if (v === null || v === undefined || !Number.isFinite(v)) return false
  const [lo, hi] = VALID_RANGE[key]
  return v >= lo && v <= hi
}

/** Validates a raw packet. Out-of-range values become null; future timestamps are rejected. */
export function sanitizeReading(r: Partial<Reading> & { ts: number }, now = Date.now()): { reading: Reading; issues: string[] } {
  const issues: string[] = []
  if (!Number.isFinite(r.ts) || r.ts > now + 60_000) {
    issues.push('Timestamp is invalid or in the future')
  }
  const out: Reading = { ts: r.ts, ph: null, tds: null, ntu: null, temp: null, level: null, pump: r.pump }
  ;(['ph', 'tds', 'ntu', 'temp', 'level'] as SensorKey[]).forEach((k) => {
    const v = r[k]
    if (v === null || v === undefined) return
    if (isValid(k, v)) out[k] = v
    else issues.push(`${k} value ${v} is outside the sensor's physical range`)
  })
  return { reading: out, issues }
}

function verdict(key: SensorKey, status: Status, value: number | null, reason: string): SensorVerdict {
  return { key, status, value, reason }
}

export function screenSensor(key: SensorKey, v: number | null, t: Thresholds): SensorVerdict {
  if (!isValid(key, v)) return verdict(key, 'unknown', null, 'No valid reading')
  switch (key) {
    case 'ph':
      if (v < t.ph.warnMin || v > t.ph.warnMax) return verdict(key, 'unsafe', v, `pH ${v.toFixed(2)} is outside ${t.ph.warnMin}–${t.ph.warnMax}`)
      if (v < t.ph.safeMin || v > t.ph.safeMax) return verdict(key, 'warning', v, `pH ${v.toFixed(2)} is near the limit (safe band ${t.ph.safeMin}–${t.ph.safeMax})`)
      return verdict(key, 'safe', v, `pH within ${t.ph.safeMin}–${t.ph.safeMax}`)
    case 'tds':
      if (v >= t.tds.probeMax) return verdict(key, 'unsafe', v, `TDS probe is maxed out (${t.tds.probeMax} mg/L); true value may be higher — lab test needed`)
      if (v >= t.tds.warnMax) return verdict(key, 'unsafe', v, `TDS ${v.toFixed(0)} mg/L ≥ ${t.tds.warnMax}`)
      if (v > t.tds.safeMax) return verdict(key, 'warning', v, `TDS ${v.toFixed(0)} mg/L is above the ${t.tds.safeMax} mg/L acceptable limit`)
      return verdict(key, 'safe', v, `TDS ≤ ${t.tds.safeMax} mg/L`)
    case 'ntu':
      if (v > t.ntu.warnMax) return verdict(key, 'unsafe', v, `Turbidity ${v.toFixed(2)} NTU > ${t.ntu.warnMax} NTU`)
      if (v > t.ntu.safeMax) return verdict(key, 'warning', v, `Turbidity ${v.toFixed(2)} NTU is above the ${t.ntu.safeMax} NTU acceptable limit`)
      return verdict(key, 'safe', v, `Turbidity ≤ ${t.ntu.safeMax} NTU`)
    case 'temp':
      if (v < t.temp.validMin || v > t.temp.validMax) return verdict(key, 'unknown', v, `Temperature ${v.toFixed(1)} °C is implausible for water — check the DS18B20`)
      if (v > t.temp.warnAbove) return verdict(key, 'warning', v, `Water is warm (${v.toFixed(1)} °C); germs grow faster`)
      return verdict(key, 'safe', v, 'Temperature normal (used to correct pH/TDS)')
    case 'level':
      if (v < t.level.pumpOnBelow) return verdict(key, 'warning', v, `Tank low (${v.toFixed(0)}%)`)
      if (v > t.level.pumpOffAbove) return verdict(key, 'warning', v, `Tank near overflow (${v.toFixed(0)}%)`)
      return verdict(key, 'safe', v, 'Tank level normal')
  }
}

export function screen(r: Reading | null, t: Thresholds, now = Date.now()): Screening {
  const keys: SensorKey[] = ['ph', 'tds', 'ntu', 'temp', 'level']
  const empty = Object.fromEntries(keys.map((k) => [k, verdict(k, 'unknown', null, 'No data')])) as Record<SensorKey, SensorVerdict>
  if (!r) {
    return { status: 'unknown', verdicts: empty, reasons: ['No readings received yet'], stale: true, ageSec: null, engine: 'Rule engine (BIS IS 10500)' }
  }
  const ageSec = Math.round((now - r.ts) / 1000)
  const stale = ageSec > t.staleAfterSec
  const verdicts = Object.fromEntries(keys.map((k) => [k, screenSensor(k, r[k], t)])) as Record<SensorKey, SensorVerdict>

  // Water quality is decided by pH, TDS and turbidity. Temperature/level only add notes.
  const quality: SensorKey[] = ['ph', 'tds', 'ntu']
  let status: Status = 'safe'
  const reasons: string[] = []
  for (const k of quality) {
    const v = verdicts[k]
    if (RANK[v.status] > RANK[status]) status = v.status
    if (v.status !== 'safe') reasons.push(v.reason)
  }
  // Unknown never hides behind Safe: if any quality sensor is unknown and nothing is worse, overall = unknown.
  const anyUnknown = quality.some((k) => verdicts[k].status === 'unknown')
  if (anyUnknown && status === 'safe') status = 'unknown'
  if (anyUnknown && status === 'warning') reasons.push('Some quality sensors have no valid data')

  if (verdicts.temp.status === 'unknown' && status === 'safe') {
    status = 'warning'
    reasons.push('Temperature missing — pH/TDS compensation not possible')
  }
  if (verdicts.temp.status === 'warning') reasons.push(verdicts.temp.reason)

  if (stale) {
    // Stale data cannot confirm current water state. Unsafe evidence still stands (it is a conservative signal).
    if (status !== 'unsafe') status = 'unknown'
    reasons.unshift(`Last reading is ${ageSec}s old (stale after ${t.staleAfterSec}s) — current state unknown`)
  }
  if (ageSec < -60) {
    status = 'unknown'
    reasons.unshift('Reading timestamp is in the future — device clock may be wrong')
  }
  if (status === 'safe') reasons.push('pH, TDS and turbidity are within acceptable BIS limits')
  return { status, verdicts, reasons, stale, ageSec, engine: 'Rule engine (BIS IS 10500)' }
}

export function worst(a: Status, b: Status): Status {
  return RANK[a] >= RANK[b] ? a : b
}
