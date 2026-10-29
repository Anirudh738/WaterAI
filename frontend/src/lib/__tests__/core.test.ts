import { describe, expect, it } from 'vitest'
import { deriveAlerts, detectAnomalies, forecastTank } from '../analytics'
import { generateHistory } from '../demoData'
import { sanitizeReading, screen, screenSensor } from '../screening'
import { DEFAULT_THRESHOLDS as T } from '../sensors'
import type { Reading } from '../types'

const now = Date.UTC(2026, 9, 28, 12, 0, 0)
const ok: Reading = { ts: now, ph: 7.2, tds: 320, ntu: 0.5, temp: 26, level: 60 }

describe('screening', () => {
  it('is safe when all quality sensors are within limits', () => {
    expect(screen(ok, T, now).status).toBe('safe')
  })
  it('never says safe with a missing quality sensor', () => {
    expect(screen({ ...ok, ph: null }, T, now).status).toBe('unknown')
  })
  it('is unknown when data is stale', () => {
    expect(screen(ok, T, now + 5 * 60_000).status).toBe('unknown')
  })
  it('keeps unsafe even if stale (conservative)', () => {
    expect(screen({ ...ok, ntu: 9 }, T, now + 5 * 60_000).status).toBe('unsafe')
  })
  it('treats a maxed TDS probe as unsafe', () => {
    expect(screen({ ...ok, tds: 1000 }, T, now).status).toBe('unsafe')
  })
  it('warns between acceptable and unsafe limits', () => {
    expect(screen({ ...ok, tds: 620 }, T, now).status).toBe('warning')
    expect(screen({ ...ok, ph: 6.6 }, T, now).status).toBe('warning')
  })
  it('downgrades safe to warning when temperature is missing', () => {
    expect(screen({ ...ok, temp: null }, T, now).status).toBe('warning')
  })
  it('alert scan agrees with the screening engine', () => {
    // an alert must exist for each first crossing into warning/unsafe
    const rs: Reading[] = [ok, { ...ok, ts: now + 60_000, tds: 700 }, { ...ok, ts: now + 120_000, tds: 1000 }]
    const al = deriveAlerts(rs, T, [], now + 120_000)
    expect(al.filter((a) => a.sensor === 'tds').map((a) => a.severity)).toEqual(['critical', 'warning'])
    expect(screenSensor('tds', 700, T).status).toBe('warning')
  })
  it('rejects out-of-range values and future timestamps', () => {
    const r = sanitizeReading({ ts: now + 3600_000, ph: 19, tds: 300, ntu: 0.4, temp: 25, level: 50 }, now)
    expect(r.reading.ph).toBeNull()
    expect(r.issues.length).toBe(2)
  })
})

describe('demo history + models', () => {
  const h = generateHistory(now)
  it('is deterministic', () => {
    expect(generateHistory(now).readings[1000]).toEqual(h.readings[1000])
  })
  it('contains a 3 h gap and incidents that raise alerts', () => {
    const alerts = deriveAlerts(h.readings, T, detectAnomalies(h.readings), now)
    expect(alerts.some((a) => a.kind === 'data' && a.title.startsWith('No data'))).toBe(true)
    expect(alerts.some((a) => a.sensor === 'tds' && a.kind === 'threshold')).toBe(true)
    expect(alerts.some((a) => a.sensor === 'ph' && a.severity === 'critical')).toBe(true)
  })
  it('flags the single TDS glitch as an anomaly', () => {
    const an = detectAnomalies(h.readings)
    expect(an.some((a) => a.sensor === 'tds' && a.value > 900)).toBe(true)
  })
  it('fits a linear tank forecast on a clean ramp', () => {
    const rs: Reading[] = Array.from({ length: 31 }, (_, i) => ({ ...ok, ts: now - (30 - i) * 60_000, level: 80 - i * 0.5, pump: false }))
    const f = forecastTank(rs, T, now)
    expect(f.reliable).toBe(true)
    expect(f.trend).toBe('draining')
    expect(f.slopePerHour).toBeCloseTo(-30, 0)
    expect(f.etaMinutes).toBeCloseTo(90, 0) // 65% → 20% at 30 %/h
  })
  it('refuses to forecast with too little data', () => {
    const f = forecastTank([ok], T, now)
    expect(f.reliable).toBe(false)
    expect(f.etaLabel).toBeNull()
  })
})
