import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { deriveAlerts, detectAnomalies, forecastTank, sliceRange } from './analytics'
import { api, DEMO_DEVICE, type Health } from './dataService'
import { generateHistory, mulberry32, nextLiveReading, type LiveState, type Scenario } from './demoData'
import { ruleEngine } from './models'
import { DEFAULT_THRESHOLDS } from './sensors'
import type { AlertItem, AlertState, Anomaly, DataMode, DeviceInfo, Forecast, Reading, Screening, Thresholds } from './types'

const DEMO_TICK_MS = 5000
const API_POLL_MS = 10000
const KEEP_MS = 31 * 24 * 3600 * 1000

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`wateriq:${key}`)
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback
  } catch {
    return fallback
  }
}
function loadScalar<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`wateriq:${key}`)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}
function save(key: string, v: unknown) {
  try {
    localStorage.setItem(`wateriq:${key}`, JSON.stringify(v))
  } catch {
    /* storage unavailable — settings just won't persist */
  }
}

export type PumpMode = 'auto' | 'manual'

interface Store {
  mode: DataMode
  setMode: (m: DataMode) => void
  apiBase: string
  setApiBase: (s: string) => void
  loading: boolean
  error: string | null
  retry: () => void
  readings: Reading[]
  latest: Reading | null
  now: number
  screening: Screening
  thresholds: Thresholds
  setThresholds: (t: Thresholds) => void
  resetThresholds: () => void
  anomalies: Anomaly[]
  /** 'backend' = scikit-learn Isolation Forest results from the API; 'browser' = in-browser statistical stand-in */
  anomalySource: 'browser' | 'backend'
  alerts: (AlertItem & { state: AlertState })[]
  setAlertState: (id: string, s: AlertState) => void
  forecast: Forecast
  scenario: Scenario
  setScenario: (s: Scenario) => void
  pump: boolean
  pumpMode: PumpMode
  setPumpMode: (m: PumpMode) => void
  requestPump: (on: boolean, token?: string) => Promise<{ ok: boolean; message: string }>
  pumpLog: { ts: number; msg: string }[]
  device: DeviceInfo
  health: Health | null
  healthError: string | null
  checkHealth: () => void
}

const Ctx = createContext<Store | null>(null)

export function useStore() {
  const s = useContext(Ctx)
  if (!s) throw new Error('useStore outside provider')
  return s
}

export function pumpSafetyCheck(on: boolean, latest: Reading | null, screening: Screening, t: Thresholds): { ok: boolean; reason: string } {
  if (!on) return { ok: true, reason: 'Turning the pump OFF is always allowed.' }
  if (!latest || latest.level === null) return { ok: false, reason: 'Blocked: tank level is unknown, so the pump could overflow the tank.' }
  if (screening.stale) return { ok: false, reason: 'Blocked: device data is stale. Cannot confirm tank level.' }
  if (latest.level >= t.level.pumpOffAbove) return { ok: false, reason: `Blocked: tank already at ${latest.level.toFixed(0)}% (≥ ${t.level.pumpOffAbove}%).` }
  if (screening.status === 'unsafe') return { ok: false, reason: 'Blocked: water screening is UNSAFE. Filling is interlocked until readings recover.' }
  return { ok: true, reason: 'Safety checks passed.' }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  // No saved choice yet → ask the backend; if it answers, use it, otherwise fall back to the in-browser demo.
  const [savedMode] = useState(() => loadScalar<DataMode | null>('dataMode', null))
  const [mode, setModeState] = useState<DataMode>(savedMode ?? 'demo')
  const [modeResolved, setModeResolved] = useState(savedMode !== null || __PREVIEW__)
  const [apiBase, setApiBaseState] = useState<string>(() => loadScalar('apiBase', ''))
  const [readings, setReadings] = useState<Reading[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [thresholds, setThresholdsState] = useState<Thresholds>(() => {
    const t = load('thresholds', DEFAULT_THRESHOLDS)
    return { ...DEFAULT_THRESHOLDS, ...t, ph: { ...DEFAULT_THRESHOLDS.ph, ...t.ph }, tds: { ...DEFAULT_THRESHOLDS.tds, ...t.tds }, ntu: { ...DEFAULT_THRESHOLDS.ntu, ...t.ntu }, temp: { ...DEFAULT_THRESHOLDS.temp, ...t.temp }, level: { ...DEFAULT_THRESHOLDS.level, ...t.level } }
  })
  const [alertStates, setAlertStates] = useState<Record<string, AlertState>>(() => load('alertStates', {}))
  const [scenario, setScenarioState] = useState<Scenario>('normal')
  const scenarioSince = useRef(Date.now())
  const [pump, setPump] = useState(false)
  const [pumpMode, setPumpModeState] = useState<PumpMode>(() => loadScalar<PumpMode>('pumpMode', 'auto'))
  const [pumpLog, setPumpLog] = useState<{ ts: number; msg: string }[]>([])
  const [device, setDevice] = useState<DeviceInfo>(DEMO_DEVICE)
  const [health, setHealth] = useState<Health | null>(null)
  const [healthError, setHealthError] = useState<string | null>(null)
  const [backendAnomalies, setBackendAnomalies] = useState<Anomaly[] | null>(null)

  const live = useRef<LiveState>({ level: 50, pump: false })
  const lastTs = useRef<number | null>(null)
  const rng = useRef(mulberry32(7))
  const thresholdsRef = useRef(thresholds)
  thresholdsRef.current = thresholds
  const pumpModeRef = useRef(pumpMode)
  pumpModeRef.current = pumpMode
  const scenarioRef = useRef(scenario)
  scenarioRef.current = scenario

  const logPump = useCallback((msg: string) => setPumpLog((l) => [{ ts: Date.now(), msg }, ...l].slice(0, 30)), [])

  const setMode = (m: DataMode) => {
    save('dataMode', m)
    setModeResolved(true)
    setModeState(m)
  }
  const setApiBase = (s: string) => {
    save('apiBase', s)
    setApiBaseState(s)
  }
  const setThresholds = (t: Thresholds) => {
    save('thresholds', t)
    setThresholdsState(t)
  }
  const resetThresholds = () => setThresholds(DEFAULT_THRESHOLDS)
  const setAlertState = (id: string, s: AlertState) =>
    setAlertStates((prev) => {
      const next = { ...prev, [id]: s }
      save('alertStates', next)
      return next
    })
  const setScenario = (s: Scenario) => {
    scenarioSince.current = Date.now()
    setScenarioState(s)
  }
  const setPumpMode = (m: PumpMode) => {
    save('pumpMode', m)
    setPumpModeState(m)
    logPump(`Pump mode set to ${m.toUpperCase()}`)
  }

  // ---------- pick data mode on first visit
  useEffect(() => {
    if (modeResolved) return
    let cancelled = false
    api
      .health(apiBase)
      .then((h) => {
        if (!cancelled && h.ok) setModeState('api')
      })
      .catch(() => {})
      .finally(() => !cancelled && setModeResolved(true))
    return () => {
      cancelled = true
    }
  }, [modeResolved, apiBase])

  // ---------- initial load
  useEffect(() => {
    if (!modeResolved) return
    let cancelled = false
    setLoading(true)
    setError(null)
    if (mode === 'demo') {
      const t = setTimeout(() => {
        if (cancelled) return
        const h = generateHistory(Date.now())
        live.current = { level: h.level, pump: h.pump }
        lastTs.current = h.readings[h.readings.length - 1]?.ts ?? null
        setPump(h.pump)
        setReadings(h.readings)
        setDevice(DEMO_DEVICE)
        setNow(Date.now())
        setLoading(false)
      }, 350)
      return () => {
        cancelled = true
        clearTimeout(t)
      }
    }
    Promise.all([api.history(apiBase, '30d'), api.device(apiBase).catch(() => null)])
      .then(([rs, dev]) => {
        if (cancelled) return
        setReadings(rs)
        if (dev) setDevice(dev)
        const last = rs[rs.length - 1]
        setPump(Boolean(last?.pump))
        setNow(Date.now())
        setLoading(false)
      })
      .catch((e: Error) => {
        if (cancelled) return
        setReadings([])
        setError(e.message)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [mode, apiBase, reloadKey, modeResolved])

  // ---------- live updates
  useEffect(() => {
    if (loading || error) return
    if (mode === 'demo') {
      const id = setInterval(() => {
        const ts = Date.now()
        setNow(ts)
        if (scenarioRef.current === 'offline') return
        const dt = lastTs.current ? Math.min(60, (ts - lastTs.current) / 1000) : 5
        lastTs.current = ts
        const r = nextLiveReading(ts, dt, live.current, scenarioRef.current, scenarioSince.current, rng.current)
        // automatic pump logic + safety interlock (simulated relay)
        const t = thresholdsRef.current
        const s = ruleEngine.classify(r, t, ts)
        if (live.current.pump && s.status === 'unsafe') {
          live.current.pump = false
          logPump('Interlock: pump OFF because water screening is UNSAFE')
        } else if (pumpModeRef.current === 'auto' && r.level !== null) {
          if (!live.current.pump && r.level < t.level.pumpOnBelow && s.status !== 'unsafe') {
            live.current.pump = true
            logPump(`Auto: pump ON (level ${r.level.toFixed(0)}% < ${t.level.pumpOnBelow}%)`)
          } else if (live.current.pump && r.level > t.level.pumpOffAbove) {
            live.current.pump = false
            logPump(`Auto: pump OFF (level ${r.level.toFixed(0)}% > ${t.level.pumpOffAbove}%)`)
          }
        }
        r.pump = live.current.pump
        setPump(live.current.pump)
        setReadings((prev) => {
          const next = prev.length > 0 && prev[0].ts < ts - KEEP_MS ? prev.slice(1) : prev.slice()
          next.push(r)
          return next
        })
      }, DEMO_TICK_MS)
      return () => clearInterval(id)
    }
    const id = setInterval(async () => {
      setNow(Date.now())
      try {
        const r = await api.latest(apiBase)
        if (!r) return
        setReadings((prev) => {
          const last = prev[prev.length - 1]
          if (last && r.ts <= last.ts) return prev
          return [...prev, r]
        })
        if (typeof r.pump === 'boolean') setPump(r.pump)
      } catch {
        /* a failed poll is shown via staleness; no crash */
      }
    }, API_POLL_MS)
    return () => clearInterval(id)
  }, [mode, apiBase, loading, error, logPump])

  // ---------- backend Isolation Forest (API mode only; falls back to the browser detector if unavailable)
  useEffect(() => {
    if (mode !== 'api' || loading || error) {
      setBackendAnomalies(null)
      return
    }
    let cancelled = false
    const load = () =>
      api
        .anomalies(apiBase)
        .then((a) => !cancelled && setBackendAnomalies(a))
        .catch(() => !cancelled && setBackendAnomalies(null))
    load()
    const id = setInterval(load, 60000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [mode, apiBase, loading, error])

  // ---------- backend health (for LLM availability + real mode)
  const checkHealth = useCallback(() => {
    if (__PREVIEW__) {
      setHealthError('Online preview: there is no backend here. Run the app on your computer to connect one.')
      return
    }
    api
      .health(apiBase)
      .then((h) => {
        setHealth(h)
        setHealthError(null)
      })
      .catch((e: Error) => {
        setHealth(null)
        setHealthError(e.message)
      })
  }, [apiBase])
  useEffect(() => {
    checkHealth()
    const id = setInterval(checkHealth, 30000)
    return () => clearInterval(id)
  }, [checkHealth])

  // ---------- derived
  const latest = readings.length ? readings[readings.length - 1] : null
  const screening = useMemo(() => ruleEngine.classify(latest, thresholds, now), [latest, thresholds, now])
  const browserAnomalies = useMemo(() => (backendAnomalies ? [] : detectAnomalies(readings)), [readings, backendAnomalies])
  const anomalies = backendAnomalies ?? browserAnomalies
  const anomalySource: 'browser' | 'backend' = backendAnomalies ? 'backend' : 'browser'
  const rawAlerts = useMemo(() => deriveAlerts(readings, thresholds, anomalies, now), [readings, thresholds, anomalies, now])
  const alerts = useMemo(() => rawAlerts.map((a) => ({ ...a, state: alertStates[a.id] ?? ('open' as AlertState) })), [rawAlerts, alertStates])
  const forecast = useMemo(() => forecastTank(sliceRange(readings, now - 40 * 60_000), thresholds, now), [readings, thresholds, now])

  const requestPump = async (on: boolean, token?: string) => {
    const check = pumpSafetyCheck(on, latest, screening, thresholds)
    if (!check.ok) {
      logPump(`Request pump ${on ? 'ON' : 'OFF'} rejected — ${check.reason}`)
      return { ok: false, message: check.reason }
    }
    if (mode === 'demo') {
      live.current.pump = on
      setPump(on)
      const msg = `Pump ${on ? 'ON' : 'OFF'} (SIMULATED — no hardware command sent)`
      logPump(msg)
      return { ok: true, message: msg }
    }
    try {
      const res = await api.pump(apiBase, on, token ?? '')
      setPump(res.pump)
      logPump(res.message)
      return { ok: res.ok, message: res.message }
    } catch (e) {
      const msg = (e as Error).message
      logPump(`Pump command failed — ${msg}`)
      return { ok: false, message: msg }
    }
  }

  const value: Store = {
    mode,
    setMode,
    apiBase,
    setApiBase,
    loading,
    error,
    retry: () => setReloadKey((k) => k + 1),
    readings,
    latest,
    now,
    screening,
    thresholds,
    setThresholds,
    resetThresholds,
    anomalies,
    anomalySource,
    alerts,
    setAlertState,
    forecast,
    scenario,
    setScenario,
    pump,
    pumpMode,
    setPumpMode,
    requestPump,
    pumpLog,
    device,
    health,
    healthError,
    checkHealth,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useClock(ms = 1000) {
  const [t, setT] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setT(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return t
}
