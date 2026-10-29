import clsx from 'clsx'
import { Bot, Languages, Send, Sparkles, User } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Badge, Button, PageHeader } from '../components/ui'
import { answerQuestion, buildContext, SUGGESTIONS, type Answer, type Lang, type SectionKind } from '../lib/assistant'
import { api } from '../lib/dataService'
import { useStore } from '../lib/store'

type Msg =
  | { id: number; role: 'user'; text: string }
  | { id: number; role: 'assistant'; source: 'demo'; answer: Answer; note?: string }
  | { id: number; role: 'assistant'; source: 'llm'; text: string; provider: string | null; model: string | null }

const SECTION: Record<SectionKind, { en: string; hi: string; cls: string }> = {
  facts: { en: 'Measured facts', hi: 'मापे गए तथ्य', cls: 'text-sky-700 bg-sky-400/10 ring-sky-400/20' },
  predictions: { en: 'Predictions', hi: 'अनुमान', cls: 'text-violet-700 bg-violet-400/10 ring-violet-400/20' },
  hypotheses: { en: 'Hypotheses (unconfirmed)', hi: 'संभावित कारण (अपुष्ट)', cls: 'text-amber-700 bg-amber-400/10 ring-amber-400/20' },
  steps: { en: 'Next steps', hi: 'अगले कदम', cls: 'text-emerald-700 bg-emerald-400/10 ring-emerald-400/20' },
  note: { en: 'Context', hi: 'संदर्भ', cls: 'text-slate-700 bg-slate-400/10 ring-slate-400/20' },
}

let nextId = 1

export default function Assistant() {
  const s = useStore()
  const [lang, setLang] = useState<Lang>('en')
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const endRef = useRef<HTMLDivElement>(null)
  const llmReady = Boolean(s.health?.llm.configured)
  const [useLlm, setUseLlm] = useState(true)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [msgs, busy])

  const ask = async (q: string) => {
    const question = q.trim()
    if (!question || busy) return
    setInput('')
    setMsgs((m) => [...m, { id: nextId++, role: 'user', text: question }])
    setBusy(true)
    const inp = { question, lang, mode: s.mode, readings: s.readings, latest: s.latest, screening: s.screening, thresholds: s.thresholds, anomalies: s.anomalies, forecast: s.forecast, alerts: s.alerts, now: s.now }

    if (llmReady && useLlm) {
      try {
        const res = await api.ask(s.apiBase, { question, language: lang, context: buildContext(inp) })
        if (res.source === 'llm') {
          setMsgs((m) => [...m, { id: nextId++, role: 'assistant', source: 'llm', text: res.answer, provider: res.provider, model: res.model }])
        } else {
          setMsgs((m) => [...m, { id: nextId++, role: 'assistant', source: 'demo', answer: answerQuestion(inp), note: res.note ?? 'Backend has no LLM configured.' }])
        }
      } catch (e) {
        setMsgs((m) => [...m, { id: nextId++, role: 'assistant', source: 'demo', answer: answerQuestion(inp), note: `LLM request failed (${(e as Error).message}). Showing the rule-based demo answer instead.` }])
      }
      setBusy(false)
      return
    }
    // small delay so the UI feels like a response, not a flash
    await new Promise((r) => setTimeout(r, 450))
    setMsgs((m) => [...m, { id: nextId++, role: 'assistant', source: 'demo', answer: answerQuestion(inp) }])
    setBusy(false)
  }

  return (
    <div className="fade-up flex h-[calc(100vh-7.5rem)] min-h-[560px] flex-col">
      <PageHeader
        title="AI water assistant"
        subtitle="Answers use only the readings, thresholds and history loaded in this app — with timestamps."
        actions={
          <>
            <div className="inline-flex rounded-xl bg-sky-50 p-1 ring-1 ring-sky-900/[0.12]">
              {(['en', 'hi'] as Lang[]).map((l) => (
                <button key={l} onClick={() => setLang(l)} className={clsx('flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold', lang === l ? 'bg-sky-400/15 text-sky-800' : 'text-slate-600 hover:text-slate-800')}>
                  {l === 'en' ? <Languages className="h-3.5 w-3.5" /> : null}
                  {l === 'en' ? 'English' : 'हिन्दी'}
                </button>
              ))}
            </div>
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-sky-900/[0.03] px-3 py-2 text-xs ring-1 ring-sky-900/[0.07]">
        {llmReady ? (
          <>
            <Badge tone="emerald">LLM available</Badge>
            <span className="text-slate-600">
              {s.health?.llm.provider} · {s.health?.llm.model} (server-side key)
            </span>
            <label className="ml-auto flex cursor-pointer items-center gap-2 text-slate-700">
              <input type="checkbox" checked={useLlm} onChange={(e) => setUseLlm(e.target.checked)} className="accent-sky-600" />
              Use LLM
            </label>
          </>
        ) : (
          <>
            <Badge tone="amber">Demo assistant</Badge>
            <span className="text-slate-600">Rule-based answers, no LLM is called. Set <code className="text-slate-700">LLM_API_KEY</code> on the backend to enable a real model.</span>
          </>
        )}
        {s.mode === 'demo' && <Badge tone="amber">Simulated data</Badge>}
      </div>

      <div className="glass flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
          {msgs.length === 0 && (
            <div className="mx-auto max-w-xl py-6 text-center">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-sky-400/20 to-teal-400/10 ring-1 ring-sky-400/20">
                <Sparkles className="h-6 w-6 text-sky-700" />
              </div>
              <p className="mt-3 text-base font-semibold text-slate-900">{lang === 'hi' ? 'पानी के बारे में कुछ भी पूछें' : 'Ask anything about your water'}</p>
              <p className="mt-1 text-sm text-slate-600">{lang === 'hi' ? 'हर जवाब में तथ्य, अनुमान और संभावित कारण अलग-अलग दिखेंगे।' : 'Every answer separates measured facts, predictions and hypotheses.'}</p>
              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                {SUGGESTIONS[lang].map((q) => (
                  <button key={q} onClick={() => ask(q)} className="rounded-xl bg-sky-900/[0.04] px-3 py-2.5 text-left text-sm text-slate-800 ring-1 ring-sky-900/[0.12] transition hover:bg-sky-400/10 hover:ring-sky-400/30">
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {msgs.map((m) =>
            m.role === 'user' ? (
              <div key={m.id} className="flex justify-end gap-2">
                <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-gradient-to-br from-sky-500 to-sky-600 px-4 py-2.5 text-sm text-white shadow-sm">{m.text}</div>
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-sky-900/[0.07]">
                  <User className="h-4 w-4 text-slate-700" />
                </div>
              </div>
            ) : (
              <div key={m.id} className="flex gap-2">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-sky-400 to-sky-600">
                  <Bot className="h-4 w-4 text-white" />
                </div>
                <div className="min-w-0 max-w-[92%] flex-1 rounded-2xl rounded-tl-sm bg-sky-900/[0.04] p-4 ring-1 ring-sky-900/[0.12]">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    {m.source === 'demo' ? <Badge tone="amber">Demo-generated · rule-based · no LLM</Badge> : <Badge tone="emerald">LLM · {m.provider} {m.model}</Badge>}
                    {s.mode === 'demo' && <Badge>from simulated data</Badge>}
                  </div>
                  {m.source === 'demo' ? <DemoAnswer a={m.answer} lang={lang} /> : <LlmText text={m.text} />}
                  {m.source === 'demo' && m.note && <p className="mt-3 text-[11px] text-amber-700/80">{m.note}</p>}
                </div>
              </div>
            ),
          )}
          {busy && (
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <div className="grid h-8 w-8 place-items-center rounded-full bg-sky-900/[0.045]">
                <Bot className="h-4 w-4 text-sky-700" />
              </div>
              <span className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-sky-500" style={{ animationDelay: `${i * 120}ms` }} />
                ))}
              </span>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            ask(input)
          }}
          className="border-t border-sky-900/[0.08] p-3"
        >
          {msgs.length > 0 && (
            <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
              {SUGGESTIONS[lang].map((q) => (
                <button type="button" key={q} onClick={() => ask(q)} className="shrink-0 rounded-full bg-sky-900/[0.045] px-3 py-1 text-xs text-slate-700 ring-1 ring-sky-900/[0.12] hover:bg-sky-400/10">
                  {q}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={lang === 'hi' ? 'अपना सवाल लिखें…' : 'Ask about pH, TDS, trends, the tank…'} className="min-w-0 flex-1 rounded-xl bg-white px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-500 ring-1 ring-sky-900/[0.12] focus:outline-none focus:ring-sky-400/40" />
            <Button type="submit" icon={Send} disabled={!input.trim() || busy}>
              <span className="hidden sm:inline">Send</span>
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

function DemoAnswer({ a, lang }: { a: Answer; lang: Lang }) {
  return (
    <div>
      <p className="text-[15px] font-bold text-slate-900">{a.title}</p>
      <div className="mt-3 space-y-3">
        {a.sections.map((sec, i) => (
          <div key={i}>
            <span className={clsx('inline-block rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1', SECTION[sec.kind].cls)}>{SECTION[sec.kind][lang]}</span>
            <ul className="mt-1.5 space-y-1">
              {sec.items.map((it, j) => (
                <li key={j} className={clsx('text-sm leading-relaxed', sec.kind === 'note' ? 'text-slate-600' : 'text-slate-800', it.startsWith('•') && 'pl-3')}>
                  {it}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}

function LlmText({ text }: { text: string }) {
  return (
    <div className="space-y-1.5 text-sm leading-relaxed text-slate-800">
      {text.split('\n').map((line, i) => {
        if (!line.trim()) return <div key={i} className="h-1" />
        const h = line.match(/^#{1,4}\s+(.*)/)
        if (h) return <p key={i} className="pt-1 text-xs font-bold uppercase tracking-wider text-sky-700">{h[1]}</p>
        const parts = line.split(/(\*\*[^*]+\*\*)/g)
        return (
          <p key={i}>
            {parts.map((p, j) => (p.startsWith('**') && p.endsWith('**') ? <strong key={j} className="text-slate-900">{p.slice(2, -2)}</strong> : p))}
          </p>
        )
      })}
    </div>
  )
}
