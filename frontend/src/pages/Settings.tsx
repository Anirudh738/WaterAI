import clsx from 'clsx'
import { CircleCheck, CircleX, Cpu, FlaskConical, Lock, Power, RefreshCw, Server, SlidersHorizontal } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge, Button, Card, PageHeader, Segmented } from '../components/ui'
import { SCENARIOS, type Scenario } from '../lib/demoData'
import { DEFAULT_THRESHOLDS } from '../lib/sensors'
import { pumpSafetyCheck, useClock, useStore } from '../lib/store'
import type { DataMode, Thresholds } from '../lib/types'

function NumField({ label, value, onChange, step = 0.1, unit }: { label: string; value: number; onChange: (v: number) => void; step?: number; unit?: string }) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium text-slate-600">{label}</span>
      <div className="mt-1 flex items-center rounded-lg bg-white ring-1 ring-sky-900/[0.12] focus-within:ring-sky-400/40">
        <input type="number" step={step} value={Number.isFinite(value) ? value : ''} onChange={(e) => onChange(parseFloat(e.target.value))} className="num w-full min-w-0 bg-transparent px-2.5 py-1.5 text-sm text-slate-900 focus:outline-none" />
        {unit && <span className="pr-2.5 text-xs text-slate-500">{unit}</span>}
      </div>
    </label>
  )
}

function validate(t: Thresholds): string[] {
  const e: string[] = []
  const nums = [t.ph.safeMin, t.ph.safeMax, t.ph.warnMin, t.ph.warnMax, t.tds.safeMax, t.tds.warnMax, t.ntu.safeMax, t.ntu.warnMax, t.temp.warnAbove, t.level.pumpOnBelow, t.level.pumpOffAbove, t.staleAfterSec]
  if (nums.some((n) => !Number.isFinite(n))) e.push('All fields need a number.')
  if (!(t.ph.warnMin <= t.ph.safeMin && t.ph.safeMin < t.ph.safeMax && t.ph.safeMax <= t.ph.warnMax)) e.push('pH must satisfy: unsafe-below ≤ safe-min < safe-max ≤ unsafe-above.')
  if (t.ph.warnMin < 0 || t.ph.warnMax > 14) e.push('pH limits must be within 0–14.')
  if (!(t.tds.safeMax < t.tds.warnMax)) e.push('TDS acceptable limit must be below the unsafe limit.')
  if (t.tds.warnMax > t.tds.probeMax) e.push(`TDS unsafe limit cannot exceed the probe maximum (${t.tds.probeMax} mg/L).`)
  if (!(t.ntu.safeMax < t.ntu.warnMax)) e.push('Turbidity acceptable limit must be below the unsafe limit.')
  if (!(t.level.pumpOnBelow >= 5 && t.level.pumpOnBelow < t.level.pumpOffAbove && t.level.pumpOffAbove <= 98)) e.push('Pump levels must satisfy 5 ≤ on-below < off-above ≤ 98.')
  if (t.staleAfterSec < 15 || t.staleAfterSec > 3600) e.push('Stale timeout must be 15–3600 s.')
  return e
}

export default function Settings() {
  const s = useStore()
  const now = useClock(1000)
  const [draft, setDraft] = useState<Thresholds>(s.thresholds)
  const [apiDraft, setApiDraft] = useState(s.apiBase)
  const [token, setToken] = useState('')
  const [confirm, setConfirm] = useState<boolean | null>(null)
  const [pumpMsg, setPumpMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [saved, setSaved] = useState(false)
  useEffect(() => setDraft(s.thresholds), [s.thresholds])

  const errors = validate(draft)
  const dirty = JSON.stringify(draft) !== JSON.stringify(s.thresholds)
  const set = <G extends keyof Thresholds>(g: G, k: string, v: number) => setDraft((d) => (typeof d[g] === 'object' ? { ...d, [g]: { ...(d[g] as object), [k]: v } } : { ...d, [g]: v }))

  const checkOn = pumpSafetyCheck(true, s.latest, s.screening, s.thresholds)
  const ageSec = s.latest ? Math.round((now - s.latest.ts) / 1000) : null
  const online = ageSec !== null && ageSec <= s.thresholds.staleAfterSec

  const doPump = async (on: boolean) => {
    const r = await s.requestPump(on, token)
    setPumpMsg({ ok: r.ok, text: r.message })
    setConfirm(null)
  }

  return (
    <div className="fade-up space-y-5">
      <PageHeader title="Device settings" subtitle="Device status, calibration, thresholds, data source and pump control." />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Device status" icon={Cpu} action={<Badge tone={online ? 'emerald' : 'rose'}>{online ? 'online' : 'not reporting'}</Badge>}>
          <dl className="space-y-2 text-sm">
            {[
              ['Device ID', s.device.id],
              ['Name', s.device.name],
              ['Firmware', s.device.firmware],
              ['Wi-Fi signal', s.device.rssi !== null ? `${s.device.rssi} dBm` : '—'],
              ['Data source', s.device.source],
              ['Last packet', s.latest ? `${new Date(s.latest.ts).toLocaleTimeString()} (${ageSec}s ago)` : '—'],
              ['Controller', 'ESP32 · 12-bit ADC1 (GPIO 32–39)'],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3">
                <dt className="text-slate-600">{k}</dt>
                <dd className="text-right text-slate-800">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card title="Data source" icon={Server}>
          <Segmented<DataMode> value={s.mode} onChange={s.setMode} options={[{ value: 'demo', label: 'Demo (simulated)' }, { value: 'api', label: 'Real · backend API' }]} />
          <p className="mt-3 text-xs text-slate-600">
            {s.mode === 'demo' ? 'All readings are generated in the browser. Nothing is sent to or read from a device.' : s.health?.demo ? 'Readings come from the FastAPI backend, which is running its own DEMO simulator (DATA_SOURCE=demo). Set DATA_SOURCE=esp32 or firebase for real data.' : 'Readings come from the FastAPI backend, which reads Firebase / the ESP32. Demo data is never mixed in.'}
          </p>
          <label className="mt-4 block">
            <span className="text-[11px] font-medium text-slate-600">Backend URL (blank = same origin, /api)</span>
            <div className="mt-1 flex gap-2">
              <input value={apiDraft} onChange={(e) => setApiDraft(e.target.value)} placeholder="http://localhost:8000" className="min-w-0 flex-1 rounded-lg bg-white px-2.5 py-1.5 text-sm text-slate-900 ring-1 ring-sky-900/[0.12] focus:outline-none focus:ring-sky-400/40" />
              <Button
                size="sm"
                variant="ghost"
                icon={RefreshCw}
                onClick={() => {
                  s.setApiBase(apiDraft)
                  setTimeout(s.checkHealth, 50)
                }}
              >
                Test
              </Button>
            </div>
          </label>
          <div className="mt-3 rounded-lg bg-sky-900/[0.03] px-3 py-2 text-xs ring-1 ring-sky-900/[0.07]">
            {s.health ? (
              <div className="space-y-0.5">
                <p className="flex items-center gap-1.5 font-semibold text-emerald-700">
                  <CircleCheck className="h-3.5 w-3.5" /> Backend reachable (v{s.health.version})
                </p>
                <p className="text-slate-600">Source: {s.health.data_source}{s.health.demo ? ' (demo)' : ''}</p>
                <p className="text-slate-600">LLM: {s.health.llm.configured ? `${s.health.llm.provider} · ${s.health.llm.model}` : 'not configured'}</p>
              </div>
            ) : (
              <p className="flex items-start gap-1.5 text-slate-600">
                <CircleX className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-700" /> {s.healthError ?? 'Not checked yet'}
              </p>
            )}
          </div>
          {s.mode === 'demo' && (
            <label className="mt-4 block">
              <span className="text-[11px] font-medium text-slate-600">Demo scenario</span>
              <select value={s.scenario} onChange={(e) => s.setScenario(e.target.value as Scenario)} className="mt-1 w-full rounded-lg bg-white px-2.5 py-1.5 text-sm text-slate-900 ring-1 ring-sky-900/[0.12] focus:outline-none">
                {SCENARIOS.map((sc) => (
                  <option key={sc.id} value={sc.id}>
                    {sc.label} — {sc.desc}
                  </option>
                ))}
              </select>
            </label>
          )}
        </Card>

        <Card title="Pump control" icon={Power} action={<Badge tone={s.mode === 'demo' ? 'amber' : 'emerald'}>{s.mode === 'demo' ? 'simulated' : 'authorized API'}</Badge>}>
          <div className="flex items-center gap-3">
            <div className={clsx('grid h-14 w-14 place-items-center rounded-2xl ring-1', s.pump ? 'bg-sky-400/15 ring-sky-400/30' : 'bg-sky-900/[0.045] ring-sky-900/[0.12]')}>
              <Power className={clsx('h-6 w-6', s.pump ? 'text-sky-700' : 'text-slate-500')} />
            </div>
            <div>
              <p className="text-lg font-bold text-slate-900">Pump {s.pump ? 'ON' : 'OFF'}</p>
              <p className="text-xs text-slate-600">Fill pump · relay on ESP32</p>
            </div>
          </div>
          <div className="mt-4">
            <Segmented value={s.pumpMode} onChange={s.setPumpMode} options={[{ value: 'auto', label: 'Automatic' }, { value: 'manual', label: 'Manual' }]} />
            <p className="mt-1.5 text-[11px] text-slate-500">
              Auto: ON below {s.thresholds.level.pumpOnBelow}%, OFF above {s.thresholds.level.pumpOffAbove}%, forced OFF when water is Unsafe.
            </p>
          </div>
          {s.mode === 'api' && (
            <label className="mt-3 block">
              <span className="flex items-center gap-1 text-[11px] font-medium text-slate-600">
                <Lock className="h-3 w-3" /> Pump control token (not stored)
              </span>
              <input type="password" value={token} onChange={(e) => setToken(e.target.value)} className="mt-1 w-full rounded-lg bg-white px-2.5 py-1.5 text-sm text-slate-900 ring-1 ring-sky-900/[0.12] focus:outline-none focus:ring-sky-400/40" />
            </label>
          )}
          {s.pumpMode === 'manual' && (
            <div className="mt-3">
              {confirm === null ? (
                <div className="flex gap-2">
                  <Button className="flex-1" size="sm" onClick={() => setConfirm(true)} disabled={s.pump}>
                    Turn ON
                  </Button>
                  <Button className="flex-1" size="sm" variant="ghost" onClick={() => setConfirm(false)} disabled={!s.pump}>
                    Turn OFF
                  </Button>
                </div>
              ) : (
                <div className="rounded-lg bg-amber-400/10 p-3 text-xs ring-1 ring-amber-400/25">
                  <p className="font-semibold text-amber-800">Confirm: switch pump {confirm ? 'ON' : 'OFF'}?</p>
                  {confirm && !checkOn.ok && <p className="mt-1 text-rose-700">{checkOn.reason}</p>}
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" variant={confirm ? 'primary' : 'danger'} onClick={() => doPump(confirm)}>
                      Confirm
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
          {pumpMsg && <p className={clsx('mt-2 text-xs', pumpMsg.ok ? 'text-emerald-700' : 'text-rose-700')}>{pumpMsg.text}</p>}
          <div className="mt-3 space-y-1 text-[11px]">
            <p className="font-semibold uppercase tracking-wider text-slate-500">Safety checks for switching ON</p>
            {[
              ['Tank level known', s.latest?.level !== null && s.latest !== null],
              ['Data fresh', !s.screening.stale],
              [`Level below ${s.thresholds.level.pumpOffAbove}%`, (s.latest?.level ?? 100) < s.thresholds.level.pumpOffAbove],
              ['Water not Unsafe', s.screening.status !== 'unsafe'],
            ].map(([l, ok]) => (
              <p key={l as string} className={clsx('flex items-center gap-1.5', ok ? 'text-emerald-700/90' : 'text-rose-700')}>
                {ok ? <CircleCheck className="h-3 w-3" /> : <CircleX className="h-3 w-3" />} {l}
              </p>
            ))}
            <p className="pt-1 text-slate-500">The AI assistant has no access to pump control.</p>
          </div>
          {s.pumpLog.length > 0 && (
            <ul className="mt-3 max-h-28 space-y-0.5 overflow-y-auto border-t border-sky-900/[0.08] pt-2 text-[11px] text-slate-600">
              {s.pumpLog.map((l) => (
                <li key={l.ts + l.msg}>
                  <span className="num text-slate-500">{new Date(l.ts).toLocaleTimeString()}</span> {l.msg}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card
        title="Thresholds"
        icon={SlidersHorizontal}
        subtitle="Defaults follow BIS IS 10500:2012 and the project decision table. Changes apply instantly to screening, alerts and reports."
        action={
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setDraft(DEFAULT_THRESHOLDS)}>
              Reset to BIS
            </Button>
            <Button
              size="sm"
              disabled={!dirty || errors.length > 0}
              onClick={() => {
                s.setThresholds(draft)
                setSaved(true)
                setTimeout(() => setSaved(false), 2000)
              }}
            >
              {saved ? 'Saved' : 'Save'}
            </Button>
          </div>
        }
      >
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
          <fieldset className="space-y-2">
            <legend className="mb-1 text-xs font-bold text-sky-700">pH</legend>
            <div className="grid grid-cols-2 gap-2">
              <NumField label="Safe min" value={draft.ph.safeMin} onChange={(v) => set('ph', 'safeMin', v)} />
              <NumField label="Safe max" value={draft.ph.safeMax} onChange={(v) => set('ph', 'safeMax', v)} />
              <NumField label="Unsafe below" value={draft.ph.warnMin} onChange={(v) => set('ph', 'warnMin', v)} />
              <NumField label="Unsafe above" value={draft.ph.warnMax} onChange={(v) => set('ph', 'warnMax', v)} />
            </div>
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-xs font-bold text-violet-700">TDS</legend>
            <div className="grid grid-cols-2 gap-2">
              <NumField label="Acceptable ≤" value={draft.tds.safeMax} onChange={(v) => set('tds', 'safeMax', v)} step={10} unit="mg/L" />
              <NumField label="Unsafe ≥" value={draft.tds.warnMax} onChange={(v) => set('tds', 'warnMax', v)} step={10} unit="mg/L" />
            </div>
            <p className="text-[11px] text-slate-500">Probe maximum: {draft.tds.probeMax} mg/L (a maxed reading is treated as Unsafe).</p>
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-xs font-bold text-amber-700">Turbidity</legend>
            <div className="grid grid-cols-2 gap-2">
              <NumField label="Acceptable ≤" value={draft.ntu.safeMax} onChange={(v) => set('ntu', 'safeMax', v)} unit="NTU" />
              <NumField label="Unsafe >" value={draft.ntu.warnMax} onChange={(v) => set('ntu', 'warnMax', v)} unit="NTU" />
            </div>
            <NumField label="Warm-water warning above" value={draft.temp.warnAbove} onChange={(v) => set('temp', 'warnAbove', v)} unit="°C" />
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-xs font-bold text-teal-700">Tank & data</legend>
            <div className="grid grid-cols-2 gap-2">
              <NumField label="Pump ON below" value={draft.level.pumpOnBelow} onChange={(v) => set('level', 'pumpOnBelow', v)} step={1} unit="%" />
              <NumField label="Pump OFF above" value={draft.level.pumpOffAbove} onChange={(v) => set('level', 'pumpOffAbove', v)} step={1} unit="%" />
            </div>
            <NumField label="Data is stale after" value={draft.staleAfterSec} onChange={(v) => setDraft((d) => ({ ...d, staleAfterSec: v }))} step={5} unit="s" />
          </fieldset>
        </div>
        {errors.length > 0 && (
          <ul className="mt-4 space-y-0.5 rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-800 ring-1 ring-rose-400/20">
            {errors.map((e) => (
              <li key={e}>• {e}</li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Calibration" icon={FlaskConical} subtitle={s.mode === 'demo' ? 'Example calibration record (simulated in demo mode).' : 'Reported by the device configuration.'}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {[
            { n: 'pH · SEN0161-V2', d: 'Two-point: 4.00 & 7.00 buffers', last: 12, due: 'Recalibrate every 2–4 weeks; probe life ≈ 6 months' },
            { n: 'TDS · SEN0244', d: 'K-value 0.98 with 707 ppm standard; temp-compensated (25 °C)', last: 12, due: 'Monthly' },
            { n: 'Turbidity · SEN0189', d: 'Voltage→NTU curve from 0 / 1 / 5 / 10 NTU samples', last: 26, due: 'Custom NTU curve; check monthly' },
            { n: 'Temperature · DS18B20', d: 'Factory calibrated, ±0.5 °C; 12-bit', last: null, due: 'No calibration needed' },
            { n: 'Level · JSN-SR04T', d: 'Mounted 30 cm above full level; tank depth 150 cm', last: 40, due: 'Re-measure after any remount (25 cm blind zone)' },
          ].map((c) => (
            <div key={c.n} className="rounded-xl bg-sky-900/[0.03] p-3 ring-1 ring-sky-900/[0.07]">
              <p className="text-sm font-semibold text-slate-900">{c.n}</p>
              <p className="mt-1 text-xs text-slate-600">{c.d}</p>
              <p className="mt-2 text-[11px] text-slate-700">{c.last ? `Last: ${c.last} days ago` : 'Last: n/a'}</p>
              <p className={clsx('text-[11px]', c.last && c.last > 21 && c.n.startsWith('pH') ? 'text-amber-700' : 'text-slate-500')}>{c.due}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
