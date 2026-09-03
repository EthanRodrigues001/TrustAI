/**
 * TrustAI — shared contract types.
 *
 * This file IS the backend/frontend boundary described in
 * `context/06-api-contract.md`. Frontend imports from here.
 * Changing anything in this file is a breaking change — announce it.
 */

// ---------------------------------------------------------------- request

export type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type ChatRequest = {
  messages: ChatMessage[]
  options?: {
    /** Group B self-consistency. Off is ~3x faster. */
    selfConsistency?: boolean
    /** N samples for B1. */
    samples?: number
    /** Override the answering model. Judge model is unaffected. */
    model?: string
  }
}

/** Models offered in the comparison view. */
export const COMPARE_MODELS = [
  { id: 'gemini-3.5-flash-lite', label: 'Flash Lite 3.5', note: 'small, fast' },
  { id: 'gemini-3.6-flash', label: 'Flash 3.6', note: 'larger' },
  { id: 'gemini-3.5-flash', label: 'Flash 3.5', note: 'larger' },
  { id: 'gemini-3.1-flash-lite', label: 'Flash Lite 3.1', note: 'older, small' },
] as const

// ---------------------------------------------------------------- labels

export type Label =
  | 'CERTAIN'
  | 'UNCERTAIN'
  | 'NEEDS_VERIFICATION'
  /** Greeting, opinion, creative, meta — no score, no sources. */
  | 'NOT_APPLICABLE'

export type MessageKind = 'FACTUAL' | 'OPINION' | 'CREATIVE' | 'META' | 'SOCIAL'

export type ClaimVerdict =
  | 'SUPPORTED'
  | 'PARTIAL'
  | 'NOT_FOUND'
  | 'CONTRADICTED'
  | 'UNCHECKED'

export type Tier = 'T0' | 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'T6'

export type Badge =
  | 'official'
  | 'gov'
  | 'reliable'
  | 'mixed'
  | 'unknown'
  | 'low'

// ---------------------------------------------------------------- pieces

export type Parameter = {
  /** Stable id matching context/05-parameters.md — 'C2', 'B1', 'D1'. */
  id: string
  group: 'A' | 'B' | 'C' | 'D' | 'E'
  groupLabel: string
  name: string
  question: string
  /** 0..1, higher = more trustworthy. */
  score: number
  /** 0..1 contribution to the fused score. 0 for display-only params. */
  weight: number
  /** Finished display string — never build sentences in the UI. */
  display: string
  status: 'pass' | 'warn' | 'fail' | 'skipped' | 'info'
  detail?: string
}

export type OverrideRule =
  | 'CONTRADICTED'
  | 'NO_GROUNDING'
  | 'ALL_SOURCES_UNVERIFIED'
  | 'SPECIFICITY_LEAK'
  | 'VOLATILE_STALE'
  | 'SINGLE_SOURCE'
  | 'CUTOFF_GAP'

export type Override = {
  rule: OverrideRule
  message: string
  cappedAt: Label
}

export type Claim = {
  id: string
  /** As it appears in the answer. */
  text: string
  /** Coref-resolved: "he" -> "Guido van Rossum". */
  standalone: string
  /** Char offsets into the final answer string, for inline underlining. */
  span: [number, number]
  verdict: ClaimVerdict
  /** Verbatim supporting text the judge returned, or null. */
  quote: string | null
  /** Did that quote actually string-match the fetched page? */
  quoteVerified: boolean
  sourceIds: string[]
  note: string | null
}

export type Source = {
  id: string
  /** Resolved publisher URL, never the Gemini redirect. */
  url: string
  domain: string
  title: string
  tier: Tier
  tierLabel: string
  trustScore: number
  badge: Badge
  snippet: string
  publishedAt: string | null
  /** Escalation-chain audit trail — how we classified this domain. */
  verificationPath: string[]
  /** Set when this is the same wire story as another source. */
  duplicateOf: string | null
  fetchFailed: boolean
}

export type Perplexity = {
  value: number
  interpretation: 'low' | 'moderate' | 'high'
  caption: string
}

export type Verdict = {
  label: Label
  /** 0..1 fused support score. 0 when NOT_APPLICABLE. */
  score: number
  headline: string
  reasons: string[]
  warnings: string[]
  overrides: Override[]
  parameters: Parameter[]
  claims: Claim[]
  sources: Source[]
  perplexity: Perplexity | null
  timing: { totalMs: number; cached: boolean }
  /** Which model produced the answer being judged. */
  model: string
  /** Google requires rendering this when using Search grounding. */
  searchSuggestionHtml?: string | null
}

// ---------------------------------------------------------------- stream

export type Stage =
  | 'classifying'
  | 'generating'
  | 'resolving'
  | 'fetching'
  | 'verifying'
  | 'consistency'
  | 'scoring'
  | 'done'

export type StreamEvent =
  | { type: 'stage'; stage: Stage; detail?: string }
  | { type: 'token'; text: string }
  | { type: 'claims'; claims: Claim[] }
  | { type: 'claim'; claim: Claim }
  | { type: 'source'; source: Source }
  | { type: 'verdict'; verdict: Verdict }
  | { type: 'error'; message: string; fatal: boolean }

// ---------------------------------------------------------------- internal
// Below here is backend-only. The frontend does not need these.

/** Raw grounding data as returned by the Gemini API. */
export type GroundingChunk = {
  web?: { uri: string; title?: string; domain?: string }
}

export type GroundingSupport = {
  segment?: { startIndex?: number; endIndex?: number; text?: string }
  groundingChunkIndices?: number[]
  confidenceScores?: number[]
}

export type GroundingMetadata = {
  groundingChunks?: GroundingChunk[]
  groundingSupports?: GroundingSupport[]
  webSearchQueries?: string[]
  searchEntryPoint?: { renderedContent?: string }
}

export type LogprobToken = { token: string; logprob: number }

export type GenerationResult = {
  text: string
  avgLogprobs: number | null
  tokens: LogprobToken[]
  grounding: GroundingMetadata | null
  finishReason: string | null
}

/** A page we actually re-fetched, ready for quote matching. */
export type FetchedPage = {
  url: string
  domain: string
  title: string
  text: string
  /** First readable paragraph, for display. */
  snippet: string
  publishedAt: string | null
  failed: boolean
  error?: string
}

export type Volatility = 'STATIC' | 'SLOW' | 'VOLATILE'
