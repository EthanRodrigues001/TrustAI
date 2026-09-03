'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { TrustBadge, TrustPanel, AnnotatedAnswer } from '@/components/trust-panel'
import { DEMO_CASES, findDemo } from '@/lib/demo'
import type { Verdict, StreamEvent, Stage } from '@/lib/types'

type Msg = {
  id: string
  role: 'user' | 'assistant'
  content: string
  verdict?: Verdict
  demo?: boolean
}

const STAGE_TEXT: Record<Stage, string> = {
  classifying: 'Checking if this is a factual claim',
  generating: 'Asking Gemini',
  resolving: 'Resolving sources',
  fetching: 'Reading the cited pages',
  verifying: 'Checking each claim against the page',
  consistency: 'Re-asking to test consistency',
  scoring: 'Scoring',
  done: 'Done',
}

export default function Home() {
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState<{ s: Stage; d?: string } | null>(null)
  const [demoMode, setDemoMode] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs, stage])

  async function send(text: string) {
    if (!text.trim() || busy) return
    const userMsg: Msg = { id: crypto.randomUUID(), role: 'user', content: text }
    setMsgs((m) => [...m, userMsg])
    setInput('')
    setBusy(true)

    if (demoMode) {
      await runDemo(text)
      setBusy(false)
      return
    }

    const id = crypto.randomUUID()
    setMsgs((m) => [...m, { id, role: 'assistant', content: '' }])

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...msgs, userMsg].map(({ role, content }) => ({ role, content })),
        }),
      })
      if (!res.body) throw new Error('No response body')

      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''

      while (true) {
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

          if (ev.type === 'stage') setStage({ s: ev.stage, d: ev.detail })
          if (ev.type === 'token') {
            setMsgs((m) => m.map((x) => (x.id === id ? { ...x, content: x.content + ev.text } : x)))
          }
          if (ev.type === 'verdict') {
            setMsgs((m) => m.map((x) => (x.id === id ? { ...x, verdict: ev.verdict } : x)))
            setOpenId(id)
          }
          if (ev.type === 'error' && ev.fatal) {
            setMsgs((m) => m.map((x) => (x.id === id ? { ...x, content: `Error: ${ev.message}` } : x)))
          }
        }
      }
    } catch (e) {
      setMsgs((m) =>
        m.map((x) => (x.id === id ? { ...x, content: `Error: ${(e as Error).message}` } : x))
      )
    } finally {
      setStage(null)
      setBusy(false)
    }
  }

  /** Replays a canned case with realistic stage timing. */
  async function runDemo(text: string) {
    const demo = findDemo(text)
    const id = crypto.randomUUID()
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

    const seq: [Stage, string, number][] =
      demo.verdict.label === 'NOT_APPLICABLE'
        ? [['classifying', 'Checking if this is a factual claim', 500]]
        : [
            ['classifying', 'Checking if this is a factual claim', 550],
            ['generating', 'Asking Gemini', 900],
            ['resolving', `Resolving ${demo.verdict.sources.length} sources`, 700],
            ['fetching', 'Reading the cited pages', 900],
            ['verifying', `Checking claim 1 of ${demo.verdict.claims.length}`, 800],
            ['consistency', 'Re-asking to test consistency', 800],
            ['scoring', 'Scoring', 450],
          ]

    for (const [s, d, ms] of seq) {
      setStage({ s, d })
      await wait(ms)
    }

    setMsgs((m) => [...m, { id, role: 'assistant', content: '', demo: true }])

    // stream the answer in
    const words = demo.answer.split(' ')
    for (let i = 0; i < words.length; i++) {
      await wait(28)
      setMsgs((m) =>
        m.map((x) =>
          x.id === id ? { ...x, content: words.slice(0, i + 1).join(' ') } : x
        )
      )
    }

    setStage(null)
    setMsgs((m) => m.map((x) => (x.id === id ? { ...x, verdict: demo.verdict } : x)))
    setOpenId(id)
  }

  return (
    <div className="mx-auto flex h-dvh w-full max-w-3xl flex-col">
      {/* header */}
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex items-baseline gap-2">
          <h1 className="text-sm font-semibold tracking-tight">TrustAI</h1>
          <p className="text-xs text-muted-foreground">Hallucination confidence labeler</p>
        </div>
        <button
          onClick={() => setDemoMode((d) => !d)}
          className={cn(
            'rounded-full border px-2.5 py-1 text-[11px] font-medium transition',
            demoMode
              ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
              : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
          )}
        >
          {demoMode ? 'Demo data' : 'Live API'}
        </button>
      </header>

      {/* messages */}
      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-6">
        {msgs.length === 0 && <Empty onPick={send} demoMode={demoMode} />}

        {msgs.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-secondary px-3.5 py-2 text-sm">
                {m.content}
              </div>
            </div>
          ) : (
            <div key={m.id} className="space-y-2.5">
              <div className="text-sm">
                {m.verdict ? (
                  <AnnotatedAnswer text={m.content} claims={m.verdict.claims} />
                ) : (
                  <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
                )}
              </div>

              {m.verdict && (
                <>
                  <div className="flex items-center gap-2">
                    <TrustBadge
                      label={m.verdict.label}
                      score={m.verdict.score}
                      open={openId === m.id}
                      onClick={() => setOpenId(openId === m.id ? null : m.id)}
                    />
                    {m.demo && (
                      <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                        DEMO
                      </span>
                    )}
                  </div>
                  {openId === m.id && <TrustPanel verdict={m.verdict} />}
                </>
              )}
            </div>
          )
        )}

        {stage && (
          <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
            <span className="size-3 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
            <span>{stage.d ?? STAGE_TEXT[stage.s]}</span>
          </div>
        )}

        <div ref={endRef} />
      </div>

      {/* input */}
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
            placeholder="Ask anything — the answer gets checked"
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
          {demoMode
            ? 'Demo data — canned results for building the interface. Toggle to Live API for real checks.'
            : 'Live — every cited page is re-fetched and checked.'}
        </p>
      </form>
    </div>
  )
}

function Empty({ onPick, demoMode }: { onPick: (q: string) => void; demoMode: boolean }) {
  return (
    <div className="mx-auto max-w-lg pt-10 text-center">
      <h2 className="text-lg font-semibold tracking-tight">A chat that shows its work</h2>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Every answer is checked against the pages it cites, then labelled{' '}
        <span className="text-emerald-600 dark:text-emerald-400">Certain</span>,{' '}
        <span className="text-amber-600 dark:text-amber-400">Uncertain</span> or{' '}
        <span className="text-rose-600 dark:text-rose-400">Needs verification</span>.
      </p>

      {demoMode && (
        <div className="mt-6 space-y-2 text-left">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Try one
          </p>
          {DEMO_CASES.slice(0, 3).map((d) => (
            <button
              key={d.key}
              onClick={() => onPick(d.question)}
              className="w-full rounded-lg border px-3 py-2 text-left text-sm transition hover:bg-accent"
            >
              {d.question}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
