import type { Reading } from './types'

// Deterministic demo data. Same seed → same 30-day history shape every time.
// Everything produced here is SIMULATED and labelled as such in the UI.

export type Scenario = 'normal' | 'contamination' | 'sensor_fault' | 'offline'

export const SCENARIOS: { id: Scenario; label: string; desc: string }[] = [
  { id: 'normal', label: 'Normal operation', desc: 'Steady readings with natural daily variation.' },
  { id: 'contamination', label: 'Contamination event', desc: 'TDS and turbidity climb within minutes; pH dips.' },
  { id: 'sensor_fault', label: 'pH sensor fault', desc: 'pH probe stops sending values (null).' },
  { id: 'offline', label: 'Device offline', desc: 'No new packets; data goes stale.' },
]

export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function gauss(rng: () => number) {
  const u = Math.max(rng(), 1e-9)
  const v = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

/** 0→1→0 trapezoid: ramps up over `ramp` minutes, holds, ramps down. */
function pulse(ts: number, start: number, durationMin: number, rampMin: number) {
  const x = (ts - start) / MIN
  if (x < 0 || x > durationMin) return 0
  if (x < rampMin) return x / rampMin
  if (x > durationMin - rampMin) return (durationMin - x) / rampMin
  return 1
}

function hourOf(ts: number) {
  const d = new Date(ts)
  return d.getHours() + d.getMinutes() / 60
}

export function baseline(ts: number) {
  const h = hourOf(ts)
  const day = Math.sin(((h - 9) / 24) * 2 * Math.PI) // peaks mid-afternoon
  return {
    ph: 7.22 + 0.07 * day,
    tds: 318 + 14 * day,
    ntu: 0.42 + 0.08 * Math.max(0, Math.sin(((h - 6) / 24) * 2 * Math.PI)),
    temp: 26.4 + 2.1 * day,
  }
}

export function consumptionPerMin(ts: number) {
  const h = hourOf(ts)
  if (h >= 6 && h < 9) return 0.34
  if (h >= 18 && h < 21) return 0.29
  if (h >= 12 && h < 14) return 0.16
  if (h < 5) return 0.02
  return 0.08
}

export const PUMP_FILL_PER_MIN = 1.25

export interface History {
  readings: Reading[]
  level: number
  pump: boolean
}

/** Generates 30 days of one-minute readings ending at `now`, with a few built-in incidents. */
export function generateHistory(now: number, days = 30, seed = 42): History {
  const rng = mulberry32(seed)
  const end = Math.floor(now / MIN) * MIN
  const start = end - days * DAY
  const out: Reading[] = []
  let level = 68
  let pump = false

  // Incidents, placed relative to the end so they always appear in the window.
  const gapStart = end - 26 * DAY + 3 * HOUR // device offline 3 h
  const phLow = end - 19 * DAY + 11 * HOUR // pH drift down
  const rain = end - 12 * DAY + 15 * HOUR // turbidity rise after rain
  const tdsSpike = end - 5 * DAY + 10 * HOUR // TDS ingress
  const phFault = end - 9 * DAY + 2 * HOUR // pH probe drops out
  const turbBlip = end - 20 * HOUR // short turbidity bump
  const glitch = end - 3 * HOUR - 7 * MIN // single-point TDS glitch

  for (let ts = start; ts <= end; ts += MIN) {
    // Tank physics runs even during the gap; we just don't record readings.
    level += -consumptionPerMin(ts) * (0.8 + 0.4 * rng()) + (pump ? PUMP_FILL_PER_MIN : 0)
    level = Math.min(100, Math.max(0, level))
    if (level < 20) pump = true
    if (level > 95) pump = false

    if (ts >= gapStart && ts < gapStart + 3 * HOUR) continue

    const b = baseline(ts)
    let ph = b.ph + gauss(rng) * 0.025
    let tds = b.tds + gauss(rng) * 3.5
    let ntu = b.ntu + Math.abs(gauss(rng)) * 0.04
    const temp = b.temp + gauss(rng) * 0.08

    ph -= 0.95 * pulse(ts, phLow, 150, 50)
    ntu += 2.6 * pulse(ts, rain, 260, 70)
    tds += 330 * pulse(ts, tdsSpike, 190, 35)
    ntu += 1.05 * pulse(ts, turbBlip, 35, 10)
    if (ts === glitch) tds = 978

    const phMissing = ts >= phFault && ts < phFault + 40 * MIN

    out.push({
      ts,
      ph: phMissing ? null : round(ph, 2),
      tds: round(Math.min(1000, Math.max(0, tds)), 0),
      ntu: round(Math.max(0.02, ntu), 2),
      temp: round(temp, 1),
      level: round(Math.min(100, Math.max(0, level + gauss(rng) * 0.3)), 1), // ultrasonic noise
      pump,
    })
  }
  return { readings: out, level, pump }
}

export interface LiveState {
  level: number
  pump: boolean
}

/** Produces the next simulated live reading `dtSec` after the previous one. */
export function nextLiveReading(
  ts: number,
  dtSec: number,
  state: LiveState,
  scenario: Scenario,
  scenarioSince: number,
  rng: () => number,
): Reading {
  const mins = dtSec / 60
  state.level += -consumptionPerMin(ts) * mins * (0.8 + 0.4 * rng()) + (state.pump ? PUMP_FILL_PER_MIN * mins : 0)
  state.level = Math.min(100, Math.max(0, state.level))

  const b = baseline(ts)
  let ph: number | null = b.ph + gauss(rng) * 0.025
  let tds = b.tds + gauss(rng) * 3.5
  let ntu = b.ntu + Math.abs(gauss(rng)) * 0.04
  const temp = b.temp + gauss(rng) * 0.08

  if (scenario === 'contamination') {
    const k = Math.min(1, (ts - scenarioSince) / (150 * 1000)) // reaches full effect in 2.5 min
    tds += 760 * k
    ntu += 6.4 * k
    ph -= 0.45 * k
  }
  if (scenario === 'sensor_fault') ph = null

  return {
    ts,
    ph: ph === null ? null : round(ph, 2),
    tds: round(Math.min(1000, Math.max(0, tds)), 0),
    ntu: round(Math.max(0.02, ntu), 2),
    temp: round(temp, 1),
    level: round(Math.min(100, Math.max(0, state.level + gauss(rng) * 0.3)), 1),
    pump: state.pump,
  }
}

function round(v: number, d: number) {
  const p = 10 ** d
  return Math.round(v * p) / p
}
