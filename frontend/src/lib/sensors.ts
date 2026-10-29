import type { SensorKey, Status, Thresholds } from './types'

export const SENSORS: Record<
  SensorKey,
  { label: string; labelHi: string; unit: string; digits: number; hardware: string; color: string; short: string }
> = {
  ph: { label: 'pH', labelHi: 'पीएच', unit: '', digits: 2, hardware: 'DFRobot SEN0161-V2', color: '#0284c7', short: 'pH' },
  tds: { label: 'TDS', labelHi: 'टीडीएस', unit: 'mg/L', digits: 0, hardware: 'DFRobot SEN0244', color: '#7c3aed', short: 'TDS' },
  ntu: { label: 'Turbidity', labelHi: 'गंदलापन', unit: 'NTU', digits: 2, hardware: 'DFRobot SEN0189', color: '#d97706', short: 'Turb.' },
  temp: { label: 'Temperature', labelHi: 'तापमान', unit: '°C', digits: 1, hardware: 'DS18B20', color: '#e11d48', short: 'Temp' },
  level: { label: 'Tank level', labelHi: 'टंकी स्तर', unit: '%', digits: 0, hardware: 'JSN-SR04T', color: '#0d9488', short: 'Level' },
}

export const SENSOR_KEYS: SensorKey[] = ['ph', 'tds', 'ntu', 'temp', 'level']

/** Defaults follow BIS IS 10500:2012 and the decision table in the project deck (slide 11). */
export const DEFAULT_THRESHOLDS: Thresholds = {
  ph: { safeMin: 6.7, safeMax: 8.3, warnMin: 6.5, warnMax: 8.5 },
  tds: { safeMax: 500, warnMax: 1000, probeMax: 1000 },
  ntu: { safeMax: 1, warnMax: 5 },
  temp: { validMin: 0, validMax: 60, warnAbove: 35 },
  level: { pumpOnBelow: 20, pumpOffAbove: 95 },
  staleAfterSec: 60,
}

export function fmt(key: SensorKey, v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  return v.toFixed(SENSORS[key].digits)
}

export function fmtWithUnit(key: SensorKey, v: number | null | undefined): string {
  const u = SENSORS[key].unit
  const f = fmt(key, v)
  if (f === '—') return f
  return u ? `${f} ${u}` : f
}

export const STATUS_META: Record<Status, { label: string; tone: string; dot: string; ring: string; text: string; bg: string }> = {
  safe: { label: 'Safe', tone: 'emerald', dot: 'bg-emerald-500', ring: 'ring-emerald-400/30', text: 'text-emerald-700', bg: 'bg-emerald-400/10' },
  warning: { label: 'Warning', tone: 'amber', dot: 'bg-amber-500', ring: 'ring-amber-400/30', text: 'text-amber-700', bg: 'bg-amber-400/10' },
  unsafe: { label: 'Unsafe', tone: 'rose', dot: 'bg-rose-500', ring: 'ring-rose-400/40', text: 'text-rose-700', bg: 'bg-rose-500/10' },
  unknown: { label: 'Unknown', tone: 'slate', dot: 'bg-slate-400', ring: 'ring-slate-400/30', text: 'text-slate-700', bg: 'bg-slate-400/10' },
}

export function timeAgo(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h} h ago`
  return `${Math.round(h / 24)} d ago`
}

export function fmtTime(ts: number, withDate = true): string {
  const d = new Date(ts)
  const t = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (!withDate) return t
  return `${d.toLocaleDateString([], { day: '2-digit', month: 'short' })}, ${t}`
}
