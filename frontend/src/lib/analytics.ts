import { fmtWithUnit, SENSORS } from './sensors'
import { screenSensor } from './screening'
import type { AlertItem, Anomaly, Forecast, Reading, SensorKey, Status, Thresholds } from './types'

const MIN = 60_000

// ---------------------------------------------------------------- downsampling for charts
export type ChartPoint = { ts: number } & Partial<Record<SensorKey, number | null>>

/** Bucket-averages readings to at most `maxPoints`, and inserts null points across gaps so charts show breaks. */
export function downsample(readings: Reading[], maxPoints = 360): ChartPoint[] {
  if (readings.length === 0) return []
  const span = readings[readings.length - 1].ts - readings[0].ts
  const bucketMs = Math.max(1, span / maxPoints)
  const keys: SensorKey[] = ['ph', 'tds', 'ntu', 'temp', 'level']
  const out: ChartPoint[] = []
  let i = 0
  let lastTs = -Infinity
  const gapMs = Math.max(5 * MIN, bucketMs * 3)
  while (i < readings.length) {
    const bStart = readings[i].ts
    const sums: Record<string, number> = {}
    const counts: Record<string, number> = {}
    let tsSum = 0
    let n = 0
    while (i < readings.length && readings[i].ts < bStart + bucketMs) {
      const r = readings[i]
      tsSum += r.ts
      n++
      for (const k of keys) {
        const v = r[k]
        if (v !== null && v !== undefined) {
          sums[k] = (sums[k] ?? 0) + v
          counts[k] = (counts[k] ?? 0) + 1
        }
      }
      i++
    }
    const ts = Math.round(tsSum / n)
    if (ts - lastTs > gapMs && out.length > 0) {
      out.push({ ts: lastTs + 1, ph: null, tds: null, ntu: null, temp: null, level: null })
    }
    const p: ChartPoint = { ts }
    for (const k of keys) p[k] = counts[k] ? sums[k] / counts[k] : null
    out.push(p)
    lastTs = ts
  }
  return out
}

export function sliceRange(readings: Reading[], fromTs: number): Reading[] {
  // readings are sorted by ts → binary search the start index
  let lo = 0
  let hi = readings.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (readings[mid].ts < fromTs) lo = mid + 1
    else hi = mid
  }
  return readings.slice(lo)
}

// ---------------------------------------------------------------- tank forecast (linear regression)
export function forecastTank(readings: Reading[], t: Thresholds, now = Date.now()): Forecast {
  const method = 'Linear regression on last 30 min of tank level'
  const window = sliceRange(readings, now - 30 * MIN).filter((r) => r.level !== null)
  const last = readings[readings.length - 1]
  const base: Forecast = {
    reliable: false,
    qualityNote: '',
    slopePerHour: null,
    r2: null,
    points: window.length,
    currentLevel: last?.level ?? null,
    trend: 'unknown',
    etaLabel: null,
    etaMinutes: null,
    projection: [],
    method,
  }
  if (!last || now - last.ts > t.staleAfterSec * 1000) {
    return { ...base, qualityNote: 'Latest level reading is stale — forecast disabled.' }
  }
  if (window.length < 15) {
    return { ...base, qualityNote: `Only ${window.length} level readings in the last 30 min (need ≥ 15).` }
  }
  const span = (window[window.length - 1].ts - window[0].ts) / MIN
  if (span < 20) return { ...base, qualityNote: `Only ${span.toFixed(0)} min of history (need ≥ 20 min).` }

  // least squares: level = a + b * hours
  const t0 = window[0].ts
  const xs = window.map((r) => (r.ts - t0) / 3_600_000)
  const ys = window.map((r) => r.level as number)
  const n = xs.length
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my)
    sxx += (xs[i] - mx) ** 2
    syy += (ys[i] - my) ** 2
  }
  const slope = sxx === 0 ? 0 : sxy / sxx
  const intercept = my - slope * mx
  const r2 = syy === 0 ? 1 : (sxy * sxy) / (sxx * syy)
  const pumpChanged = window.some((r) => r.pump !== window[0].pump)
  const steady = Math.abs(slope) < 0.5
  const reliable = !pumpChanged && (steady || r2 >= 0.6)
  const xNow = (now - t0) / 3_600_000
  const current = intercept + slope * xNow
  const trend: Forecast['trend'] = steady ? 'steady' : slope > 0 ? 'filling' : 'draining'

  let etaMinutes: number | null = null
  let etaLabel: string | null = null
  if (trend === 'draining') {
    const target = t.level.pumpOnBelow
    etaMinutes = Math.max(0, ((current - target) / -slope) * 60)
    etaLabel = `Reaches ${target}% (pump-on level) in ~${humanMins(etaMinutes)}`
  } else if (trend === 'filling') {
    const target = t.level.pumpOffAbove
    etaMinutes = Math.max(0, ((target - current) / slope) * 60)
    etaLabel = `Reaches ${target}% (pump-off level) in ~${humanMins(etaMinutes)}`
  } else {
    etaLabel = 'Level roughly steady (< 0.5 %/h change)'
  }

  const horizon = Math.min(etaMinutes ?? 180, 6 * 60)
  const projection: { ts: number; level: number }[] = []
  for (let k = 0; k <= 24; k++) {
    const ts = now + (horizon * MIN * k) / 24
    const lvl = intercept + slope * ((ts - t0) / 3_600_000)
    projection.push({ ts, level: Math.max(0, Math.min(100, lvl)) })
  }

  let qualityNote = `Fit on ${n} points over ${span.toFixed(0)} min, R² = ${r2.toFixed(2)}.`
  if (pumpChanged) qualityNote = 'Pump switched during the last 30 min, so a straight-line fit is unreliable.'
  else if (!reliable) qualityNote = `Usage is irregular (R² = ${r2.toFixed(2)} < 0.60) — treat the estimate as rough.`

  return { ...base, reliable, qualityNote, slopePerHour: slope, r2, trend, etaLabel, etaMinutes, projection, currentLevel: last.level }
}

export function humanMins(m: number) {
  if (m < 60) return `${Math.round(m)} min`
  const h = Math.floor(m / 60)
  const r = Math.round(m % 60)
  return r ? `${h} h ${r} min` : `${h} h`
}

// ---------------------------------------------------------------- anomaly detection
// Statistical detector (exponentially-weighted mean/variance, z-score). It is the in-browser
// stand-in for the Isolation Forest, which runs in the Python backend.
const MIN_STD: Partial<Record<SensorKey, number>> = { ph: 0.03, tds: 5, ntu: 0.06, temp: 0.5 }
const Z_LIMIT = 6

const HYPOTHESES: Record<string, string[]> = {
  'tds-up': ['Sewage or saline water entering the supply', 'Switch to a different source (e.g. borewell instead of municipal)', 'Loose probe or electrical noise, if it is a single spike'],
  'tds-down': ['Rainwater or RO water mixing in', 'Probe lifted out of the water or an air bubble on it'],
  'ntu-up': ['Sediment stirred up during tank refill or after rain', 'Pipe repair or burst upstream', 'Algae / biofilm growth', 'Air bubble passing the optical sensor, if very brief'],
  'ntu-down': ['Sediment settling after a disturbance'],
  'ph-down': ['pH probe drift — probes need recalibration every few weeks', 'Acidic contamination', 'Dissolved CO₂ from a new source'],
  'ph-up': ['Residue from an alkaline cleaning agent', 'pH probe drift'],
  'temp-up': ['Sun heating the tank or exposed pipes', 'Temperature probe exposed to air'],
  'temp-down': ['Cold water from a new source', 'Probe exposed to air at night'],
}

/**
 * Slow exponentially-weighted baseline (~100 min memory) + noise estimate learned only from normal points.
 * A reading is flagged when it sits more than 6 noise-widths from the baseline. Consecutive flagged
 * readings are merged into one event. The baseline restarts after a data gap so a gap is not mistaken for a jump.
 */
export function detectAnomalies(readings: Reading[]): Anomaly[] {
  const keys: SensorKey[] = ['ph', 'tds', 'ntu', 'temp']
  const out: Anomaly[] = []
  for (const k of keys) {
    const alpha = 0.01
    let mean: number | null = null
    let variance = 0
    let warm = 0
    let lastTs = -Infinity
    let open: (Anomaly & { count: number }) | null = null
    for (const r of readings) {
      const v = r[k]
      if (v === null || v === undefined) continue
      if (r.ts - lastTs > 10 * MIN) {
        if (open) out.push(finish(open))
        open = null
        mean = null
        variance = 0
        warm = 0
      }
      lastTs = r.ts
      if (mean === null) {
        mean = v
        continue
      }
      const sd = Math.max(Math.sqrt(variance), MIN_STD[k] ?? 0)
      const z = (v - mean) / sd
      if (warm > 60 && Math.abs(z) > Z_LIMIT) {
        if (!open) open = { ts: r.ts, sensor: k, value: v, baseline: mean, score: Math.abs(z), direction: z > 0 ? 'up' : 'down', hypotheses: [], count: 0 }
        open.count++
        if (Math.abs(z) > open.score) {
          open.score = Math.abs(z)
          open.ts = r.ts
          open.value = v
        }
      } else if (open && Math.abs(z) < 3) {
        out.push(finish(open))
        open = null
      }
      const diff = Math.max(-3 * sd, Math.min(3 * sd, v - mean))
      mean += alpha * diff
      if (Math.abs(z) < 3) variance = (1 - 0.02) * (variance + 0.02 * (v - mean) ** 2)
      warm++
    }
    if (open) out.push(finish(open))
  }
  return out.sort((a, b) => b.ts - a.ts)
}

function finish(a: Anomaly & { count: number }): Anomaly {
  const key = `${a.sensor}-${a.direction}`
  const hyps = [...(HYPOTHESES[key] ?? ['Unusual change — check the sensor and the water source'])]
  if (a.count <= 2) hyps.unshift('Single-reading spike: most likely a sensor glitch or noise')
  return { ts: a.ts, sensor: a.sensor, value: a.value, baseline: a.baseline, score: a.score, direction: a.direction, hypotheses: hyps }
}

// ---------------------------------------------------------------- data quality
export interface DataQuality {
  gaps: { from: number; to: number; minutes: number }[]
  missing: Record<SensorKey, number>
  total: number
  coveragePct: number
}

export function dataQuality(readings: Reading[], fromTs: number, toTs: number, expectedEveryMs = MIN): DataQuality {
  const gaps: DataQuality['gaps'] = []
  const missing: Record<SensorKey, number> = { ph: 0, tds: 0, ntu: 0, temp: 0, level: 0 }
  let prev = fromTs
  for (const r of readings) {
    if (r.ts - prev > 5 * MIN) gaps.push({ from: prev, to: r.ts, minutes: Math.round((r.ts - prev) / MIN) })
    prev = r.ts
    ;(Object.keys(missing) as SensorKey[]).forEach((k) => {
      if (r[k] === null || r[k] === undefined) missing[k]++
    })
  }
  if (toTs - prev > 5 * MIN) gaps.push({ from: prev, to: toTs, minutes: Math.round((toTs - prev) / MIN) })
  const expected = Math.max(1, (toTs - fromTs) / expectedEveryMs)
  const gapMinutes = gaps.reduce((a, g) => a + g.minutes, 0)
  const coveragePct = Math.max(0, Math.min(100, 100 - (gapMinutes / expected) * 100))
  return { gaps, missing, total: readings.length, coveragePct }
}

// ---------------------------------------------------------------- stats for the assistant
export interface SensorStats {
  min: number | null
  max: number | null
  mean: number | null
  first: number | null
  last: number | null
  maxAt: number | null
  minAt: number | null
  count: number
}

export function stats(readings: Reading[], k: SensorKey): SensorStats {
  let min: number | null = null
  let max: number | null = null
  let sum = 0
  let count = 0
  let first: number | null = null
  let last: number | null = null
  let maxAt: number | null = null
  let minAt: number | null = null
  for (const r of readings) {
    const v = r[k]
    if (v === null || v === undefined) continue
    if (first === null) first = v
    last = v
    if (min === null || v < min) {
      min = v
      minAt = r.ts
    }
    if (max === null || v > max) {
      max = v
      maxAt = r.ts
    }
    sum += v
    count++
  }
  return { min, max, mean: count ? sum / count : null, first, last, maxAt, minAt, count }
}

// ---------------------------------------------------------------- alerts
const NEXT_STEP: Record<string, string> = {
  'ph-warning': 'Watch the trend for 30 min. If it keeps moving, recalibrate the pH probe with 4.0 / 7.0 buffers.',
  'ph-unsafe': 'Stop drinking-water use from this tank, recalibrate the probe, and send a sample for a lab pH test.',
  'tds-warning': 'Check whether the water source changed. Take a sample for a lab TDS/conductivity test.',
  'tds-unsafe': 'Stop supply for drinking, inspect for sewage/salt ingress, and get a lab test before resuming.',
  'ntu-warning': 'Let sediment settle, check filters, and inspect the inlet. Boil or filter before drinking.',
  'ntu-unsafe': 'Do not drink. Flush the tank, inspect inlet pipes, and test for bacteria (turbidity shields germs).',
}

function alertForVerdict(k: SensorKey, status: Status, r: Reading, t: Thresholds): AlertItem {
  const v = screenSensor(k, r[k], t)
  const sev = status === 'unsafe' ? 'critical' : 'warning'
  return {
    id: `thr-${k}-${status}-${r.ts}`,
    ts: r.ts,
    severity: sev,
    sensor: k,
    title: `${SENSORS[k].label} ${status === 'unsafe' ? 'outside safe limit' : k === 'ph' ? 'outside ideal band' : 'above acceptable limit'}`,
    explanation: `${v.reason}. Measured ${fmtWithUnit(k, r[k])} at ${new Date(r.ts).toLocaleString()}.`,
    nextStep: NEXT_STEP[`${k}-${status}`] ?? 'Inspect the sensor and the water source.',
    value: r[k],
    kind: 'threshold',
  }
}

/** Status only (no strings) — fast path for scanning 40k+ readings. Must agree with screenSensor. */
function quickStatus(k: 'ph' | 'tds' | 'ntu', v: number | null, t: Thresholds): Status {
  if (v === null || !Number.isFinite(v)) return 'unknown'
  if (k === 'ph') {
    if (v < 0 || v > 14) return 'unknown'
    if (v < t.ph.warnMin || v > t.ph.warnMax) return 'unsafe'
    if (v < t.ph.safeMin || v > t.ph.safeMax) return 'warning'
    return 'safe'
  }
  if (k === 'tds') {
    if (v < 0 || v > 1000) return 'unknown'
    if (v >= t.tds.probeMax || v >= t.tds.warnMax) return 'unsafe'
    return v > t.tds.safeMax ? 'warning' : 'safe'
  }
  if (v < 0 || v > 3000) return 'unknown'
  if (v > t.ntu.warnMax) return 'unsafe'
  return v > t.ntu.safeMax ? 'warning' : 'safe'
}

export function deriveAlerts(readings: Reading[], t: Thresholds, anomalies: Anomaly[], now = Date.now()): AlertItem[] {
  const alerts: AlertItem[] = []
  const quality = ['ph', 'tds', 'ntu'] as const
  const prev: Record<string, Status> = { ph: 'safe', tds: 'safe', ntu: 'safe' }
  const lastAlertAt: Record<string, number> = {}
  const missingRun: Record<string, number | null> = { ph: null, tds: null, ntu: null, temp: null, level: null }
  let prevTs: number | null = null

  for (const r of readings) {
    if (prevTs !== null && r.ts - prevTs > 10 * MIN) {
      const mins = Math.round((r.ts - prevTs) / MIN)
      alerts.push({
        id: `gap-${prevTs}`,
        ts: r.ts,
        severity: 'warning',
        sensor: 'device',
        title: `No data for ${humanMins(mins)}`,
        explanation: `The device sent nothing between ${new Date(prevTs).toLocaleString()} and ${new Date(r.ts).toLocaleString()}. Water state during this period is unknown.`,
        nextStep: 'Check Wi-Fi and power at the unit. Consider a battery backup.',
        kind: 'data',
      })
    }
    prevTs = r.ts

    for (const k of ['ph', 'tds', 'ntu', 'temp', 'level'] as SensorKey[]) {
      const isMissing = r[k] === null || r[k] === undefined
      if (isMissing && missingRun[k] === null) missingRun[k] = r.ts
      if (!isMissing && missingRun[k] !== null) {
        const from = missingRun[k] as number
        const mins = Math.round((r.ts - from) / MIN)
        if (mins >= 5) {
          alerts.push({
            id: `miss-${k}-${from}`,
            ts: from,
            severity: 'warning',
            sensor: k,
            title: `${SENSORS[k].label} sensor sent no data`,
            explanation: `${SENSORS[k].label} values were missing for ${humanMins(mins)} starting ${new Date(from).toLocaleString()}. Screening was Unknown during this time.`,
            nextStep: `Check the ${SENSORS[k].hardware} cable and connector; reseat the probe.`,
            kind: 'data',
          })
        }
        missingRun[k] = null
      }
    }

    for (const k of quality) {
      const s = quickStatus(k, r[k], t)
      if (s === 'unknown') continue
      const rank = { safe: 0, unknown: 1, warning: 2, unsafe: 3 }
      if (rank[s] > rank[prev[k]] && (s === 'warning' || s === 'unsafe')) {
        const key = `${k}-${s}`
        if (!lastAlertAt[key] || r.ts - lastAlertAt[key] > 3 * 60 * MIN) {
          alerts.push(alertForVerdict(k, s, r, t))
          lastAlertAt[key] = r.ts
        }
      }
      prev[k] = s
    }
  }

  // a run of missing values still going on now
  const lastR = readings[readings.length - 1]
  for (const k of ['ph', 'tds', 'ntu', 'temp', 'level'] as SensorKey[]) {
    const from = missingRun[k]
    if (from !== null && lastR && lastR.ts - from >= 0) {
      alerts.push({
        id: `miss-${k}-${from}`,
        ts: from,
        severity: k === 'temp' || k === 'level' ? 'warning' : 'critical',
        sensor: k,
        title: `${SENSORS[k].label} sensor not reporting`,
        explanation: `No valid ${SENSORS[k].label} value since ${new Date(from).toLocaleString()}. Overall screening cannot be Safe while this continues.`,
        nextStep: `Check the ${SENSORS[k].hardware} wiring and power; replace the probe if the fault persists.`,
        kind: 'data',
      })
    }
  }

  if (lastR && now - lastR.ts > t.staleAfterSec * 1000) {
    alerts.push({
      id: `stale-${lastR.ts}`,
      ts: lastR.ts + t.staleAfterSec * 1000,
      severity: 'critical',
      sensor: 'device',
      title: 'Device stopped reporting',
      explanation: `Last packet received ${new Date(lastR.ts).toLocaleString()}. Live screening is Unknown until data resumes.`,
      nextStep: 'Check power, Wi-Fi and the ESP32 status LED. Do not assume the water is safe meanwhile.',
      kind: 'data',
    })
  }

  for (const a of anomalies) {
    alerts.push({
      id: `ano-${a.sensor}-${a.ts}`,
      ts: a.ts,
      severity: a.hypotheses[0]?.startsWith('Single-reading') ? 'info' : 'warning',
      sensor: a.sensor,
      title: `Sudden ${a.direction === 'up' ? 'rise' : 'drop'} in ${SENSORS[a.sensor].label}`,
      explanation: `${SENSORS[a.sensor].label} reached ${fmtWithUnit(a.sensor, a.value)} vs a recent baseline of ${fmtWithUnit(a.sensor, a.baseline)} (score ${a.score.toFixed(1)}). Possible cause (unconfirmed): ${a.hypotheses[0].toLowerCase()}.`,
      nextStep: 'Compare with the other sensors at the same time. If it repeats, inspect the probe and source.',
      value: a.value,
      kind: 'anomaly',
    })
  }

  return alerts.sort((a, b) => b.ts - a.ts)
}
