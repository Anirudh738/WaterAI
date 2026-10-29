import clsx from 'clsx'
import { AlertTriangle, Radio } from 'lucide-react'
import { useMemo, useState } from 'react'
import { RANGE_MS, SensorChart, type RangeKey } from '../components/charts'
import { SENSOR_ICON } from '../components/SensorCard'
import { Badge, Card, EmptyState, PageHeader, Segmented, Skeleton, StatusPill } from '../components/ui'
import { dataQuality, downsample, humanMins, sliceRange, stats } from '../lib/analytics'
import { SCENARIOS, type Scenario } from '../lib/demoData'
import { fmt, fmtTime, SENSOR_KEYS, SENSORS } from '../lib/sensors'
import { useClock, useStore } from '../lib/store'

export default function Live() {
  const s = useStore()
  const now = useClock(1000)
  const [range, setRange] = useState<RangeKey>('1h')
  const slice = useMemo(() => sliceRange(s.readings, s.now - RANGE_MS[range]), [s.readings, s.now, range])
  const data = useMemo(() => downsample(slice, range === '1h' ? 720 : 360), [slice, range])
  const dq = useMemo(() => dataQuality(slice, s.now - RANGE_MS[range], s.now), [slice, s.now, range])
  const ageSec = s.latest ? Math.round((now - s.latest.ts) / 1000) : null
  const stale = ageSec === null || ageSec > s.thresholds.staleAfterSec

  if (s.loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-72" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="fade-up space-y-5">
      <PageHeader
        title="Live monitoring"
        subtitle={s.mode === 'demo' ? 'Simulated readings update every 5 s in demo mode (the real device sends every 10 s).' : 'Polling the backend every 10 s.'}
        actions={<Segmented value={range} onChange={setRange} options={(['1h', '24h', '7d', '30d'] as RangeKey[]).map((r) => ({ value: r, label: r }))} />}
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className={clsx('glass flex items-center gap-3 rounded-2xl p-4 ring-1', stale ? 'ring-rose-400/30' : 'ring-emerald-400/20')}>
          <Radio className={clsx('h-5 w-5', stale ? 'text-rose-700' : 'text-emerald-700')} />
          <div>
            <p className="text-sm font-semibold text-slate-900">{stale ? 'Data is stale' : 'Receiving data'}</p>
            <p className="text-xs text-slate-600">{s.latest ? `Last packet ${ageSec}s ago · stale after ${s.thresholds.staleAfterSec}s` : 'No packets yet'}</p>
          </div>
          {!stale && <span className="pulse-dot ml-auto h-2.5 w-2.5 rounded-full bg-emerald-500 text-emerald-600" />}
        </div>
        <div className="glass flex items-center gap-3 rounded-2xl p-4">
          <AlertTriangle className={clsx('h-5 w-5', dq.gaps.length ? 'text-amber-700' : 'text-slate-500')} />
          <div>
            <p className="text-sm font-semibold text-slate-900">
              {dq.gaps.length} gap{dq.gaps.length === 1 ? '' : 's'} in {range} · {dq.coveragePct.toFixed(1)}% coverage
            </p>
            <p className="text-xs text-slate-600">{dq.gaps.length ? `Longest: ${humanMins(Math.max(...dq.gaps.map((g) => g.minutes)))} from ${fmtTime(dq.gaps.reduce((a, b) => (b.minutes > a.minutes ? b : a)).from)}` : 'No gaps longer than 5 min'}</p>
          </div>
        </div>
        {s.mode === 'demo' ? (
          <div className="glass rounded-2xl p-4">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Demo scenario</label>
            <select value={s.scenario} onChange={(e) => s.setScenario(e.target.value as Scenario)} className="mt-1 w-full rounded-lg bg-white px-2 py-1.5 text-sm text-slate-900 ring-1 ring-sky-900/[0.12] focus:outline-none focus:ring-sky-400/40">
              {SCENARIOS.map((sc) => (
                <option key={sc.id} value={sc.id}>
                  {sc.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-slate-500">{SCENARIOS.find((x) => x.id === s.scenario)?.desc}</p>
          </div>
        ) : (
          <div className="glass rounded-2xl p-4 text-xs text-slate-600">
            <p className="text-sm font-semibold text-slate-900">{s.device.source}</p>
            Readings come from the backend. Invalid values are rejected and shown as gaps.
          </div>
        )}
      </div>

      {slice.length === 0 ? (
        <EmptyState title={`No readings in the last ${range}`} body="The device has not reported in this window. Try a longer range." />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {SENSOR_KEYS.map((k) => {
            const st = stats(slice, k)
            const Icon = SENSOR_ICON[k]
            const missing = dq.missing[k]
            return (
              <Card
                key={k}
                className={k === 'level' ? 'lg:col-span-2' : undefined}
                title={
                  <span className="flex items-center gap-2">
                    <Icon className="h-4 w-4" style={{ color: SENSORS[k].color }} />
                    {SENSORS[k].label}
                    {SENSORS[k].unit && <span className="font-normal text-slate-500">({SENSORS[k].unit})</span>}
                  </span>
                }
                action={
                  <div className="flex items-center gap-2">
                    {missing > 0 && <Badge tone="amber">{missing} missing</Badge>}
                    <StatusPill status={s.screening.verdicts[k].status} />
                  </div>
                }
              >
                <div className="mb-2 grid grid-cols-4 gap-2 text-xs">
                  {[
                    ['Now', s.latest?.[k] ?? null],
                    ['Min', st.min],
                    ['Avg', st.mean],
                    ['Max', st.max],
                  ].map(([l, v]) => (
                    <div key={l as string} className="rounded-lg bg-sky-900/[0.03] px-2 py-1.5 ring-1 ring-sky-900/[0.07]">
                      <p className="text-[10px] uppercase tracking-wider text-slate-500">{l}</p>
                      <p className={clsx('num font-semibold', l === 'Now' && stale ? 'text-slate-500' : 'text-slate-900')}>{fmt(k, v as number | null)}</p>
                    </div>
                  ))}
                </div>
                <SensorChart k={k} data={data} thresholds={s.thresholds} range={range} height={k === 'level' ? 200 : 210} />
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
