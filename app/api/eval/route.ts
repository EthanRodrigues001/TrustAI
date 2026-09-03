import { runPipeline } from '@/lib/pipeline'
import seed from '@/data/seed.json'
import type { StreamEvent, Verdict, Label } from '@/lib/types'

export const runtime = 'nodejs'
export const maxDuration = 300

export type EvalCase = {
  id: string
  question: string
  expected: Label
  exercises: string
  why: string
}

export type EvalResult = EvalCase & {
  predicted: Label
  match: boolean
  score: number
  headline: string
  /** The deciding evidence: what the judge actually found on the page. */
  evidence: {
    claim: string
    verdict: string
    quote: string | null
    quoteVerified: boolean
    domain: string | null
  }[]
  overrides: string[]
  ms: number
}

export type EvalEvent =
  | { type: 'start'; total: number }
  | { type: 'case'; result: EvalResult }
  | { type: 'summary'; correct: number; total: number; accuracy: number; matrix: Record<string, Record<string, number>> }
  | { type: 'error'; id: string; message: string }

export async function GET(request: Request) {
  const url = new URL(request.url)
  const model = url.searchParams.get('model') || undefined
  const only = url.searchParams.get('only')

  const cases = (seed.cases as EvalCase[]).filter((c) => !only || c.id === only)
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: EvalEvent) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`))

      emit({ type: 'start', total: cases.length })

      const matrix: Record<string, Record<string, number>> = {}
      let correct = 0

      for (const c of cases) {
        const t0 = Date.now()
        let verdict: Verdict | null = null

        try {
          await runPipeline(
            {
              messages: [{ role: 'user', content: c.question }],
              options: { model, selfConsistency: true, samples: 3 },
            },
            (ev: StreamEvent) => {
              if (ev.type === 'verdict') verdict = ev.verdict
            }
          )
        } catch (e) {
          emit({ type: 'error', id: c.id, message: (e as Error).message })
          continue
        }

        if (!verdict) {
          emit({ type: 'error', id: c.id, message: 'no verdict produced' })
          continue
        }

        const v = verdict as Verdict
        const match = v.label === c.expected
        if (match) correct++

        matrix[c.expected] ??= {}
        matrix[c.expected][v.label] = (matrix[c.expected][v.label] ?? 0) + 1

        emit({
          type: 'case',
          result: {
            ...c,
            predicted: v.label,
            match,
            score: v.score,
            headline: v.headline,
            evidence: v.claims.map((cl) => ({
              claim: cl.text,
              verdict: cl.verdict,
              quote: cl.quote,
              quoteVerified: cl.quoteVerified,
              domain:
                v.sources.find((s) => cl.sourceIds.includes(s.id))?.domain ?? null,
            })),
            overrides: v.overrides.map((o) => o.message),
            ms: Date.now() - t0,
          },
        })
      }

      emit({
        type: 'summary',
        correct,
        total: cases.length,
        accuracy: cases.length ? correct / cases.length : 0,
        matrix,
      })
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
    },
  })
}
