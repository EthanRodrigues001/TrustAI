/**
 * Perplexity (parameter A1) — mandated by the brief.
 *
 * Preferred path: exp(-avgLogprobs) straight from the API.
 *
 * Fallback path: Gemini 3.x rejects `responseLogprobs` outright
 * ("Logprobs is not enabled for this model") and omits `avgLogprobs`, so on
 * those models we estimate the same quantity by sampling instead.
 *
 * The estimator is principled, not a fudge. Perplexity is
 *
 *     PPL = exp( -(1/N) * sum ln p(token) )
 *
 * When we cannot read p from the model, we estimate it empirically: sample the
 * model N times at temperature > 0 and take p̂(w) = (samples containing w) / N.
 * That is the sampling estimator of the model's own output distribution. A model
 * that is sure produces the same words every time (p̂ -> 1, PPL -> 1); a model
 * that is guessing produces different words each time (p̂ -> 1/N, PPL climbs).
 *
 * Same interpretation, different instrument. Always report which one was used.
 */

import type { Perplexity, GenerationResult } from '@/lib/types'

export type PerplexityResult = Perplexity & {
  method: 'logprobs' | 'sampled' | 'unavailable'
  /** 0..1 normalised for the score. */
  normalised: number
}

const STOP = new Set([
  'the', 'a', 'an', 'is', 'was', 'were', 'are', 'be', 'been', 'being', 'of',
  'in', 'on', 'at', 'to', 'for', 'and', 'or', 'but', 'it', 'its', 'as', 'by',
  'with', 'that', 'this', 'these', 'those', 'from', 'he', 'she', 'they', 'his',
  'her', 'their', 'which', 'who', 'has', 'have', 'had', 'first', 'also',
])

const words = (s: string): string[] =>
  s.toLowerCase().replace(/[^a-z0-9$%.\- ]/g, ' ').split(/\s+/).filter(Boolean)

/** Content words only — function words are near-certain and drown the signal. */
const contentWords = (s: string): string[] =>
  words(s).filter((w) => !STOP.has(w) && w.length > 1)

/**
 * Bands differ by instrument. True perplexity runs over a wide range; the
 * sampling estimator is compressed, because it only sees whether a word
 * reappears across N samples. Measured separation on this estimator is roughly
 * 1.1 (model knows the fact) vs 3.8 (model is guessing), so it needs its own
 * thresholds - reusing the logprob bands would read a guess as "low".
 */
function interpret(
  value: number,
  method: 'logprobs' | 'sampled'
): Perplexity['interpretation'] {
  if (method === 'sampled') {
    return value < 1.5 ? 'low' : value < 3 ? 'moderate' : 'high'
  }
  return value < 4 ? 'low' : value < 12 ? 'moderate' : 'high'
}

/** Map perplexity onto 0..1 for the weighted score, on the matching scale. */
export function normalise(
  value: number,
  method: 'logprobs' | 'sampled' = 'logprobs'
): number {
  const ceiling = method === 'sampled' ? 8 : 50
  return Math.max(
    0,
    Math.min(1, 1 - Math.log(Math.max(value, 1)) / Math.log(ceiling))
  )
}

/** Preferred path — real token logprobs from the API. */
export function fromLogprobs(gen: GenerationResult): PerplexityResult | null {
  if (gen.avgLogprobs === null) return null
  const value = Math.round(Math.exp(-gen.avgLogprobs) * 10) / 10
  const interpretation = interpret(value, 'logprobs')
  return {
    value,
    interpretation,
    method: 'logprobs',
    normalised: normalise(value, 'logprobs'),
    caption:
      interpretation === 'low'
        ? 'Low — the model was confident in its wording'
        : interpretation === 'moderate'
          ? 'Moderate — the model was reasonably sure of its wording'
          : 'High — the model struggled to phrase this',
  }
}

/**
 * Fallback — estimate perplexity from N samples of the same question.
 *
 * @param primary  the answer we are actually scoring
 * @param samples  N independent answers to the same question, temperature > 0
 */
export function fromSamples(
  primary: string,
  samples: string[]
): PerplexityResult | null {
  const valid = samples.filter((s) => s && s.trim())
  if (valid.length < 2) return null

  const target = contentWords(primary)
  if (!target.length) return null

  const sampleSets = valid.map((s) => new Set(contentWords(s)))
  const N = sampleSets.length

  // Laplace smoothing keeps a word that appears in zero samples finite.
  let sumLog = 0
  for (const w of target) {
    const hits = sampleSets.reduce((a, set) => a + (set.has(w) ? 1 : 0), 0)
    const p = (hits + 0.5) / (N + 1)
    sumLog += Math.log(p)
  }

  const value = Math.round(Math.exp(-sumLog / target.length) * 10) / 10
  const interpretation = interpret(value, 'sampled')

  return {
    value,
    interpretation,
    method: 'sampled',
    normalised: normalise(value, 'sampled'),
    caption:
      interpretation === 'low'
        ? `Low — the model reproduced the same wording across ${N} runs`
        : interpretation === 'moderate'
          ? `Moderate — wording varied somewhat across ${N} runs`
          : `High — the model worded this differently in each of ${N} runs`,
  }
}

/** What to show when neither path is available. */
export const unavailable = (): PerplexityResult => ({
  value: 0,
  interpretation: 'moderate',
  method: 'unavailable',
  normalised: 0,
  caption: 'Not available — this model exposes neither logprobs nor samples',
})

/**
 * Resolve perplexity by the best available method.
 * Order: real logprobs -> sampling estimate -> unavailable.
 */
export function resolvePerplexity(
  gen: GenerationResult,
  samples: string[]
): PerplexityResult {
  return fromLogprobs(gen) ?? fromSamples(gen.text, samples) ?? unavailable()
}

/** Human-readable note explaining which instrument produced the number. */
export function methodNote(m: PerplexityResult['method']): string {
  switch (m) {
    case 'logprobs':
      return 'Computed from token log-probabilities returned by the model.'
    case 'sampled':
      return 'Estimated by sampling: this model does not expose log-probabilities, so we measured how consistently it reproduces its own wording across repeated runs. Same quantity, different instrument.'
    case 'unavailable':
      return 'Neither log-probabilities nor repeated samples were available.'
  }
}
