import { Area, AreaChart, CartesianGrid, Line, ComposedChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { ChartPoint } from '../lib/analytics'
import { fmt, SENSORS } from '../lib/sensors'
import type { SensorKey, Thresholds } from '../lib/types'

export type RangeKey = '1h' | '24h' | '7d' | '30d'
export const RANGE_MS: Record<RangeKey, number> = { '1h': 3600_000, '24h': 86400_000, '7d': 7 * 86400_000, '30d': 30 * 86400_000 }

function tickFmt(range: RangeKey) {
  return (ts: number) => {
    const d = new Date(ts)
    if (range === '1h' || range === '24h') return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    return d.toLocaleDateString([], { day: '2-digit', month: 'short' })
  }
}

export function limitLines(k: SensorKey, t: Thresholds): { y: number; color: string; label: string }[] {
  const amber = '#d97706'
  const rose = '#e11d48'
  const slate = '#64748b'
  switch (k) {
    case 'ph':
      return [
        { y: t.ph.safeMin, color: amber, label: `${t.ph.safeMin}` },
        { y: t.ph.safeMax, color: amber, label: `${t.ph.safeMax}` },
        { y: t.ph.warnMin, color: rose, label: `${t.ph.warnMin}` },
        { y: t.ph.warnMax, color: rose, label: `${t.ph.warnMax}` },
      ]
    case 'tds':
      return [
        { y: t.tds.safeMax, color: amber, label: `${t.tds.safeMax}` },
        { y: t.tds.warnMax, color: rose, label: `${t.tds.warnMax}` },
      ]
    case 'ntu':
      return [
        { y: t.ntu.safeMax, color: amber, label: `${t.ntu.safeMax}` },
        { y: t.ntu.warnMax, color: rose, label: `${t.ntu.warnMax}` },
      ]
    case 'temp':
      return [{ y: t.temp.warnAbove, color: amber, label: `${t.temp.warnAbove}` }]
    case 'level':
      return [
        { y: t.level.pumpOnBelow, color: slate, label: 'pump on' },
        { y: t.level.pumpOffAbove, color: slate, label: 'pump off' },
      ]
  }
}

function domainFor(k: SensorKey, data: ChartPoint[], t: Thresholds): [number, number] {
  let lo = Infinity
  let hi = -Infinity
  for (const p of data) {
    const v = p[k]
    if (v === null || v === undefined) continue
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  if (!Number.isFinite(lo)) return [0, 1]
  // always keep the nearest "acceptable" limit in view so headroom is visible
  if (k === 'ph') {
    lo = Math.min(lo, t.ph.safeMin)
    hi = Math.max(hi, t.ph.safeMax)
  }
  if (k === 'tds') hi = Math.max(hi, t.tds.safeMax)
  if (k === 'ntu') hi = Math.max(hi, t.ntu.safeMax)
  if (k === 'level') return [0, 100]
  const pad = (hi - lo) * 0.1 || 1
  return [Math.max(0, lo - pad), hi + pad]
}

function ChartTooltip({ active, payload, label, k }: { active?: boolean; payload?: { value: number | null; dataKey: string }[]; label?: number; k: SensorKey }) {
  if (!active || !payload?.length || label === undefined) return null
  const v = payload.find((p) => p.dataKey === k)?.value
  const proj = payload.find((p) => p.dataKey === 'projection')?.value
  return (
    <div className="glass rounded-lg px-3 py-2 text-xs">
      <p className="text-slate-600">{new Date(label).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
      {v !== undefined && (
        <p className="num mt-0.5 font-semibold text-slate-900">
          {v === null ? 'No data' : `${fmt(k, v)} ${SENSORS[k].unit}`}
        </p>
      )}
      {proj !== undefined && proj !== null && <p className="num mt-0.5 font-semibold text-sky-800">Forecast {fmt(k, proj)} {SENSORS[k].unit}</p>}
    </div>
  )
}

export function SensorChart({ k, data, thresholds, range, height = 220, showLimits = true }: { k: SensorKey; data: ChartPoint[]; thresholds: Thresholds; range: RangeKey; height?: number; showLimits?: boolean }) {
  const color = SENSORS[k].color
  const id = `g-${k}`
  const [lo, hi] = domainFor(k, data, thresholds)
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.32} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="ts" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={tickFmt(range)} tickLine={false} axisLine={false} minTickGap={40} />
          <YAxis domain={[lo, hi]} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1))} allowDataOverflow />
          <Tooltip content={<ChartTooltip k={k} />} />
          {showLimits &&
            limitLines(k, thresholds)
              .filter((l) => l.y >= lo && l.y <= hi)
              .map((l) => <ReferenceLine key={`${l.y}-${l.label}`} y={l.y} stroke={l.color} strokeDasharray="4 4" strokeOpacity={0.55} label={{ value: l.label, position: 'insideTopRight', fill: l.color, fontSize: 10 }} />)}
          <Area type="monotone" dataKey={k} stroke={color} strokeWidth={1.8} fill={`url(#${id})`} isAnimationActive={false} connectNulls={false} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

export function Sparkline({ data, k }: { data: ChartPoint[]; k: SensorKey }) {
  const color = SENSORS[k].color
  return (
    <div className="h-10 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={`sp-${k}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis hide domain={['dataMin', 'dataMax']} />
          <Area type="monotone" dataKey={k} stroke={color} strokeWidth={1.5} fill={`url(#sp-${k})`} isAnimationActive={false} dot={false} connectNulls={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

export function ForecastChart({ history, projection, thresholds }: { history: ChartPoint[]; projection: { ts: number; level: number }[]; thresholds: Thresholds }) {
  const lastHist = history[history.length - 1]
  const data: (ChartPoint & { projection?: number | null })[] = [
    ...history.map((p) => ({ ...p, projection: null })),
    ...(lastHist ? [{ ts: lastHist.ts, level: lastHist.level, projection: lastHist.level ?? null }] : []),
    ...projection.map((p) => ({ ts: p.ts, level: null, projection: p.level })),
  ]
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <defs>
            <linearGradient id="g-fc" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.28} />
              <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="ts" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={tickFmt('24h')} tickLine={false} axisLine={false} minTickGap={40} />
          <YAxis domain={[0, 100]} tickLine={false} axisLine={false} width={48} />
          <Tooltip content={<ChartTooltip k="level" />} />
          <ReferenceLine y={thresholds.level.pumpOnBelow} stroke="#64748b" strokeDasharray="4 4" label={{ value: 'pump on', position: 'insideTopRight', fill: '#64748b', fontSize: 10 }} />
          <ReferenceLine y={thresholds.level.pumpOffAbove} stroke="#64748b" strokeDasharray="4 4" label={{ value: 'pump off', position: 'insideBottomRight', fill: '#64748b', fontSize: 10 }} />
          {lastHist && <ReferenceLine x={lastHist.ts} stroke="#0284c7" strokeOpacity={0.45} label={{ value: 'now', position: 'insideTopLeft', fill: '#0369a1', fontSize: 10 }} />}
          <Area type="monotone" dataKey="level" stroke="#0284c7" strokeWidth={1.8} fill="url(#g-fc)" isAnimationActive={false} dot={false} connectNulls={false} />
          <Line type="linear" dataKey="projection" stroke="#0ea5e9" strokeWidth={2} strokeDasharray="6 5" dot={false} isAnimationActive={false} connectNulls={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

export function TankGauge({ level, pump, thresholds, unknown }: { level: number | null; pump: boolean; thresholds: Thresholds; unknown?: boolean }) {
  const pct = level === null ? 0 : Math.max(0, Math.min(100, level))
  const low = level !== null && level < thresholds.level.pumpOnBelow
  return (
    <div className="relative mx-auto h-44 w-28">
      <div className="absolute inset-0 overflow-hidden rounded-[22px] border border-sky-900/[0.12] bg-sky-50 shadow-inner">
        <div className={`absolute inset-x-0 bottom-0 transition-[height] duration-1000 ease-out ${unknown ? 'opacity-30 grayscale' : ''}`} style={{ height: `${pct}%` }}>
          <div className={`absolute inset-0 bg-gradient-to-t ${low ? 'from-amber-500/80 to-amber-300/70' : 'from-sky-600/85 to-sky-300/75'}`} />
          <svg className="wave absolute -top-2 left-0 h-3 w-[200%]" viewBox="0 0 200 10" preserveAspectRatio="none">
            <path d="M0 5 Q 12.5 0 25 5 T 50 5 T 75 5 T 100 5 T 125 5 T 150 5 T 175 5 T 200 5 V10 H0 Z" fill={low ? 'rgba(252,211,77,0.75)' : 'rgba(125,211,252,0.8)'} />
          </svg>
        </div>
        {[thresholds.level.pumpOffAbove, thresholds.level.pumpOnBelow].map((y) => (
          <div key={y} className="absolute inset-x-0 border-t border-dashed border-sky-900/[0.22]" style={{ bottom: `${y}%` }}>
            <span className="absolute -top-2 right-1 text-[9px] font-semibold text-slate-700/80">{y}%</span>
          </div>
        ))}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="num text-2xl font-bold text-slate-900 drop-shadow">{level === null ? '—' : `${pct.toFixed(0)}%`}</span>
          <span className={`mt-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${pump ? 'bg-sky-400/20 text-sky-800' : 'bg-sky-900/[0.07] text-slate-700'}`}>PUMP {pump ? 'ON' : 'OFF'}</span>
        </div>
      </div>
    </div>
  )
}
