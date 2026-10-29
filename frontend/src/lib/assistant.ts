import { humanMins, sliceRange, stats } from './analytics'
import { fmtWithUnit, SENSORS, STATUS_META } from './sensors'
import type { AlertItem, Anomaly, DataMode, Forecast, Reading, Screening, SensorKey, Thresholds } from './types'

// Rule-based DEMO assistant. No LLM is called here. Every number it quotes comes from the data
// passed in, with its timestamp. Output is split into Measured facts / Predictions / Hypotheses / Next steps.

export type Lang = 'en' | 'hi'
export type SectionKind = 'facts' | 'predictions' | 'hypotheses' | 'steps' | 'note'
export interface AnswerSection {
  kind: SectionKind
  items: string[]
}
export interface Answer {
  title: string
  sections: AnswerSection[]
}

export interface AssistantInput {
  question: string
  lang: Lang
  mode: DataMode
  readings: Reading[]
  latest: Reading | null
  screening: Screening
  thresholds: Thresholds
  anomalies: Anomaly[]
  forecast: Forecast
  alerts: (AlertItem & { state: string })[]
  now: number
}

export const SUGGESTIONS: Record<Lang, string[]> = {
  en: [
    'Is the water safe right now?',
    'Explain the current TDS reading',
    'What changed in the last 24 hours?',
    'Were there any anomalies this week?',
    'When will the tank need refilling?',
    'What should I do next?',
  ],
  hi: [
    'क्या पानी अभी सुरक्षित है?',
    'अभी का TDS समझाइए',
    'पिछले 24 घंटों में क्या बदला?',
    'इस हफ्ते कोई असामान्य बदलाव हुआ?',
    'टंकी कब खाली होगी?',
    'अब मुझे क्या करना चाहिए?',
  ],
}

type Intent = 'status' | SensorKey | 'trend' | 'anomaly' | 'forecast' | 'action' | 'alerts' | 'pump' | 'summary'

export function detectIntent(q: string): Intent {
  const s = q.toLowerCase()
  const has = (...w: string[]) => w.some((x) => s.includes(x))
  if (has('pump', 'पंप', 'motor', 'मोटर')) return 'pump'
  if (has('anomal', 'spike', 'unusual', 'sudden', 'jump', 'असामान्य', 'अचानक')) return 'anomaly'
  if (has('forecast', 'empty', 'refill', 'how long', 'run out', 'खाली', 'कब', 'भर')) return 'forecast'
  if (has('24', 'trend', 'changed', 'change', 'history', 'week', 'बदला', 'बदलाव', 'ट्रेंड')) return 'trend'
  if (has('what should', 'next step', 'do next', 'action', 'recommend', 'क्या करना', 'क्या करूं', 'सलाह')) return 'action'
  if (has('alert', 'warning', 'अलर्ट', 'चेतावनी')) return 'alerts'
  if (has('tds', 'salt', 'dissolved', 'टीडीएस', 'नमक')) return 'tds'
  if (has('ph', 'acid', 'alkaline', 'पीएच', 'अम्ल')) return 'ph'
  if (has('turbid', 'cloud', 'ntu', 'muddy', 'गंद', 'मटमैल')) return 'ntu'
  if (has('temp', 'hot', 'warm', 'तापमान', 'गरम')) return 'temp'
  if (has('tank', 'level', 'टंकी', 'स्तर')) return 'level'
  if (has('safe', 'drink', 'potable', 'quality', 'सुरक्षित', 'पीने', 'पी सक', 'गुणवत्ता')) return 'status'
  return 'summary'
}

const T = (lang: Lang, en: string, hi: string) => (lang === 'hi' ? hi : en)
const at = (ts: number) => new Date(ts).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })

function readingFacts(inp: AssistantInput, keys: SensorKey[]): string[] {
  const { latest, lang } = inp
  if (!latest) return [T(lang, 'No readings are available.', 'कोई रीडिंग उपलब्ध नहीं है।')]
  return keys.map((k) => {
    const v = latest[k]
    const verdict = inp.screening.verdicts[k]
    const label = lang === 'hi' ? SENSORS[k].labelHi : SENSORS[k].label
    if (v === null) return T(lang, `${label}: no valid value in the latest packet (${at(latest.ts)}).`, `${label}: आख़िरी पैकेट (${at(latest.ts)}) में कोई मान्य मान नहीं।`)
    return `${label}: ${fmtWithUnit(k, v)} — ${STATUS_META[verdict.status].label} (${at(latest.ts)})`
  })
}

function limitsFor(k: SensorKey, t: Thresholds, lang: Lang): string {
  switch (k) {
    case 'ph':
      return T(lang, `Configured pH bands: safe ${t.ph.safeMin}–${t.ph.safeMax}, warning to ${t.ph.warnMin}–${t.ph.warnMax}, unsafe beyond (BIS IS 10500: 6.5–8.5).`, `pH सीमा: सुरक्षित ${t.ph.safeMin}–${t.ph.safeMax}, चेतावनी ${t.ph.warnMin}–${t.ph.warnMax} तक, उसके बाहर असुरक्षित (BIS: 6.5–8.5)।`)
    case 'tds':
      return T(lang, `Configured TDS limits: safe ≤ ${t.tds.safeMax} mg/L, warning ${t.tds.safeMax}–${t.tds.warnMax}, unsafe ≥ ${t.tds.warnMax}. The probe tops out at ${t.tds.probeMax} mg/L.`, `TDS सीमा: सुरक्षित ≤ ${t.tds.safeMax} mg/L, चेतावनी ${t.tds.safeMax}–${t.tds.warnMax}, असुरक्षित ≥ ${t.tds.warnMax}। सेंसर अधिकतम ${t.tds.probeMax} mg/L पढ़ता है।`)
    case 'ntu':
      return T(lang, `Configured turbidity limits: safe ≤ ${t.ntu.safeMax} NTU, warning up to ${t.ntu.warnMax} NTU, unsafe above.`, `गंदलापन सीमा: सुरक्षित ≤ ${t.ntu.safeMax} NTU, चेतावनी ${t.ntu.warnMax} NTU तक, उससे ऊपर असुरक्षित।`)
    case 'temp':
      return T(lang, `No BIS limit for temperature. It is used to correct pH and TDS. Warning above ${t.temp.warnAbove} °C.`, `तापमान की BIS सीमा नहीं है। इससे pH और TDS सुधारे जाते हैं। ${t.temp.warnAbove} °C से ऊपर चेतावनी।`)
    case 'level':
      return T(lang, `Pump turns ON below ${t.level.pumpOnBelow}% and OFF above ${t.level.pumpOffAbove}%.`, `पंप ${t.level.pumpOnBelow}% से नीचे चालू और ${t.level.pumpOffAbove}% से ऊपर बंद होता है।`)
  }
}

const EXPLAIN: Record<SensorKey, [string, string]> = {
  ph: ['pH shows how acidic or alkaline the water is. Too low corrodes pipes and can leach metals; too high tastes bitter and weakens chlorine disinfection.', 'pH बताता है कि पानी कितना अम्लीय या क्षारीय है। बहुत कम होने पर पाइप गलते हैं; बहुत ज़्यादा होने पर क्लोरीन कम असर करती है।'],
  tds: ['TDS (total dissolved solids) is the amount of dissolved salts and minerals. A sudden rise can mean sewage or salty water getting in.', 'TDS यानी पानी में घुले नमक और खनिज। अचानक बढ़ना सीवेज या खारे पानी के मिलने का संकेत हो सकता है।'],
  ntu: ['Turbidity is how cloudy the water is. Particles can hide germs from chlorine, so cloudy water is riskier even if it looks fine.', 'गंदलापन बताता है कि पानी कितना धुंधला है। कण कीटाणुओं को क्लोरीन से बचा सकते हैं।'],
  temp: ['Temperature is used to correct the pH and TDS readings. Warm water also lets germs grow faster.', 'तापमान से pH और TDS की रीडिंग सुधारी जाती है। गरम पानी में कीटाणु तेज़ी से बढ़ते हैं।'],
  level: ['Tank level comes from the ultrasonic sensor above the water. It drives the automatic pump and the refill forecast.', 'टंकी का स्तर अल्ट्रासोनिक सेंसर से आता है। इसी से पंप और खाली होने का अनुमान चलता है।'],
}

const LIMITATION: [string, string] = [
  'These five sensors cannot detect bacteria, nitrate, fluoride, arsenic or heavy metals. "Safe" here means "passed 5-sensor screening", not "certified potable". Confirm with a lab test.',
  'ये पाँच सेंसर बैक्टीरिया, नाइट्रेट, फ्लोराइड, आर्सेनिक या भारी धातुएँ नहीं पकड़ सकते। यहाँ "सुरक्षित" का मतलब सिर्फ़ 5-सेंसर जाँच पास होना है, पीने योग्य होने का प्रमाण नहीं। लैब टेस्ट से पुष्टि करें।',
]

function demoNote(inp: AssistantInput): string {
  return inp.mode === 'demo'
    ? T(inp.lang, 'All values above come from SIMULATED demo data, not a real device.', 'ऊपर के सभी मान डेमो (नकली) डेटा से हैं, असली डिवाइस से नहीं।')
    : T(inp.lang, 'Values come from the connected backend data source.', 'मान जुड़े हुए बैकएंड डेटा स्रोत से हैं।')
}

function staleFacts(inp: AssistantInput): string[] {
  const { screening, lang } = inp
  if (!screening.stale || screening.ageSec === null) return []
  return [T(lang, `The latest reading is ${screening.ageSec}s old (stale after ${inp.thresholds.staleAfterSec}s). The current water state is UNKNOWN.`, `आख़िरी रीडिंग ${screening.ageSec} सेकंड पुरानी है। अभी पानी की स्थिति अज्ञात है।`)]
}

function changeFacts(inp: AssistantInput, hours: number): string[] {
  const { readings, now, lang } = inp
  const slice = sliceRange(readings, now - hours * 3600_000)
  if (slice.length < 2) return [T(lang, `Not enough data in the last ${hours} h.`, `पिछले ${hours} घंटे में पर्याप्त डेटा नहीं है।`)]
  const out: string[] = []
  for (const k of ['ph', 'tds', 'ntu', 'temp', 'level'] as SensorKey[]) {
    const s = stats(slice, k)
    if (s.count === 0 || s.min === null || s.max === null || s.mean === null) {
      out.push(T(lang, `${SENSORS[k].label}: no valid data in this window.`, `${SENSORS[k].labelHi}: इस अवधि में कोई डेटा नहीं।`))
      continue
    }
    const label = lang === 'hi' ? SENSORS[k].labelHi : SENSORS[k].label
    out.push(
      T(
        lang,
        `${label}: avg ${fmtWithUnit(k, s.mean)}, min ${fmtWithUnit(k, s.min)} (${at(s.minAt!)}), max ${fmtWithUnit(k, s.max)} (${at(s.maxAt!)}), ${s.count} readings.`,
        `${label}: औसत ${fmtWithUnit(k, s.mean)}, न्यूनतम ${fmtWithUnit(k, s.min)} (${at(s.minAt!)}), अधिकतम ${fmtWithUnit(k, s.max)} (${at(s.maxAt!)}), ${s.count} रीडिंग।`,
      ),
    )
  }
  return out
}

function forecastSection(inp: AssistantInput): AnswerSection[] {
  const { forecast: f, lang } = inp
  if (!f.etaLabel) {
    return [{ kind: 'note', items: [T(lang, `Tank forecast not available: ${f.qualityNote}`, `टंकी का अनुमान उपलब्ध नहीं: ${f.qualityNote}`)] }]
  }
  const pred = [
    T(
      lang,
      `${f.etaLabel}. Trend: ${f.trend}, ${f.slopePerHour !== null ? `${f.slopePerHour.toFixed(1)} %/h` : ''} (${f.method}).`,
      `${f.etaLabel}। रुझान: ${f.trend === 'draining' ? 'घट रहा' : f.trend === 'filling' ? 'भर रहा' : 'स्थिर'}, ${f.slopePerHour !== null ? `${f.slopePerHour.toFixed(1)} %/घंटा` : ''}।`,
    ),
  ]
  if (!f.reliable) pred.push(T(lang, `Low confidence: ${f.qualityNote}`, `कम भरोसा: ${f.qualityNote}`))
  else pred.push(T(lang, `Fit quality: ${f.qualityNote}`, `फ़िट गुणवत्ता: ${f.qualityNote}`))
  return [{ kind: 'predictions', items: pred }]
}

function recentAnomalies(inp: AssistantInput, days = 7) {
  return inp.anomalies.filter((a) => a.ts > inp.now - days * 86400_000)
}

function nextSteps(inp: AssistantInput): string[] {
  const { screening, lang } = inp
  const steps: string[] = []
  if (screening.stale) steps.push(T(lang, 'Check power and Wi-Fi at the ESP32 unit; treat the water as unverified until data resumes.', 'ESP32 यूनिट की बिजली और Wi-Fi जाँचें; डेटा लौटने तक पानी को असत्यापित मानें।'))
  for (const k of ['ph', 'tds', 'ntu'] as SensorKey[]) {
    const v = screening.verdicts[k]
    if (v.status === 'unknown' && !screening.stale) steps.push(T(lang, `Inspect the ${SENSORS[k].label} probe (${SENSORS[k].hardware}) — it is not sending valid values.`, `${SENSORS[k].labelHi} प्रोब (${SENSORS[k].hardware}) जाँचें — यह सही मान नहीं भेज रहा।`))
    if (v.status === 'unsafe') steps.push(T(lang, `Stop using this water for drinking. Collect a sample and get a lab test for ${SENSORS[k].label}.`, `इस पानी को पीने के लिए इस्तेमाल न करें। सैंपल लेकर ${SENSORS[k].labelHi} का लैब टेस्ट कराएँ।`))
    if (v.status === 'warning') steps.push(T(lang, `Watch ${SENSORS[k].label} for the next 30 minutes; if it keeps rising, take a sample for a lab check.`, `अगले 30 मिनट ${SENSORS[k].labelHi} पर नज़र रखें; बढ़ता रहे तो लैब जाँच कराएँ।`))
  }
  if (steps.length === 0) steps.push(T(lang, 'No action needed now. Keep the routine: recalibrate pH every 2–4 weeks and send a lab sample monthly.', 'अभी कोई कार्रवाई ज़रूरी नहीं। pH हर 2–4 हफ्ते में कैलिब्रेट करें और हर महीने लैब सैंपल भेजें।'))
  return steps
}

export function answerQuestion(inp: AssistantInput): Answer {
  const intent = detectIntent(inp.question)
  const { lang, screening } = inp
  const status = STATUS_META[screening.status].label.toUpperCase()

  switch (intent) {
    case 'status':
    case 'summary': {
      const hyps: string[] = []
      if (screening.status !== 'safe') hyps.push(...screening.reasons.slice(0, 3).map((r) => T(lang, `Driver: ${r}`, `कारण: ${r}`)))
      return {
        title: T(lang, `Screening result: ${status}`, `जाँच परिणाम: ${status}`),
        sections: [
          { kind: 'facts', items: [...staleFacts(inp), ...readingFacts(inp, ['ph', 'tds', 'ntu', 'temp', 'level'])] },
          ...(hyps.length ? [{ kind: 'hypotheses' as const, items: hyps }] : []),
          { kind: 'steps', items: nextSteps(inp) },
          { kind: 'note', items: [T(lang, LIMITATION[0], LIMITATION[1]), demoNote(inp)] },
        ],
      }
    }
    case 'ph':
    case 'tds':
    case 'ntu':
    case 'temp':
    case 'level': {
      const k = intent
      const s24 = stats(sliceRange(inp.readings, inp.now - 24 * 3600_000), k)
      const facts = [...staleFacts(inp), ...readingFacts(inp, [k])]
      if (s24.count && s24.mean !== null) facts.push(T(lang, `24 h range: ${fmtWithUnit(k, s24.min)} – ${fmtWithUnit(k, s24.max)}, average ${fmtWithUnit(k, s24.mean)}.`, `24 घंटे की रेंज: ${fmtWithUnit(k, s24.min)} – ${fmtWithUnit(k, s24.max)}, औसत ${fmtWithUnit(k, s24.mean)}।`))
      facts.push(limitsFor(k, inp.thresholds, lang))
      const an = recentAnomalies(inp).filter((a) => a.sensor === k)
      const sections: AnswerSection[] = [
        { kind: 'note', items: [T(lang, EXPLAIN[k][0], EXPLAIN[k][1])] },
        { kind: 'facts', items: facts },
      ]
      if (an.length) sections.push({ kind: 'hypotheses', items: an.slice(0, 2).flatMap((a) => [T(lang, `Sudden ${a.direction === 'up' ? 'rise' : 'drop'} to ${fmtWithUnit(k, a.value)} at ${at(a.ts)}. Possible causes (unconfirmed):`, `${at(a.ts)} पर अचानक ${fmtWithUnit(k, a.value)}। संभावित कारण (अपुष्ट):`), ...a.hypotheses.slice(0, 3).map((h) => `• ${h}`)]) })
      if (k === 'level') sections.push(...forecastSection(inp))
      sections.push({ kind: 'steps', items: nextSteps(inp) })
      sections.push({ kind: 'note', items: [demoNote(inp)] })
      return { title: T(lang, `${SENSORS[k].label} explained`, `${SENSORS[k].labelHi} की जानकारी`), sections }
    }
    case 'trend':
      return {
        title: T(lang, 'Last 24 hours', 'पिछले 24 घंटे'),
        sections: [
          { kind: 'facts', items: changeFacts(inp, 24) },
          ...(recentAnomalies(inp, 1).length
            ? [{ kind: 'hypotheses' as const, items: recentAnomalies(inp, 1).map((a) => T(lang, `${SENSORS[a.sensor].label} jumped to ${fmtWithUnit(a.sensor, a.value)} at ${at(a.ts)} — possibly: ${a.hypotheses[0].toLowerCase()}`, `${at(a.ts)} पर ${SENSORS[a.sensor].labelHi} ${fmtWithUnit(a.sensor, a.value)} हुआ — संभवतः: ${a.hypotheses[0]}`)) }]
            : [{ kind: 'note' as const, items: [T(lang, 'No sudden changes were flagged in the last 24 h.', 'पिछले 24 घंटे में कोई अचानक बदलाव नहीं मिला।')] }]),
          { kind: 'note', items: [demoNote(inp)] },
        ],
      }
    case 'anomaly': {
      const an = recentAnomalies(inp, 7)
      return {
        title: T(lang, `${an.length} anomal${an.length === 1 ? 'y' : 'ies'} in the last 7 days`, `पिछले 7 दिनों में ${an.length} असामान्य बदलाव`),
        sections: [
          { kind: 'facts', items: an.length ? an.slice(0, 6).map((a) => T(lang, `${at(a.ts)} — ${SENSORS[a.sensor].label} ${fmtWithUnit(a.sensor, a.value)} vs baseline ${fmtWithUnit(a.sensor, a.baseline)} (score ${a.score.toFixed(1)}).`, `${at(a.ts)} — ${SENSORS[a.sensor].labelHi} ${fmtWithUnit(a.sensor, a.value)}, सामान्य ${fmtWithUnit(a.sensor, a.baseline)} (स्कोर ${a.score.toFixed(1)})।`)) : [T(lang, 'None flagged.', 'कोई नहीं मिला।')] },
          ...(an.length ? [{ kind: 'hypotheses' as const, items: an.slice(0, 3).map((a) => `${SENSORS[a.sensor].label}: ${a.hypotheses.slice(0, 2).join('; ')}`) }] : []),
          { kind: 'note', items: [T(lang, 'Detector: statistical z-score (in-browser stand-in for the Isolation Forest). Scores above 6 are flagged. Causes are hypotheses only.', 'डिटेक्टर: सांख्यिकीय z-स्कोर। 6 से ऊपर स्कोर चिह्नित होते हैं। कारण केवल अनुमान हैं।'), demoNote(inp)] },
        ],
      }
    }
    case 'forecast':
      return {
        title: T(lang, 'Tank level forecast', 'टंकी स्तर का अनुमान'),
        sections: [{ kind: 'facts', items: [...staleFacts(inp), ...readingFacts(inp, ['level']), T(lang, `Pump is ${inp.latest?.pump ? 'ON' : 'OFF'}.`, `पंप ${inp.latest?.pump ? 'चालू' : 'बंद'} है।`)] }, ...forecastSection(inp), { kind: 'note', items: [demoNote(inp)] }],
      }
    case 'action':
      return {
        title: T(lang, 'Recommended next steps', 'सुझाए गए अगले कदम'),
        sections: [{ kind: 'facts', items: [T(lang, `Current screening: ${status}.`, `वर्तमान जाँच: ${status}।`), ...screening.reasons.slice(0, 3)] }, { kind: 'steps', items: nextSteps(inp) }, { kind: 'note', items: [T(lang, LIMITATION[0], LIMITATION[1])] }],
      }
    case 'alerts': {
      const open = inp.alerts.filter((a) => a.state === 'open')
      return {
        title: T(lang, `${open.length} open alert${open.length === 1 ? '' : 's'}`, `${open.length} खुले अलर्ट`),
        sections: [
          { kind: 'facts', items: open.length ? open.slice(0, 6).map((a) => `${at(a.ts)} — [${a.severity.toUpperCase()}] ${a.title}`) : [T(lang, 'No open alerts.', 'कोई खुला अलर्ट नहीं।')] },
          { kind: 'steps', items: open.slice(0, 3).map((a) => a.nextStep) },
        ],
      }
    }
    case 'pump':
      return {
        title: T(lang, 'About pump control', 'पंप नियंत्रण के बारे में'),
        sections: [
          { kind: 'facts', items: [T(lang, `Pump is currently ${inp.latest?.pump ? 'ON' : 'OFF'}.`, `पंप अभी ${inp.latest?.pump ? 'चालू' : 'बंद'} है।`), limitsFor('level', inp.thresholds, lang)] },
          { kind: 'note', items: [T(lang, 'The assistant cannot switch the pump. Pump commands only go through Device Settings, with safety interlocks (no filling when the tank is full, data is stale, or water is Unsafe).', 'सहायक पंप नहीं चला सकता। पंप केवल डिवाइस सेटिंग्स से, सुरक्षा जाँच के साथ चलता है।')] },
        ],
      }
  }
}

/** Compact, factual context sent to the backend LLM. The LLM sees only this. */
export function buildContext(inp: Omit<AssistantInput, 'question' | 'lang'>) {
  const s24 = sliceRange(inp.readings, inp.now - 24 * 3600_000)
  const keys: SensorKey[] = ['ph', 'tds', 'ntu', 'temp', 'level']
  return {
    data_mode: inp.mode === 'demo' ? 'DEMO (simulated data)' : 'backend',
    generated_at: new Date(inp.now).toISOString(),
    latest_reading: inp.latest ? { ...inp.latest, ts: new Date(inp.latest.ts).toISOString() } : null,
    screening: { status: inp.screening.status, stale: inp.screening.stale, age_seconds: inp.screening.ageSec, reasons: inp.screening.reasons, engine: inp.screening.engine },
    thresholds: inp.thresholds,
    last_24h: Object.fromEntries(keys.map((k) => {
      const s = stats(s24, k)
      return [k, { ...s, minAt: s.minAt ? new Date(s.minAt).toISOString() : null, maxAt: s.maxAt ? new Date(s.maxAt).toISOString() : null }]
    })),
    anomalies_7d: inp.anomalies.filter((a) => a.ts > inp.now - 7 * 86400_000).slice(0, 8).map((a) => ({ ...a, ts: new Date(a.ts).toISOString() })),
    tank_forecast: { ...inp.forecast, projection: undefined, eta: inp.forecast.etaMinutes !== null ? humanMins(inp.forecast.etaMinutes) : null },
    open_alerts: inp.alerts.filter((a) => a.state === 'open').slice(0, 8).map((a) => ({ ts: new Date(a.ts).toISOString(), severity: a.severity, title: a.title, sensor: a.sensor })),
  }
}
