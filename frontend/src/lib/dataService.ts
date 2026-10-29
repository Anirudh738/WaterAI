import { sanitizeReading } from './screening'
import type { Anomaly, DeviceInfo, Reading } from './types'

// Replaceable data layer. Demo mode never touches the network; API mode talks to the FastAPI backend,
// which in turn reads from demo data, Firebase, or the ESP32 (see backend/README).

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export function apiUrl(base: string, path: string) {
  const b = base.trim().replace(/\/$/, '')
  return `${b}${path}`
}

async function getJson<T>(base: string, path: string, init?: RequestInit, timeoutMs = 8000): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(apiUrl(base, path), { ...init, signal: ctrl.signal })
    const text = await res.text()
    let body: unknown = null
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      throw new ApiError(`Backend returned non-JSON from ${path} (is the backend running?)`, res.status)
    }
    if (!res.ok) {
      const detail = (body as { detail?: string })?.detail
      throw new ApiError(detail ?? `Request failed (${res.status})`, res.status)
    }
    return body as T
  } catch (e) {
    if (e instanceof ApiError) throw e
    if ((e as Error).name === 'AbortError') throw new ApiError('Backend did not respond in time', 0)
    throw new ApiError('Cannot reach the backend. Start it with `uvicorn app.main:app --port 8000`.', 0)
  } finally {
    clearTimeout(timer)
  }
}

interface ApiReading {
  ts: number // unix seconds (device format)
  ph: number | null
  tds: number | null
  ntu: number | null
  temp: number | null
  level: number | null
  pump?: boolean
}

function fromApi(r: ApiReading): Reading | null {
  const { reading, issues } = sanitizeReading({ ...r, ts: r.ts * 1000 })
  if (issues.some((i) => i.startsWith('Timestamp'))) return null
  return reading
}

export interface Health {
  ok: boolean
  data_source: string
  demo: boolean
  llm: { configured: boolean; provider: string | null; model: string | null }
  models: Record<string, string>
  pump_control: string
  version: string
}

export const api = {
  health: (base: string) => getJson<Health>(base, '/api/health', undefined, 4000),
  async history(base: string, range = '30d'): Promise<Reading[]> {
    const data = await getJson<{ readings: ApiReading[] }>(base, `/api/readings/history?range=${range}`, undefined, 20000)
    return data.readings.map(fromApi).filter((r): r is Reading => r !== null)
  },
  async latest(base: string): Promise<Reading | null> {
    const data = await getJson<{ reading: ApiReading | null }>(base, '/api/readings/latest')
    return data.reading ? fromApi(data.reading) : null
  },
  async anomalies(base: string): Promise<Anomaly[]> {
    const data = await getJson<{ anomalies: (Omit<Anomaly, 'ts'> & { ts: number })[] }>(base, '/api/anomalies', undefined, 20000)
    return data.anomalies.map((a) => ({ ...a, ts: a.ts * 1000 }))
  },
  device: (base: string) => getJson<DeviceInfo>(base, '/api/device'),
  ask: (base: string, body: unknown) =>
    getJson<{ source: 'llm' | 'demo'; provider: string | null; model: string | null; answer: string; note?: string }>(
      base,
      '/api/ai/ask',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      45000,
    ),
  pump: (base: string, on: boolean, token: string) =>
    getJson<{ ok: boolean; pump: boolean; message: string; simulated: boolean }>(base, '/api/device/pump', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ on }),
    }),
}

export const DEMO_DEVICE: DeviceInfo = {
  id: 'unit-01',
  name: 'Overhead tank · Block A',
  firmware: 'aquaguard-esp32 v0.3.1 (simulated)',
  rssi: -61,
  online: true,
  source: 'In-browser simulator',
}
