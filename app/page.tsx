'use client'

import { useEffect, useRef, useState } from 'react'
import { TrustBadge, TrustPanel, AnnotatedAnswer } from '@/components/trust-panel'
import type { Verdict, StreamEvent, Stage } from '@/lib/types'

type Msg = {
  id: string
  role: 'user' | 'assistant'
  content: string
  verdict?: Verdict
}

const STAGE_TEXT: Record<Stage, string> = {
  classifying: 'Checking if this is a factual claim',
  generating: 'Asking Gemini',
  resolving: 'Searching for independent evidence',
  fetching: 'Reading the pages',
  verifying: 'Checking each claim against the page',
  consistency: 'Re-asking to test consistency',
  scoring: 'Scoring',
  done: 'Done',
}

const EXAMPLES = [
  'Who invented Python and when was it first released?',
  'What is the boiling point of water at sea level?',
  'Who wrote the novel Things Fall Apart?',
]

export default function Home() {
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState<{ s: Stage; d?: string } | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs, stage])

  async function send(text: string) {
    if (!text.trim() || busy) return

    const userMsg: Msg = { id: crypto.randomUUID(), role: 'user', content: text }
    const history = [...msgs, userMsg]
    setMsgs(history)
    setInput('')
    setBusy(true)

    const id = crypto.randomUUID()
    setMsgs((m) => [...m, { id, role: 'assistant', content: '' }])

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: history.map(({ role, content }) => ({ role, content })),
        }),
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

          if (ev.type === 'stage') setStage({ s: ev.stage, d: ev.detail })

          if (ev.type === 'token') {
            setMsgs((m) =>
              m.map((x) => (x.id === id ? { ...x, content: x.content + ev.text } : x))
            )
          }

          if (ev.type === 'verdict') {
            setMsgs((m) => m.map((x) => (x.id === id ? { ...x, verdict: ev.verdict } : x)))
            setOpenId(id)
          }

          if (ev.type === 'error' && ev.fatal) {
            setMsgs((m) =>
              m.map((x) =>
                x.id === id
                  ? { ...x, content: x.content || `Something went wrong: ${ev.message}` }
                  : x
              )
            )
          }
        }
      }
    } catch (e) {
      setMsgs((m) =>
        m.map((x) =>
          x.id === id ? { ...x, content: `Something went wrong: ${(e as Error).message}` } : x
        )
      )
    } finally {
      setStage(null)
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex h-dvh w-full max-w-3xl flex-col">
      <header className="flex items-baseline gap-2 border-b px-4 py-3">
        <h1 className="text-sm font-semibold tracking-tight">TrustAI</h1>
        <p className="text-xs text-muted-foreground">
          Answers checked against evidence we retrieve ourselves
        </p>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-6">
        {msgs.length === 0 && <Empty onPick={send} />}

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
                  <TrustBadge
                    label={m.verdict.label}
                    score={m.verdict.score}
                    open={openId === m.id}
                    onClick={() => setOpenId(openId === m.id ? null : m.id)}
                  />
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
          Every claim is checked against pages we search for and read independently.
        </p>
      </form>
    </div>
  )
}

function Empty({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="mx-auto max-w-lg pt-10 text-center">
      <h2 className="text-lg font-semibold tracking-tight">A chat that shows its work</h2>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Every answer is checked against pages we find and read ourselves, then labelled{' '}
        <span className="text-emerald-600 dark:text-emerald-400">Certain</span>,{' '}
        <span className="text-amber-600 dark:text-amber-400">Uncertain</span> or{' '}
        <span className="text-rose-600 dark:text-rose-400">Needs verification</span>.
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
