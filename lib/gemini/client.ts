/**
 * Minimal Gemini REST client. No SDK — one dependency-free fetch wrapper so we
 * can see exactly what comes back (grounding metadata and logprobs especially).
 */

import type {
  GenerationResult,
  GroundingMetadata,
  LogprobToken,
} from '@/lib/types'

const BASE = 'https://generativelanguage.googleapis.com/v1beta'

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown
  ) {
    super(message)
    this.name = 'GeminiError'
  }
}

export function apiKey(): string {
  const k = process.env.GEMINI_API_KEY
  if (!k) throw new GeminiError('GEMINI_API_KEY is not set', 0)
  return k
}

export const MODEL = () => process.env.GEMINI_MODEL || 'gemini-2.5-flash'
export const JUDGE_MODEL = () =>
  process.env.GEMINI_JUDGE_MODEL || 'gemini-2.5-flash-lite'

export type GenerateOptions = {
  model?: string
  /** Enable Grounding with Google Search. */
  search?: boolean
  /** Ask for token logprobs. May be unsupported alongside search. */
  logprobs?: boolean
  temperature?: number
  systemInstruction?: string
  /** Structured output: a JSON schema the response must conform to. */
  responseSchema?: Record<string, unknown>
  signal?: AbortSignal
  /** Internal retry counter for transient 503/429. */
  _attempt?: number
}

type GeminiContent = { role: 'user' | 'model'; parts: { text: string }[] }

export function toContents(
  messages: { role: 'user' | 'assistant'; content: string }[]
): GeminiContent[] {
  return messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))
}

/**
 * Models that rejected `responseLogprobs` with
 * 400 "Logprobs is not enabled for this model".
 *
 * Every Gemini 3.x model tested does this, so we remember and stop asking
 * rather than burning a failed request per call. Perplexity then falls back to
 * the sampling estimator in lib/perplexity.ts.
 */
const noLogprobs = new Set<string>()

export const supportsLogprobs = (model = MODEL()) => !noLogprobs.has(model)

/**
 * Single non-streaming generation. Returns the text plus everything we need for
 * the signal bank: avgLogprobs, per-token logprobs, grounding metadata.
 *
 * If the model rejects logprobs, retries once without them so the pipeline
 * degrades instead of failing.
 */
export async function generate(
  contents: GeminiContent[],
  opts: GenerateOptions = {}
): Promise<GenerationResult> {
  const model = opts.model || MODEL()
  const wantLogprobs = !!opts.logprobs && !noLogprobs.has(model)

  const generationConfig: Record<string, unknown> = {
    temperature: opts.temperature ?? 0,
  }
  if (wantLogprobs) {
    generationConfig.responseLogprobs = true
    generationConfig.logprobs = 5
  }
  if (opts.responseSchema) {
    generationConfig.responseMimeType = 'application/json'
    generationConfig.responseSchema = opts.responseSchema
  }

  const body: Record<string, unknown> = { contents, generationConfig }
  if (opts.search) body.tools = [{ google_search: {} }]
  if (opts.systemInstruction) {
    body.systemInstruction = { parts: [{ text: opts.systemInstruction }] }
  }

  const res = await fetch(`${BASE}/models/${model}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey(),
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  })

  const json = await res.json().catch(() => null)

  if (!res.ok) {
    const msg =
      (json as { error?: { message?: string } })?.error?.message ??
      `Gemini request failed (${res.status})`

    // Model does not support logprobs — remember, then retry without them.
    if (res.status === 400 && /logprobs/i.test(msg) && wantLogprobs) {
      noLogprobs.add(model)
      return generate(contents, { ...opts, logprobs: false })
    }

    // Transient overload. These are common on the popular models and show up
    // as an empty column in the comparison view, so retry briefly rather than
    // failing the whole run.
    const attempt = opts._attempt ?? 0
    if ((res.status === 503 || res.status === 429) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 700 * (attempt + 1)))
      return generate(contents, { ...opts, _attempt: attempt + 1 })
    }

    throw new GeminiError(msg, res.status, json)
  }

  return parseResponse(json)
}

type RawCandidate = {
  content?: { parts?: { text?: string }[] }
  avgLogprobs?: number
  finishReason?: string
  groundingMetadata?: GroundingMetadata
  logprobsResult?: {
    chosenCandidates?: { token?: string; logProbability?: number }[]
  }
}

function parseResponse(json: unknown): GenerationResult {
  const cand = (json as { candidates?: RawCandidate[] })?.candidates?.[0]

  const text =
    cand?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''

  const tokens: LogprobToken[] =
    cand?.logprobsResult?.chosenCandidates
      ?.filter((c) => typeof c.logProbability === 'number')
      .map((c) => ({
        token: c.token ?? '',
        logprob: c.logProbability as number,
      })) ?? []

  return {
    text,
    avgLogprobs:
      typeof cand?.avgLogprobs === 'number' ? cand.avgLogprobs : null,
    tokens,
    grounding: cand?.groundingMetadata ?? null,
    finishReason: cand?.finishReason ?? null,
  }
}

/**
 * Structured-output helper for the judge model. Returns parsed JSON of type T,
 * or null when the model produced something unparseable.
 */
export async function judgeJson<T>(
  prompt: string,
  schema: Record<string, unknown>,
  opts: GenerateOptions = {}
): Promise<T | null> {
  const r = await generate([{ role: 'user', parts: [{ text: prompt }] }], {
    model: opts.model || JUDGE_MODEL(),
    temperature: 0,
    responseSchema: schema,
    ...opts,
  })
  try {
    return JSON.parse(r.text) as T
  } catch {
    return null
  }
}
