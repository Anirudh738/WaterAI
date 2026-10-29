import clsx from 'clsx'
import { BellOff, Check, CheckCheck, RotateCcw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge, Button, EmptyState, PageHeader, Segmented, Skeleton } from '../components/ui'
import { SENSORS } from '../lib/sensors'
import { useStore } from '../lib/store'
import type { AlertState, Severity } from '../lib/types'

const SEV = {
  critical: { tone: 'rose', bar: 'bg-rose-500' },
  warning: { tone: 'amber', bar: 'bg-amber-500' },
  info: { tone: 'cyan', bar: 'bg-sky-500' },
} as const

const PAGE = 20

export default function Alerts() {
  const s = useStore()
  const [state, setState] = useState<AlertState | 'all'>('open')
  const [sev, setSev] = useState<Severity | 'all'>('all')
  const [shown, setShown] = useState(PAGE)

  const counts = useMemo(() => {
    const c = { open: 0, acknowledged: 0, resolved: 0, critical: 0 }
    s.alerts.forEach((a) => {
      c[a.state]++
      if (a.severity === 'critical' && a.state !== 'resolved') c.critical++
    })
    return c
  }, [s.alerts])
  const list = s.alerts.filter((a) => (state === 'all' || a.state === state) && (sev === 'all' || a.severity === sev))

  if (s.loading) return <Skeleton className="h-[600px]" />

  return (
    <div className="fade-up space-y-5">
      <PageHeader
        title="Alerts"
        subtitle={s.mode === 'demo' ? 'Generated from simulated data. Acknowledge / resolve is stored in this browser.' : 'Generated from backend readings. Acknowledge / resolve is stored in this browser.'}
        actions={
          counts.open > 0 && (
            <Button
              variant="ghost"
              icon={CheckCheck}
              onClick={() =>
                s.alerts.filter((a) => a.state === 'open').forEach((a) => s.setAlertState(a.id, 'acknowledged'))
              }
            >
              Acknowledge all open
            </Button>
          )
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['Open', counts.open, 'text-slate-900'],
          ['Critical (unresolved)', counts.critical, 'text-rose-700'],
          ['Acknowledged', counts.acknowledged, 'text-amber-800'],
          ['Resolved', counts.resolved, 'text-emerald-700'],
        ].map(([l, v, c]) => (
          <div key={l as string} className="glass rounded-2xl p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{l}</p>
            <p className={clsx('num mt-1 text-2xl font-semibold', c as string)}>{v}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Segmented
          value={state}
          onChange={(v) => {
            setState(v)
            setShown(PAGE)
          }}
          options={[
            { value: 'open', label: `Open (${counts.open})` },
            { value: 'acknowledged', label: 'Acknowledged' },
            { value: 'resolved', label: 'Resolved' },
            { value: 'all', label: 'All' },
          ]}
        />
        <Segmented value={sev} onChange={setSev} options={[{ value: 'all', label: 'Any severity' }, { value: 'critical', label: 'Critical' }, { value: 'warning', label: 'Warning' }, { value: 'info', label: 'Info' }]} />
      </div>

      {list.length === 0 ? (
        <EmptyState icon={BellOff} title="Nothing here" body="No alerts match these filters." />
      ) : (
        <div className="space-y-3">
          {list.slice(0, shown).map((a) => (
            <article key={a.id} className={clsx('glass relative overflow-hidden rounded-2xl p-4 pl-5 transition', a.state === 'resolved' && 'opacity-60')}>
              <span className={clsx('absolute inset-y-0 left-0 w-1', SEV[a.severity].bar)} />
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={SEV[a.severity].tone}>{a.severity}</Badge>
                    <Badge>{a.sensor in SENSORS ? SENSORS[a.sensor as keyof typeof SENSORS].label : a.sensor}</Badge>
                    <Badge tone="violet">{a.kind}</Badge>
                    {a.state !== 'open' && <Badge tone={a.state === 'resolved' ? 'emerald' : 'slate'}>{a.state}</Badge>}
                    <time className="text-xs text-slate-500">{new Date(a.ts).toLocaleString()}</time>
                  </div>
                  <h3 className="mt-2 text-[15px] font-semibold text-slate-900">{a.title}</h3>
                  <p className="mt-1 text-sm text-slate-700">{a.explanation}</p>
                  <p className="mt-2 rounded-lg bg-emerald-400/5 px-3 py-2 text-xs text-emerald-800/90 ring-1 ring-emerald-400/15">
                    <b className="text-emerald-700">Next step:</b> {a.nextStep}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2 sm:flex-col">
                  {a.state === 'open' && (
                    <Button size="sm" variant="ghost" icon={Check} onClick={() => s.setAlertState(a.id, 'acknowledged')}>
                      Acknowledge
                    </Button>
                  )}
                  {a.state !== 'resolved' && (
                    <Button size="sm" variant="subtle" icon={CheckCheck} onClick={() => s.setAlertState(a.id, 'resolved')}>
                      Resolve
                    </Button>
                  )}
                  {a.state !== 'open' && (
                    <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => s.setAlertState(a.id, 'open')}>
                      Reopen
                    </Button>
                  )}
                </div>
              </div>
            </article>
          ))}
          {list.length > shown && (
            <div className="text-center">
              <Button variant="ghost" onClick={() => setShown((n) => n + PAGE)}>
                Show more ({list.length - shown} left)
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
