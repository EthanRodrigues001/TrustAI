'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { TrustBadge, TrustPanel, AnnotatedAnswer } from '@/components/trust-panel'
import { COMPARE_MODELS } from '@/lib/types'
import type { Verdict, StreamEvent, Stage } from '@/lib/types'

/** One model's attempt at a question. */
type Run = {
  model: string
  label: string
  content: string
  verdict?: Verdict
  stage?: { s: Stage; d?: string }
  done: boolean
}

type Msg =
  | { id: string; role: 'user'; content: string }
  | { id: string; role: 'assistant'; runs: Run[] }

const STAGE_TEXT: Record<Stage, string> = {
  classifying: 'Checking if this is a factual claim',
  generating: 'Asking the model',
  resolving: 'Searching for independent evidence',
  fetching: 'Reading the pages',
  verifying: 'Checking each claim against the page',
  consistency: 'Re-asking to test consistency',
  scoring: 'Scoring',
  done: 'Done',
}

const EXAMPLES = [
  'Who invented Python and when was it first released?',
  'Who wrote the novel Things Fall Apart?',
  'What is the current stock price of Tesla?',
]

export default function Home() {
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [compare, setCompare] = useState(false)
  const [modelA, setModelA] = useState<string>(COMPARE_MODELS[0].id)
  const [modelB, setModelB] = useState<string>(COMPARE_MODELS[1].id)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs])

  const labelOf = (id: string) =>
    COMPARE_MODELS.find((m) => m.id === id)?.label ?? id

  /** Streams one model's run, patching that run in place as events land. */
  async function streamOne(
    msgId: string,
    model: string,
    history: { role: 'user' | 'assistant'; content: string }[]
  ) {
    const patch = (fn: (r: Run) => Run) =>
      setMsgs((m) =>
        m.map((x) =>
          x.id === msgId && x.role === 'assistant'
            ? { ...x, runs: x.runs.map((r) => (r.model === model ? fn(r) : r)) }
            : x
        )
      )

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history, options: { model } }),
      })
      if (!res.body) throw new Error('No response body')

      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const parts = buf.split('\n\n')
        buf = parts.pop() ?? ''

        for (const part of parts) {
          const line = part.replace(/^data: /, '').trim()
          if (!line) continue
          let ev: StreamEvent
          try { ev = JSON.parse(line) } catch { continue }

          if (ev.type === 'stage') patch((r) => ({ ...r, stage: { s: ev.stage, d: ev.detail } }))
          if (ev.type === 'token') patch((r) => ({ ...r, content: r.content + ev.text }))
          if (ev.type === 'verdict') patch((r) => ({ ...r, verdict: ev.verdict }))
          if (ev.type === 'error' && ev.fatal) {
            patch((r) => ({ ...r, content: r.content || `Something went wrong: ${ev.message}` }))
          }
        }
      }
    } catch (e) {
      patch((r) => ({
        ...r,
        content: r.content || `Something went wrong: ${(e as Error).message}`,
      }))
    } finally {
      patch((r) => ({ ...r, stage: undefined, done: true }))
    }
  }

  async function send(text: string) {
    if (!text.trim() || busy) return

    const userMsg: Msg = { id: crypto.randomUUID(), role: 'user', content: text }
    // History carries the first run's answer, so a comparison does not fork the
    // conversation into two divergent threads.
    const history: { role: 'user' | 'assistant'; content: string }[] = []
    for (const m of msgs) {
      if (m.role === 'user') history.push({ role: 'user', content: m.content })
      else if (m.runs[0]?.content)
        history.push({ role: 'assistant', content: m.runs[0].content })
    }
    history.push({ role: 'user', content: text })

    const models = compare ? [modelA, modelB] : [modelA]
    const id = crypto.randomUUID()

    setMsgs((m) => [
      ...m,
      userMsg,
      {
        id,
        role: 'assistant',
        runs: models.map((mo) => ({
          model: mo, label: labelOf(mo), content: '', done: false,
        })),
      },
    ])
    setInput('')
    setBusy(true)

    // Both models answer the same question at the same time.
    await Promise.all(models.map((mo) => streamOne(id, mo, history)))

    setBusy(false)
    if (!compare) setOpenKey(`${id}:${modelA}`)
  }

  return (
    <div className={cn('mx-auto flex h-dvh w-full flex-col', compare ? 'max-w-6xl' : 'max-w-3xl')}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div className="flex items-baseline gap-2">
          <h1 className="text-sm font-semibold tracking-tight">TrustAI</h1>
          <p className="hidden text-xs text-muted-foreground sm:block">
            Answers checked against evidence we retrieve ourselves
          </p>
        </div>

        <div className="flex items-center gap-2">
          <ModelPicker value={modelA} onChange={setModelA} disabled={busy} />
          {compare && (
            <>
              <span className="text-xs text-muted-foreground">vs</span>
              <ModelPicker value={modelB} onChange={setModelB} disabled={busy} />
            </>
          )}
          <button
            onClick={() => setCompare((c) => !c)}
            disabled={busy}
            className={cn(
              'rounded-full border px-2.5 py-1 text-[11px] font-medium transition disabled:opacity-40',
              compare
                ? 'border-primary/30 bg-primary/10 text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {compare ? 'Comparing' : 'Compare'}
          </button>
        </div>
      </header>

      <div className="flex-1 space-y-6 overflow-y-auto px-4 py-6">
        {msgs.length === 0 && <Empty onPick={send} compare={compare} />}

        {msgs.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-secondary px-3.5 py-2 text-sm">
                {m.content}
              </div>
            </div>
          ) : (
            <div
              key={m.id}
              className={cn(
                'gap-4',
                m.runs.length > 1 ? 'grid md:grid-cols-2' : 'flex flex-col'
              )}
            >
              {m.runs.map((run) => (
                <RunColumn
                  key={run.model}
                  run={run}
                  showHeader={m.runs.length > 1}
                  open={openKey === `${m.id}:${run.model}`}
                  onToggle={() =>
                    setOpenKey(
                      openKey === `${m.id}:${run.model}` ? null : `${m.id}:${run.model}`
                    )
                  }
                />
              ))}
            </div>
          )
        )}

        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); send(input) }}
        className="border-t px-4 py-3"
      >
        <div className="flex items-end gap-2 rounded-2xl border bg-card px-3 py-2 focus-within:ring-1 focus-within:ring-ring">
          <textarea
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) }
            }}
            placeholder={
              compare ? 'Ask both models the same question' : 'Ask anything — the answer gets checked'
            }
            className="max-h-32 flex-1 resize-none bg-transparent py-1 text-sm outline-none placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition disabled:opacity-40"
          >
            Send
          </button>
        </div>
        <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
          {compare
            ? 'Both models get the same question and the same judge — only the answering model differs.'
            : 'Every claim is checked against pages we search for and read independently.'}
        </p>
      </form>
    </div>
  )
}

function RunColumn({
  run, showHeader, open, onToggle,
}: { run: Run; showHeader: boolean; open: boolean; onToggle: () => void }) {
  return (
    <div className={cn(showHeader && 'rounded-xl border bg-card/40 p-3')}>
      {showHeader && (
        <div className="mb-2 flex items-baseline justify-between gap-2 border-b pb-2">
          <p className="text-xs font-semibold">{run.label}</p>
          <code className="font-mono text-[10px] text-muted-foreground">{run.model}</code>
        </div>
      )}

      <div className="space-y-2.5">
        <div className="text-sm">
          {run.verdict ? (
            <AnnotatedAnswer text={run.content} claims={run.verdict.claims} />
          ) : (
            <p className="whitespace-pre-wrap leading-relaxed">{run.content}</p>
          )}
        </div>

        {run.stage && (
          <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
            <span className="size-3 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
            <span>{run.stage.d ?? STAGE_TEXT[run.stage.s]}</span>
          </div>
        )}

        {run.verdict && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <TrustBadge
                label={run.verdict.label}
                score={run.verdict.score}
                open={open}
                onClick={onToggle}
              />
              {run.verdict.perplexity && (
                <span className="text-[11px] text-muted-foreground">
                  PPX {run.verdict.perplexity.value}
                </span>
              )}
              <span className="text-[11px] text-muted-foreground">
                {(run.verdict.timing.totalMs / 1000).toFixed(1)}s
              </span>
            </div>
            {open && <TrustPanel verdict={run.verdict} />}
          </>
        )}
      </div>
    </div>
  )
}

function ModelPicker({
  value, onChange, disabled,
}: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="rounded-md border bg-card px-2 py-1 text-[11px] outline-none disabled:opacity-40"
    >
      {COMPARE_MODELS.map((m) => (
        <option key={m.id} value={m.id}>
          {m.label} — {m.note}
        </option>
      ))}
    </select>
  )
}

function Empty({ onPick, compare }: { onPick: (q: string) => void; compare: boolean }) {
  return (
    <div className="mx-auto max-w-lg pt-10 text-center">
      <h2 className="text-lg font-semibold tracking-tight">A chat that shows its work</h2>
      <p className="mt-1.5 text-sm text-muted-foreground">
        {compare ? (
          <>
            Two models answer the same question and face the same checks. The
            labels show which one you can actually rely on.
          </>
        ) : (
          <>
            Every answer is checked against pages we find and read ourselves, then
            labelled{' '}
            <span className="text-emerald-600 dark:text-emerald-400">Certain</span>,{' '}
            <span className="text-amber-600 dark:text-amber-400">Uncertain</span> or{' '}
            <span className="text-rose-600 dark:text-rose-400">Needs verification</span>.
          </>
        )}
      </p>

      <div className="mt-6 space-y-2 text-left">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Try one
        </p>
        {EXAMPLES.map((q) => (
          <button
            key={q}
            onClick={() => onPick(q)}
            className="w-full rounded-lg border px-3 py-2 text-left text-sm transition hover:bg-accent"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  )
}
