import clsx from 'clsx'
import { AlertTriangle, Brain, CircleCheck, Database, LineChart, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ForecastChart } from '../components/charts'
import { Badge, Card, EmptyState, PageHeader, Segmented, Skeleton, Stat } from '../components/ui'
import { dataQuality, downsample, humanMins, sliceRange } from '../lib/analytics'
import { MODEL_SLOTS } from '../lib/models'
import { fmtTime, fmtWithUnit, SENSOR_KEYS, SENSORS } from '../lib/sensors'
import { useStore } from '../lib/store'
import type { SensorKey } from '../lib/types'

export default function Insights() {
  const s = useStore()
  const [filter, setFilter] = useState<SensorKey | 'all'>('all')
  const hist = useMemo(() => downsample(sliceRange(s.readings, s.now - 6 * 3600_000), 240), [s.readings, s.now])
  const dq = useMemo(() => dataQuality(sliceRange(s.readings, s.now - 7 * 86400_000), s.now - 7 * 86400_000, s.now), [s.readings, s.now])
  const anomalies = s.anomalies.filter((a) => filter === 'all' || a.sensor === filter)
  const f = s.forecast
  const backendModels = s.health?.models

  if (s.loading) return <Skeleton className="h-[600px]" />

  return (
    <div className="fade-up space-y-5">
      <PageHeader title="AI insights" subtitle="What the models see, how confident they are, and what they cannot know." />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {MODEL_SLOTS.map((m) => {
          const backendStatus = backendModels?.[m.id]
          const viaBackend = m.id === 'anomaly' && s.anomalySource === 'backend'
          const active = m.status === 'active' || viaBackend
          return (
            <div key={m.id} className="glass rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Brain className="h-4 w-4 text-sky-700" /> {m.planned}
                </span>
                <Badge tone={active ? 'emerald' : 'amber'}>{active ? 'active' : 'stand-in'}</Badge>
              </div>
              <p className="mt-1 text-xs text-slate-600">{m.purpose}</p>
              <div className="mt-3 rounded-lg bg-sky-900/[0.03] px-3 py-2 ring-1 ring-sky-900/[0.07]">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Running now ({viaBackend ? 'backend' : 'browser'})</p>
                <p className="text-sm font-medium text-slate-800">{viaBackend ? 'scikit-learn Isolation Forest (fitted on last 7 days)' : m.runningNow}</p>
                {backendStatus && <p className="mt-1 text-[11px] text-emerald-700/90">Backend: {backendStatus}</p>}
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-slate-500">{m.note}</p>
            </div>
          )
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2" title="Tank level forecast" icon={LineChart} subtitle={f.method} action={<Badge tone={f.reliable ? 'emerald' : 'amber'}>{f.reliable ? 'reliable fit' : 'low confidence'}</Badge>}>
          {!f.reliable && (
            <div className="mb-3 flex items-start gap-2 rounded-lg bg-amber-400/10 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-400/20">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                <b>Data-quality warning:</b> {f.qualityNote} {f.etaLabel ? 'The estimate below is shown for reference only.' : ''}
              </span>
            </div>
          )}
          <ForecastChart history={hist} projection={f.projection} thresholds={s.thresholds} />
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Trend" value={f.trend} />
            <Stat label="Rate" value={f.slopePerHour !== null ? `${f.slopePerHour > 0 ? '+' : ''}${f.slopePerHour.toFixed(1)} %/h` : '—'} />
            <Stat label="R²" value={f.r2 !== null ? f.r2.toFixed(2) : '—'} />
            <Stat label="Points" value={f.points} />
          </div>
          <p className="mt-3 text-sm text-slate-800">{f.etaLabel ?? 'No forecast'}</p>
          <p className="mt-1 text-[11px] text-slate-500">Prediction, not a measurement. It assumes usage continues at the rate seen in the last 30 min.</p>
        </Card>

        <Card title="Data quality · 7 days" icon={Database}>
          <div className="grid grid-cols-2 gap-4">
            <Stat label="Coverage" value={`${dq.coveragePct.toFixed(1)}%`} />
            <Stat label="Readings" value={dq.total.toLocaleString()} />
            <Stat label="Gaps > 5 min" value={dq.gaps.length} />
            <Stat label="Stale now" value={s.screening.stale ? 'yes' : 'no'} />
          </div>
          <div className="mt-4 space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Missing values per sensor</p>
            {SENSOR_KEYS.map((k) => (
              <div key={k} className="flex items-center gap-2 text-xs">
                <span className="w-24 text-slate-600">{SENSORS[k].label}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-sky-900/[0.045]">
                  <div className="h-full rounded-full bg-amber-500" style={{ width: `${Math.min(100, (dq.missing[k] / Math.max(1, dq.total)) * 100 * 20)}%` }} />
                </div>
                <span className="num w-10 text-right text-slate-700">{dq.missing[k]}</span>
              </div>
            ))}
          </div>
          {dq.gaps.length > 0 && (
            <ul className="mt-4 space-y-1 text-xs text-slate-600">
              {dq.gaps.slice(0, 4).map((g) => (
                <li key={g.from}>
                  Gap of {humanMins(g.minutes)} from {fmtTime(g.from)}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card
        title="Sudden changes & anomalies · 30 days"
        icon={Sparkles}
        subtitle={s.anomalySource === 'backend' ? 'Isolation Forest (backend) flags readings that are easy to isolate and far from their recent baseline. Higher score = more unusual. Explanations are possibilities, not proven causes.' : 'Flagged when a reading jumps more than 6 standard deviations from its recent baseline. Explanations are possibilities, not proven causes.'}
        action={<Segmented value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, ...(['ph', 'tds', 'ntu', 'temp'] as SensorKey[]).map((k) => ({ value: k, label: SENSORS[k].short }))]} />}
      >
        {anomalies.length === 0 ? (
          <EmptyState icon={CircleCheck} title="No anomalies" body="No sudden changes were detected for this filter." />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {anomalies.map((a) => (
              <div key={`${a.sensor}-${a.ts}`} className="rounded-xl bg-sky-900/[0.03] p-4 ring-1 ring-sky-900/[0.07]">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: SENSORS[a.sensor].color }} />
                  <span className="text-sm font-semibold text-slate-900">
                    {SENSORS[a.sensor].label} {a.direction === 'up' ? 'rise' : 'drop'}
                  </span>
                  <span className="ml-auto text-[11px] text-slate-500">{fmtTime(a.ts)}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  <span className="text-slate-600">
                    Measured <b className="num text-slate-900">{fmtWithUnit(a.sensor, a.value)}</b>
                  </span>
                  <span className="text-slate-600">
                    Baseline <b className="num text-slate-900">{fmtWithUnit(a.sensor, a.baseline)}</b>
                  </span>
                  <span className="text-slate-600">
                    Score <b className={clsx('num', a.score > (s.anomalySource === 'backend' ? 0.7 : 12) ? 'text-rose-700' : 'text-amber-700')}>{a.score.toFixed(s.anomalySource === 'backend' ? 2 : 1)}</b>
                  </span>
                </div>
                <p className="mt-3 text-[10px] font-bold uppercase tracking-wider text-amber-700/90">Possible explanations (unconfirmed)</p>
                <ul className="mt-1 space-y-0.5 text-xs text-slate-700">
                  {a.hypotheses.slice(0, 3).map((h) => (
                    <li key={h}>• {h}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
