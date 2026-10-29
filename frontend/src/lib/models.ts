import { screen } from './screening'
import type { Reading, Screening, Thresholds } from './types'

// Model registry. Each slot has a clear status so the UI never pretends a model is trained.
// To plug in real models: train them in backend/train_models.py, run the backend in API mode,
// and the backend reports `trained` for that slot via GET /api/health.

export type ModelStatus = 'active' | 'stand-in' | 'not-trained' | 'backend'

export interface ModelSlot {
  id: 'quality' | 'forecast' | 'anomaly'
  planned: string
  purpose: string
  runningNow: string
  status: ModelStatus
  note: string
}

export const MODEL_SLOTS: ModelSlot[] = [
  {
    id: 'quality',
    planned: 'Random Forest classifier',
    purpose: 'Safe / Warning / Unsafe from pH, TDS, turbidity, temperature',
    runningNow: 'Deterministic BIS rule engine',
    status: 'stand-in',
    note: 'No labelled, lab-validated dataset yet, so no Random Forest has been trained. The rule engine stays as the safety backstop even after a model is added.',
  },
  {
    id: 'forecast',
    planned: 'Linear Regression',
    purpose: 'Tank level forecast from the last 30 min (180 points at 10 s)',
    runningNow: 'Least-squares linear regression (fitted live)',
    status: 'active',
    note: 'This is a real fit, recomputed on every update. In demo mode it is fitted on simulated data.',
  },
  {
    id: 'anomaly',
    planned: 'Isolation Forest',
    purpose: 'Flag sudden jumps (e.g. a TDS spike)',
    runningNow: 'Statistical z-score detector (in browser)',
    status: 'stand-in',
    note: 'The backend runs a scikit-learn Isolation Forest on the recent window when API mode is on. The browser uses a simpler statistical detector so demo mode works offline.',
  },
]

export interface QualityClassifier {
  name: string
  simulated: boolean
  classify(r: Reading | null, t: Thresholds, now?: number): Screening
}

export const ruleEngine: QualityClassifier = {
  name: 'Rule engine (BIS IS 10500)',
  simulated: false,
  classify: (r, t, now) => screen(r, t, now),
}
