import { Download, FileSpreadsheet, Printer } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge, Button, Card, PageHeader, Segmented, Skeleton } from '../components/ui'
import { dataQuality, humanMins, sliceRange, stats } from '../lib/analytics'
import { screen } from '../lib/screening'
import { fmt, SENSOR_KEYS, SENSORS, STATUS_META } from '../lib/sensors'
import { useStore } from '../lib/store'
import type { Reading, Status } from '../lib/types'

type Period = '24h' | '7d' | '30d'
type Res = 'raw' | '15m' | '1h'
const PERIOD_MS: Record<Period, number> = { '24h': 86400_000, '7d': 7 * 86400_000, '30d': 30 * 86400_000 }
const RES_MS: Record<Res, number> = { raw: 0, '15m': 15 * 60_000, '1h': 3600_000 }

function aggregate(rs: Reading[], ms: number): Reading[] {
  if (!ms) return rs
  const out: Reading[] = []
  let bucket: Reading[] = []
  let start = rs[0]?.ts ?? 0
  const flush = () => {
    if (!bucket.length) return
    const avg = (k: keyof Reading) => {
      const v = bucket.map((r) => r[k]).filter((x): x is number => typeof x === 'number')
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
    }
    out.push({ ts: start, ph: avg('ph'), tds: avg('tds'), ntu: avg('ntu'), temp: avg('temp'), level: avg('level'), pump: bucket.some((r) => r.pump) })
  }
  for (const r of rs) {
    if (r.ts >= start + ms) {
      flush()
      bucket = []
      start = r.ts - ((r.ts - start) % ms)
    }
    bucket.push(r)
  }
  flush()
  return out
}

function download(name: string, text: string) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function Reports() {
  const s = useStore()
  const [period, setPeriod] = useState<Period>('7d')
  const [res, setRes] = useState<Res>('15m')
  const slice = useMemo(() => sliceRange(s.readings, s.now - PERIOD_MS[period]), [s.readings, s.now, period])
  const rows = useMemo(() => aggregate(slice, RES_MS[res]), [slice, res])
  const summary = useMemo(() => {
    const counts: Record<Status, number> = { safe: 0, warning: 0, unsafe: 0, unknown: 0 }
    // historical rows are evaluated at their own timestamp (not "stale" by today's clock)
    slice.forEach((r) => counts[screen(r, s.thresholds, r.ts).status]++)
    const dq = dataQuality(slice, s.now - PERIOD_MS[period], s.now)
    const alerts = s.alerts.filter((a) => a.ts >= s.now - PERIOD_MS[period])
    const anomalies = s.anomalies.filter((a) => a.ts >= s.now - PERIOD_MS[period])
    return { counts, dq, alerts, anomalies }
  }, [slice, s.thresholds, s.now, period, s.alerts, s.anomalies])

  if (s.loading) return <Skeleton className="h-[600px]" />

  const source = s.mode === 'demo' ? 'DEMO-SIMULATED' : s.health?.demo !== false ? 'BACKEND-DEMO-SIMULATED' : 'DEVICE'
  const csv = () => {
    const head = 'timestamp_iso,ph,tds_mg_per_l,turbidity_ntu,temperature_c,tank_level_pct,pump_on,screening_status,data_source'
    const lines = rows.map((r) => {
      const st = screen(r, s.thresholds, r.ts).status
      const v = (x: number | null, d: number) => (x === null ? '' : x.toFixed(d))
      return [new Date(r.ts).toISOString(), v(r.ph, 2), v(r.tds, 0), v(r.ntu, 2), v(r.temp, 1), v(r.level, 1), r.pump ? 1 : 0, st, source].join(',')
    })
    download(`wateriq_${s.device.id}_${period}_${res}_${new Date().toISOString().slice(0, 10)}.csv`, [head, ...lines].join('\n'))
  }
  const alertsCsv = () => {
    const esc = (t: string) => `"${t.replace(/"/g, '""')}"`
    const head = 'timestamp_iso,severity,sensor,kind,state,title,explanation,next_step,data_source'
    const lines = summary.alerts.map((a) => [new Date(a.ts).toISOString(), a.severity, a.sensor, a.kind, a.state, esc(a.title), esc(a.explanation), esc(a.nextStep), source].join(','))
    download(`wateriq_alerts_${period}.csv`, [head, ...lines].join('\n'))
  }

  const total = slice.length || 1

  return (
    <div className="fade-up space-y-5">
      <PageHeader
        title="Reports"
        subtitle={__PREVIEW__ ? 'Summary report for the selected period.' : 'Export readings as CSV or print a summary report (use “Save as PDF” in the print dialog).'}
        actions={
          <>
            <Segmented value={period} onChange={setPeriod} options={[{ value: '24h', label: '24h' }, { value: '7d', label: '7 days' }, { value: '30d', label: '30 days' }]} />
          </>
        }
      />

      {__PREVIEW__ ? (
        <div className="no-print rounded-2xl bg-amber-400/10 p-4 text-sm text-amber-800 ring-1 ring-amber-400/30">
          Downloads and printing are turned off in this online preview. Run the app on your computer (<code className="font-mono">./start.sh</code>) to download readings and alerts as CSV and to print or save the report as PDF. The report summary below is the same.
        </div>
      ) : (
        <div className="no-print grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card title="Readings CSV" icon={FileSpreadsheet} subtitle={`${rows.length.toLocaleString()} rows · ${slice.length.toLocaleString()} raw readings`}>
            <Segmented value={res} onChange={setRes} options={[{ value: 'raw', label: 'Raw' }, { value: '15m', label: '15-min avg' }, { value: '1h', label: 'Hourly avg' }]} />
            <Button className="mt-4 w-full" icon={Download} onClick={csv} disabled={rows.length === 0}>
              Download CSV
            </Button>
          </Card>
          <Card title="Alerts CSV" icon={FileSpreadsheet} subtitle={`${summary.alerts.length} alerts in period`}>
            <p className="text-xs text-slate-600">Severity, sensor, explanation, next step and acknowledgement state.</p>
            <Button className="mt-4 w-full" variant="ghost" icon={Download} onClick={alertsCsv} disabled={summary.alerts.length === 0}>
              Download alerts
            </Button>
          </Card>
          <Card title="Printable report" icon={Printer} subtitle="A4-friendly summary below">
            <p className="text-xs text-slate-600">Opens your browser’s print dialog. Choose “Save as PDF” to get a PDF.</p>
            <Button className="mt-4 w-full" variant="ghost" icon={Printer} onClick={() => window.print()}>
              Print / Save PDF
            </Button>
          </Card>
        </div>
      )}

      <section className="print-area glass rounded-2xl p-6">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-sky-900/[0.12] pb-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-sky-700">WaterIQ AI · Water screening report</p>
            <h2 className="mt-1 text-xl font-bold text-slate-900">{s.device.name}</h2>
            <p className="text-sm text-slate-600">
              Device {s.device.id} · {new Date(s.now - PERIOD_MS[period]).toLocaleString()} → {new Date(s.now).toLocaleString()}
            </p>
          </div>
          <div className="text-right text-xs text-slate-600">
            <p>Generated {new Date().toLocaleString()}</p>
            {s.mode === 'demo' && <Badge tone="amber" className="mt-1">Simulated demo data</Badge>}
          </div>
        </div>

        <h3 className="mt-5 text-sm font-bold text-slate-900">1. Screening outcome (share of readings)</h3>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(['safe', 'warning', 'unsafe', 'unknown'] as Status[]).map((st) => (
            <div key={st} className="rounded-xl bg-sky-900/[0.03] p-3 ring-1 ring-sky-900/[0.07]">
              <p className={`text-xs font-semibold ${STATUS_META[st].text}`}>{STATUS_META[st].label}</p>
              <p className="num text-xl font-semibold text-slate-900">{((summary.counts[st] / total) * 100).toFixed(1)}%</p>
              <p className="text-[11px] text-slate-500">{summary.counts[st].toLocaleString()} readings</p>
            </div>
          ))}
        </div>

        <h3 className="mt-6 text-sm font-bold text-slate-900">2. Sensor summary</h3>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-sky-900/[0.12] text-left text-[11px] uppercase tracking-wider text-slate-500">
                <th className="py-2 pr-3">Parameter</th>
                <th className="py-2 pr-3">Min</th>
                <th className="py-2 pr-3">Avg</th>
                <th className="py-2 pr-3">Max</th>
                <th className="py-2 pr-3">Missing</th>
                <th className="py-2">Acceptable limit</th>
              </tr>
            </thead>
            <tbody>
              {SENSOR_KEYS.map((k) => {
                const st = stats(slice, k)
                const lim = { ph: `${s.thresholds.ph.warnMin} – ${s.thresholds.ph.warnMax}`, tds: `≤ ${s.thresholds.tds.safeMax} mg/L`, ntu: `≤ ${s.thresholds.ntu.safeMax} NTU`, temp: 'No BIS limit', level: 'Operational only' }[k]
                return (
                  <tr key={k} className="border-b border-sky-900/[0.08] text-slate-800">
                    <td className="py-2 pr-3 font-medium">
                      {SENSORS[k].label} {SENSORS[k].unit && <span className="text-slate-500">({SENSORS[k].unit})</span>}
                    </td>
                    <td className="num py-2 pr-3">{fmt(k, st.min)}</td>
                    <td className="num py-2 pr-3">{fmt(k, st.mean)}</td>
                    <td className="num py-2 pr-3">{fmt(k, st.max)}</td>
                    <td className="num py-2 pr-3">{summary.dq.missing[k]}</td>
                    <td className="py-2 text-slate-600">{lim}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <h3 className="mt-6 text-sm font-bold text-slate-900">3. Events</h3>
        <ul className="mt-2 space-y-1 text-sm text-slate-700">
          <li>
            {summary.alerts.length} alerts ({summary.alerts.filter((a) => a.severity === 'critical').length} critical, {summary.alerts.filter((a) => a.state === 'resolved').length} resolved)
          </li>
          <li>{summary.anomalies.length} sudden changes flagged by the anomaly detector</li>
          <li>
            Data coverage {summary.dq.coveragePct.toFixed(1)}%, {summary.dq.gaps.length} gap(s) longer than 5 min
            {summary.dq.gaps.length > 0 && ` (longest ${humanMins(Math.max(...summary.dq.gaps.map((g) => g.minutes)))})`}
          </li>
        </ul>
        {summary.alerts.filter((a) => a.severity !== 'info').length > 0 && (
          <ul className="mt-3 space-y-1 text-xs text-slate-600">
            {summary.alerts
              .filter((a) => a.severity !== 'info')
              .slice(0, 8)
              .map((a) => (
                <li key={a.id}>
                  {new Date(a.ts).toLocaleString()} — [{a.severity}] {a.title}
                </li>
              ))}
          </ul>
        )}

        <h3 className="mt-6 text-sm font-bold text-slate-900">4. Limitations</h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-600">
          Screening uses five sensors (pH, TDS, turbidity, temperature, level) against BIS IS 10500:2012 limits. It does not detect bacteria, nitrate, fluoride, arsenic or heavy metals and is not a certificate of potability. The TDS probe saturates at
          1,000 mg/L. Periods with missing or stale data are reported as Unknown. Confirm any Warning or Unsafe result with an accredited lab test.
        </p>
      </section>
    </div>
  )
}
