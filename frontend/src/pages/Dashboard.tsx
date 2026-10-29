import clsx from 'clsx'
import { ArrowRight, Bell, Bot, Brain, Clock, Cpu, Database, ShieldCheck, Sparkles, TrendingDown, TrendingUp, Wifi, WifiOff } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { SensorChart, TankGauge, type RangeKey, RANGE_MS } from '../components/charts'
import { SensorCard } from '../components/SensorCard'
import { Badge, Button, Card, EmptyState, PageHeader, Segmented, Skeleton, StatusPill } from '../components/ui'
import { dataQuality, downsample, sliceRange } from '../lib/analytics'
import { fmtTime, fmtWithUnit, SENSOR_KEYS, SENSORS, STATUS_META, timeAgo } from '../lib/sensors'
import { useClock, useStore } from '../lib/store'
import type { SensorKey } from '../lib/types'

const SEV_TONE = { critical: 'rose', warning: 'amber', info: 'cyan' } as const

export default function Dashboard() {
  const s = useStore()
  const now = useClock(1000)
  const [chartKey, setChartKey] = useState<SensorKey>('tds')
  const [range, setRange] = useState<RangeKey>('24h')

  const sparks = useMemo(() => downsample(sliceRange(s.readings, s.now - 6 * 3600_000), 60), [s.readings, s.now])
  const chartData = useMemo(() => downsample(sliceRange(s.readings, s.now - RANGE_MS[range]), 300), [s.readings, s.now, range])
  const deltas = useMemo(() => {
    const hourAgo = sliceRange(s.readings, s.now - 3600_000)[0]
    return Object.fromEntries(SENSOR_KEYS.map((k) => [k, hourAgo && s.latest && hourAgo[k] !== null && s.latest[k] !== null ? (s.latest[k] as number) - (hourAgo[k] as number) : null]))
  }, [s.readings, s.now, s.latest])
  const dq = useMemo(() => dataQuality(sliceRange(s.readings, s.now - 86400_000), s.now - 86400_000, s.now), [s.readings, s.now])

  if (s.loading) return <DashboardSkeleton />
  if (!s.latest) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <EmptyState title="No readings yet" body={s.error ? 'The backend could not be reached.' : 'Waiting for the first packet from the device.'} action={<Button onClick={() => s.setMode('demo')}>Use demo data</Button>} />
      </>
    )
  }

  const sc = s.screening
  const meta = STATUS_META[sc.status]
  const recent = s.alerts.filter((a) => a.state !== 'resolved').slice(0, 4)
  const anomalies7d = s.anomalies.filter((a) => a.ts > s.now - 7 * 86400_000)
  const ageSec = Math.round((now - s.latest.ts) / 1000)
  const online = ageSec <= s.thresholds.staleAfterSec
  const f = s.forecast

  return (
    <div className="fade-up space-y-5">
      <PageHeader
        title="Water overview"
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {s.device.name} · {s.device.id}
            {s.mode === 'demo' && <Badge tone="amber">Demo mode · simulated data</Badge>}
          </span>
        }
        actions={
          <Link to="/assistant">
            <Button icon={Bot}>Ask AI assistant</Button>
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* overall status */}
        <section className={clsx('glass relative overflow-hidden rounded-2xl p-5 ring-1 lg:col-span-6', meta.ring)}>
          <div className={clsx('pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full blur-3xl', meta.bg)} />
          <div className="relative">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-600">
              <ShieldCheck className="h-4 w-4 text-sky-700" /> Screening status
            </div>
            <div className="mt-3 flex items-center gap-4">
              <div className={clsx('grid h-16 w-16 place-items-center rounded-2xl ring-1', meta.bg, meta.ring)}>
                <span className={clsx('pulse-dot h-3.5 w-3.5 rounded-full', meta.dot, meta.text)} />
              </div>
              <div>
                <p className={clsx('text-4xl font-extrabold tracking-tight', meta.text)}>{meta.label}</p>
                <p className="text-xs text-slate-600">{sc.engine} · evaluated {timeAgo(s.now, now)}</p>
              </div>
            </div>
            <ul className="mt-4 space-y-1.5">
              {sc.reasons.slice(0, 4).map((r) => (
                <li key={r} className="flex gap-2 text-sm text-slate-700">
                  <span className={clsx('mt-2 h-1 w-1 shrink-0 rounded-full', meta.dot)} />
                  {r}
                </li>
              ))}
            </ul>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {([
                ['pH', sc.verdicts.ph.status],
                ['TDS', sc.verdicts.tds.status],
                ['Turbidity', sc.verdicts.ntu.status],
                ['Data fresh', sc.stale ? 'unknown' : 'safe'],
              ] as const).map(([l, st]) => (
                <div key={l} className="flex items-center justify-between rounded-lg bg-sky-900/[0.03] px-2.5 py-2 ring-1 ring-sky-900/[0.07]">
                  <span className="text-xs text-slate-700">{l}</span>
                  <span className={clsx('h-2 w-2 rounded-full', STATUS_META[st].dot)} title={STATUS_META[st].label} />
                </div>
              ))}
            </div>
            <p className="mt-3 rounded-lg bg-sky-900/[0.03] px-3 py-2 text-[11px] leading-relaxed text-slate-600 ring-1 ring-sky-900/[0.07]">
              5-sensor screening only — not a potability certificate. Bacteria, nitrate, fluoride, arsenic and heavy metals are not measured. Confirm with a lab test.
            </p>
          </div>
        </section>

        {/* tank */}
        <Card className="lg:col-span-3" title="Tank" icon={Database}>
          <div className="flex items-center gap-4 lg:flex-col lg:items-stretch">
            <TankGauge level={s.latest.level} pump={s.pump} thresholds={s.thresholds} unknown={sc.stale} />
            <div className="min-w-0 flex-1 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Pump</span>
                <span className={clsx('font-semibold', s.pump ? 'text-sky-700' : 'text-slate-700')}>
                  {s.pump ? 'ON' : 'OFF'} · {s.pumpMode}
                </span>
              </div>
              <div className="flex items-start justify-between gap-2">
                <span className="shrink-0 text-slate-600">Forecast</span>
                <span className="text-right font-medium text-slate-800">{f.etaLabel ? f.etaLabel.replace(/^Reaches /, '→ ') : 'Not available'}</span>
              </div>
              {!f.reliable && <p className="text-[11px] text-amber-700/90">{f.qualityNote}</p>}
            </div>
          </div>
        </Card>

        {/* device */}
        <Card className="lg:col-span-3" title="Device" icon={Cpu}>
          <div className="space-y-3 text-xs">
            <Row label="Connectivity">
              <span className={clsx('flex items-center gap-1.5 font-semibold', online ? 'text-emerald-700' : 'text-rose-700')}>
                {online ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
                {online ? 'Online' : 'Not reporting'}
              </span>
            </Row>
            <Row label="Last updated">
              <span className="num text-slate-800">{new Date(s.latest.ts).toLocaleTimeString()}</span>
            </Row>
            <Row label="Age">
              <span className={clsx('num', online ? 'text-slate-800' : 'text-rose-700')}>{ageSec}s</span>
            </Row>
            <Row label="Signal">
              <span className="num text-slate-800">{s.device.rssi !== null ? `${s.device.rssi} dBm` : '—'}</span>
            </Row>
            <Row label="Source">
              <span className="text-right text-slate-800">{s.device.source}</span>
            </Row>
            <Row label="24h coverage">
              <span className={clsx('num', dq.coveragePct < 95 ? 'text-amber-700' : 'text-slate-800')}>{dq.coveragePct.toFixed(1)}%</span>
            </Row>
          </div>
        </Card>
      </div>

      {/* sensors */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {SENSOR_KEYS.map((k) => (
          <SensorCard key={k} k={k} verdict={sc.verdicts[k]} spark={sparks} stale={sc.stale} delta={deltas[k]} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card
          className="xl:col-span-2"
          title="History"
          icon={Clock}
          subtitle="Dashed lines are the configured limits. Breaks in the line = no data."
          action={<Segmented value={range} onChange={setRange} options={[{ value: '24h', label: '24h' }, { value: '7d', label: '7d' }, { value: '30d', label: '30d' }]} />}
        >
          <div className="mb-3 flex flex-wrap gap-1.5">
            {SENSOR_KEYS.map((k) => (
              <button key={k} onClick={() => setChartKey(k)} className={clsx('rounded-lg px-2.5 py-1 text-xs font-semibold ring-1 transition', chartKey === k ? 'bg-sky-900/[0.07] text-slate-900 ring-sky-900/[0.2]' : 'text-slate-600 ring-sky-900/[0.07] hover:text-slate-800')}>
                <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: SENSORS[k].color }} />
                {SENSORS[k].label}
              </button>
            ))}
          </div>
          <SensorChart k={chartKey} data={chartData} thresholds={s.thresholds} range={range} height={330} />
        </Card>

        <Card title="Recent alerts" icon={Bell} action={<Link to="/alerts" className="flex items-center gap-1 text-xs font-semibold text-sky-700 hover:text-sky-800">View all <ArrowRight className="h-3 w-3" /></Link>}>
          {recent.length === 0 ? (
            <EmptyState title="No open alerts" body="Everything has been acknowledged or resolved." />
          ) : (
            <ul className="space-y-2">
              {recent.map((a) => (
                <li key={a.id} className="rounded-xl bg-sky-900/[0.03] p-3 ring-1 ring-sky-900/[0.07]">
                  <div className="flex items-center gap-2">
                    <Badge tone={SEV_TONE[a.severity]}>{a.severity}</Badge>
                    {a.state === 'acknowledged' && <Badge>ack</Badge>}
                    <span className="ml-auto text-[11px] text-slate-500">{timeAgo(a.ts, now)}</span>
                  </div>
                  <p className="mt-1.5 text-sm font-semibold text-slate-900">{a.title}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-slate-600">{a.explanation}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* AI insight cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <InsightCard icon={Brain} label="Quality screening" model="Rule engine · Random Forest not trained yet" tone={sc.status}>
          {sc.status === 'safe' ? 'All three quality sensors are inside the acceptable band.' : sc.reasons[0]}
        </InsightCard>
        <InsightCard icon={f.trend === 'filling' ? TrendingUp : TrendingDown} label="Tank forecast" model="Linear regression · last 30 min" badge={<Badge tone={f.reliable ? 'emerald' : 'amber'}>{f.reliable ? `R² ${f.r2?.toFixed(2)}` : 'low confidence'}</Badge>}>
          {f.etaLabel ?? `Unavailable — ${f.qualityNote}`}
          {f.etaLabel && !f.reliable && <span className="mt-1 block text-amber-700/90">Low confidence: {f.qualityNote}</span>}
        </InsightCard>
        <InsightCard icon={Sparkles} label="Anomalies (7 days)" model={s.anomalySource === 'backend' ? 'Isolation Forest · backend' : 'Statistical detector · Isolation Forest in backend'} badge={<Badge tone={anomalies7d.length ? 'amber' : 'emerald'}>{anomalies7d.length} flagged</Badge>}>
          {anomalies7d.length === 0 ? (
            'No sudden changes flagged this week.'
          ) : (
            <>
              {anomalies7d.length} flagged. Latest: {SENSORS[anomalies7d[0].sensor].label} {fmtWithUnit(anomalies7d[0].sensor, anomalies7d[0].value)} at {fmtTime(anomalies7d[0].ts)}.{' '}
              <Link to="/insights" className="font-semibold text-sky-700 hover:underline">
                Details
              </Link>
            </>
          )}
        </InsightCard>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-slate-600">{label}</span>
      {children}
    </div>
  )
}

function InsightCard({ icon: Icon, label, model, children, tone, badge }: { icon: typeof Brain; label: string; model: string; children: React.ReactNode; tone?: keyof typeof STATUS_META; badge?: React.ReactNode }) {
  return (
    <div className="glass rounded-2xl p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-600">
          <Icon className="h-4 w-4 text-sky-700" /> {label}
        </span>
        {badge ?? (tone && <StatusPill status={tone} />)}
      </div>
      <p className="mt-3 text-sm leading-relaxed text-slate-800">{children}</p>
      <p className="mt-3 text-[10px] font-medium uppercase tracking-wider text-slate-500">{model}</p>
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-8 w-56" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Skeleton className="h-64 lg:col-span-6" />
        <Skeleton className="h-64 lg:col-span-3" />
        <Skeleton className="h-64 lg:col-span-3" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-40" />
        ))}
      </div>
      <Skeleton className="h-80" />
    </div>
  )
}
