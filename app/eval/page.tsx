'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { LABEL_UI } from '@/components/trust-panel'
import { COMPARE_MODELS } from '@/lib/types'
import type { Label } from '@/lib/types'
import type { EvalEvent, EvalResult } from '@/app/api/eval/route'

const LABELS: Label[] = ['CERTAIN', 'UNCERTAIN', 'NEEDS_VERIFICATION', 'NOT_APPLICABLE']

export default function EvalPage() {
  const [model, setModel] = useState<string>(COMPARE_MODELS[0].id)
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<EvalResult[]>([])
  const [summary, setSummary] = useState<{
    correct: number; total: number; accuracy: number
    matrix: Record<string, Record<string, number>>
  } | null>(null)
  const [total, setTotal] = useState(0)
  const [openId, setOpenId] = useState<string | null>(null)

  async function run() {
    setRunning(true); setResults([]); setSummary(null); setTotal(0)
    try {
      const res = await fetch(`/api/eval?model=${encodeURIComponent(model)}`)
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
        for (const p of parts) {
          const line = p.replace(/^data: /, '').trim()
          if (!line) continue
          let ev: EvalEvent
          try { ev = JSON.parse(line) } catch { continue }
          if (ev.type === 'start') setTotal(ev.total)
          if (ev.type === 'case') setResults((r) => [...r, ev.result])
          if (ev.type === 'summary') setSummary(ev)
        }
      }
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <header className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Accuracy</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Every case is labelled by hand in advance. This runs the real
              pipeline and compares its verdict to that label.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={running}
              className="rounded-md border bg-card px-2 py-1.5 text-xs outline-none disabled:opacity-40"
            >
              {COMPARE_MODELS.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
            <button
              onClick={run}
              disabled={running}
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-40"
            >
              {running ? `Running ${results.length}/${total}` : 'Run evaluation'}
            </button>
          </div>
        </div>

        <p className="mt-3 rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          The judge is never told the correct answer. It sees only the claim and
          the pages we retrieved, and must produce a verbatim quote that we then
          match against the real page text. The expected labels below exist to
          score the system — they are not visible to it while it runs.
        </p>
      </header>

      {summary && (
        <div className="mb-6 grid gap-4 sm:grid-cols-[auto_1fr]">
          <div className="rounded-xl border px-4 py-3">
            <p className="text-3xl font-semibold tabular-nums">
              {Math.round(summary.accuracy * 100)}%
            </p>
            <p className="text-xs text-muted-foreground">
              {summary.correct} of {summary.total} matched
            </p>
          </div>
          <Matrix matrix={summary.matrix} />
        </div>
      )}

      <div className="space-y-2">
        {results.map((r) => (
          <div key={r.id} className="rounded-xl border">
            <button
              onClick={() => setOpenId(openId === r.id ? null : r.id)}
              className="flex w-full items-start gap-3 px-3 py-2.5 text-left"
            >
              <span
                className={cn(
                  'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-bold',
                  r.match
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                    : 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                )}
              >
                {r.match ? '✓' : '✕'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{r.question}</span>
                <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                  <Chip label={r.expected} prefix="expected" />
                  <Chip label={r.predicted} prefix="got" />
                  <span className="text-muted-foreground">
                    {r.exercises} · {(r.ms / 1000).toFixed(1)}s
                  </span>
                </span>
              </span>
            </button>

            {openId === r.id && (
              <div className="space-y-3 border-t px-3 py-3 text-xs">
                <div>
                  <p className="font-medium">Why this label was expected</p>
                  <p className="mt-0.5 text-muted-foreground">{r.why}</p>
                </div>

                <div>
                  <p className="font-medium">What the system concluded</p>
                  <p className="mt-0.5 text-muted-foreground">{r.headline}</p>
                  {r.overrides.map((o, i) => (
                    <p key={i} className="mt-1 text-rose-600 dark:text-rose-400">
                      Override: {o}
                    </p>
                  ))}
                </div>

                <div>
                  <p className="font-medium">
                    Evidence the judge found ({r.evidence.length})
                  </p>
                  <div className="mt-1 space-y-1.5">
                    {r.evidence.length === 0 && (
                      <p className="text-muted-foreground">
                        No claims were extracted.
                      </p>
                    )}
                    {r.evidence.map((e, i) => (
                      <div key={i} className="rounded-lg border px-2.5 py-2">
                        <p>{e.claim}</p>
                        <p
                          className={cn(
                            'mt-1 font-medium',
                            e.verdict === 'SUPPORTED'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-rose-600 dark:text-rose-400'
                          )}
                        >
                          {e.verdict}
                          {e.domain && (
                            <span className="ml-1 font-normal text-muted-foreground">
                              via {e.domain}
                              {e.section && <> under &ldquo;{e.section}&rdquo;</>}
                            </span>
                          )}
                        </p>
                        {e.quote && (
                          <blockquote
                            className={cn(
                              'mt-1.5 border-l-2 pl-2 italic',
                              e.quoteVerified
                                ? 'border-emerald-500/40 text-muted-foreground'
                                : 'border-rose-500/50 text-rose-600 line-through dark:text-rose-400'
                            )}
                          >
                            “{e.quote}”
                          </blockquote>
                        )}
                        {e.deepLink && (
                          <a
                            href={e.deepLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-1 inline-block underline underline-offset-2 hover:no-underline"
                          >
                            Open the page at this passage
                          </a>
                        )}
                        {e.quote && !e.quoteVerified && (
                          <p className="mt-1 text-rose-600 dark:text-rose-400">
                            This quote is not on the page. The model invented it.
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {!running && results.length === 0 && (
        <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          Run the evaluation to see how the labels compare.
        </p>
      )}
    </div>
  )
}

function Chip({ label, prefix }: { label: Label; prefix: string }) {
  return (
    <span
      className={cn(
        'rounded-full border px-1.5 py-0.5 font-medium',
        LABEL_UI[label].chip
      )}
    >
      {prefix} {LABEL_UI[label].text.toLowerCase()}
    </span>
  )
}

function Matrix({ matrix }: { matrix: Record<string, Record<string, number>> }) {
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b">
            <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">
              expected ↓ / got →
            </th>
            {LABELS.map((l) => (
              <th key={l} className="px-2 py-1.5 font-medium">
                {LABEL_UI[l].text}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {LABELS.map((exp) => (
            <tr key={exp} className="border-b last:border-0">
              <td className="px-2 py-1.5 font-medium">{LABEL_UI[exp].text}</td>
              {LABELS.map((got) => {
                const n = matrix[exp]?.[got] ?? 0
                return (
                  <td
                    key={got}
                    className={cn(
                      'px-2 py-1.5 text-center tabular-nums',
                      n === 0 && 'text-muted-foreground/40',
                      n > 0 && exp === got && 'bg-emerald-500/10 font-semibold',
                      n > 0 && exp !== got && 'bg-rose-500/10 font-semibold'
                    )}
                  >
                    {n || '·'}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
