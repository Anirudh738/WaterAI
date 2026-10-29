import clsx from 'clsx'
import { Droplets, FlaskConical, Gauge, Thermometer, Waves, type LucideIcon } from 'lucide-react'
import type { ChartPoint } from '../lib/analytics'
import { fmt, SENSORS } from '../lib/sensors'
import type { SensorKey, SensorVerdict } from '../lib/types'
import { Sparkline } from './charts'
import { StatusPill } from './ui'

export const SENSOR_ICON: Record<SensorKey, LucideIcon> = { ph: FlaskConical, tds: Droplets, ntu: Waves, temp: Thermometer, level: Gauge }

export function SensorCard({ k, verdict, spark, stale, delta }: { k: SensorKey; verdict: SensorVerdict; spark: ChartPoint[]; stale: boolean; delta?: number | null }) {
  const meta = SENSORS[k]
  const Icon = SENSOR_ICON[k]
  const v = verdict.value
  return (
    <div className={clsx('glass group relative overflow-hidden rounded-2xl p-4 transition hover:-translate-y-0.5 hover:ring-1 hover:ring-sky-400/20', stale && 'opacity-70')}>
      <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full opacity-[0.07] blur-2xl transition group-hover:opacity-20" style={{ background: meta.color }} />
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-lg ring-1 ring-sky-900/[0.12]" style={{ background: `${meta.color}1a` }}>
            <Icon className="h-4 w-4" style={{ color: meta.color }} />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-700">{meta.label}</p>
            <p className="text-[10px] text-slate-500">{meta.hardware}</p>
          </div>
        </div>
        <StatusPill status={verdict.status} />
      </div>
      <div className="mt-3 flex items-baseline gap-1.5">
        <span className="num text-3xl font-semibold text-slate-900">{fmt(k, v)}</span>
        {meta.unit && v !== null && <span className="text-xs font-medium text-slate-600">{meta.unit}</span>}
        {delta !== null && delta !== undefined && v !== null && (
          <span className={clsx('num ml-auto text-[11px] font-semibold', delta > 0 ? 'text-sky-700' : delta < 0 ? 'text-violet-700' : 'text-slate-500')}>
            {delta > 0 ? '▲' : delta < 0 ? '▼' : '•'} {Math.abs(delta).toFixed(SENSORS[k].digits)} <span className="font-normal text-slate-500">1h</span>
          </span>
        )}
      </div>
      <p className="mt-1 line-clamp-1 text-[11px] text-slate-600" title={verdict.reason}>
        {stale ? 'Stale — last known value' : verdict.reason}
      </p>
      <div className="mt-2 -mx-1">{spark.length > 1 ? <Sparkline data={spark} k={k} /> : <div className="h-10" />}</div>
    </div>
  )
}
