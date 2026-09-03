/** Signal computation (Groups A–E) and fusion. See context/05-parameters.md. */

import type {
  Claim, Source, Parameter, Override, Label, Verdict,
  GenerationResult, FetchedPage, Volatility,
} from '@/lib/types'
import { type PerplexityResult, methodNote } from '@/lib/perplexity'

const P = (
  id: string, group: Parameter['group'], groupLabel: string, name: string,
  question: string, score: number, weight: number, display: string,
  status: Parameter['status'], detail?: string
): Parameter => ({ id, group, groupLabel, name, question, score, weight, display, status, detail })

const band = (s: number): Parameter['status'] =>
  s >= 0.75 ? 'pass' : s >= 0.45 ? 'warn' : 'fail'

// ---------------------------------------------------------------- Group A

const ENTITY = /^[\s"'(]*(?:[A-Z][\w'-]+|\d[\d,.%$€£]*)/

/** A2 + A3 — weakest token, and confidence over entity tokens only. */
export function tokenSignals(gen: GenerationResult) {
  const toks = gen.tokens
  if (!toks.length) return { weakest: null, entity: null }

  let min = toks[0]
  for (const t of toks) if (t.logprob < min.logprob) min = t

  const ents = toks.filter((t) => ENTITY.test(t.token))
  const entity = ents.length
    ? Math.exp(ents.reduce((a, t) => a + t.logprob, 0) / ents.length)
    : null

  return { weakest: { token: min.token.trim(), p: Math.exp(min.logprob) }, entity }
}

// ---------------------------------------------------------------- Group E

export function volatilityOf(question: string): Volatility {
  const q = question.toLowerCase()
  if (/\b(current|currently|now|today|latest|newest|right now|as of|this year|price|stock|ceo|president|prime minister)\b/.test(q)) return 'VOLATILE'
  if (/\b(population|revenue|market share|number of|how many)\b/.test(q)) return 'SLOW'
  return 'STATIC'
}

// ---------------------------------------------------------------- fusion

type Inputs = {
  gen: GenerationResult
  claims: Claim[]
  sources: Source[]
  pages: FetchedPage[]
  question: string
  consistency: { agree: number; n: number; variants: string[] } | null
  sentenceCount: number
  citedSentences: number
  perplexity: PerplexityResult
}

export function fuse(inp: Inputs): Verdict {
  const { gen, claims, sources, question, consistency } = inp
  const params: Parameter[] = []
  const overrides: Override[] = []
  const warnings: string[] = []
  const reasons: string[] = []

  const ppx = inp.perplexity
  const { weakest, entity } = tokenSignals(gen)
  const live = sources.filter((s) => !s.fetchFailed)
  const unique = sources.filter((s) => !s.duplicateOf && !s.fetchFailed)
  const vol = volatilityOf(question)

  // ---- Group A
  params.push(P('A1', 'A', 'Answer confidence', 'Perplexity',
    'How surprised was the model by its own words?',
    ppx.normalised,
    ppx.method === 'unavailable' ? 0 : 0.05,
    ppx.method === 'unavailable'
      ? 'Not available for this model'
      : `${ppx.value} — ${ppx.interpretation}${ppx.method === 'sampled' ? ' (estimated by sampling)' : ''}`,
    ppx.method === 'unavailable' ? 'skipped' : 'info',
    methodNote(ppx.method) +
    ' Perplexity measures fluency, not truth — a confident-sounding fabrication scores low here too.'))
  if (weakest) {
    params.push(P('A2', 'A', 'Answer confidence', 'Weakest token',
      "Where is the answer's most fragile word?",
      weakest.p, 0.03,
      `Least certain word: "${weakest.token}" (${Math.round(weakest.p * 100)}%)`,
      band(weakest.p)))
  }
  if (entity !== null) {
    params.push(P('A3', 'A', 'Answer confidence', 'Entity confidence',
      'How confident on the parts that can actually be wrong?',
      entity, 0.07,
      `${Math.round(entity * 100)}% average on names, dates and numbers`,
      band(entity),
      'Function words are always near-certain and hide the signal. Fabrications concentrate in entities.'))
  }
  const hedges = (gen.text.match(/\b(likely|around|approximately|roughly|I believe|may have|as of my)\b/gi) || []).length
  params.push(P('A4', 'A', 'Answer confidence', 'Hedging language',
    'Is the model hedging in its own words?',
    hedges ? 0.5 : 1, 0,
    hedges ? `The model hedged ${hedges} time${hedges > 1 ? 's' : ''}` : 'No hedging language',
    'info'))

  // ---- Group B
  if (consistency) {
    const s = consistency.agree / consistency.n
    params.push(P('B1', 'B', 'Consistency', 'Semantic agreement',
      'Does the model agree with itself?', s, 0.15,
      `${consistency.agree} of ${consistency.n} runs gave the same answer`, band(s)))
    if (consistency.variants.length > 1) {
      params.push(P('B2', 'B', 'Consistency', 'Entity stability',
        'Does the key fact flip between runs?', 0, 0,
        `Answer varied across runs: ${consistency.variants.join(' / ')}`, 'fail',
        'A model that knows a fact repeats it. A model that is guessing produces a different one each time.'))
    }
  } else {
    params.push(P('B1', 'B', 'Consistency', 'Semantic agreement',
      'Does the model agree with itself?', 0, 0,
      'Self-consistency check was turned off', 'skipped'))
  }

  // ---- Group C
  const cov = inp.sentenceCount ? inp.citedSentences / inp.sentenceCount : 0
  params.push(P('C1', 'C', 'Evidence', 'Citation coverage',
    'How much of the answer is backed by any source?', cov, 0.15,
    `${inp.citedSentences} of ${inp.sentenceCount} sentences cite a source`, band(cov)))

  const checked = claims.filter((c) => c.verdict !== 'UNCHECKED')
  const supported = claims.filter((c) => c.verdict === 'SUPPORTED').length
  const partial = claims.filter((c) => c.verdict === 'PARTIAL').length
  const contradicted = claims.filter((c) => c.verdict === 'CONTRADICTED')
  const fabricated = claims.filter((c) => c.quote && !c.quoteVerified)
  const c2 = checked.length ? (supported + partial * 0.5) / checked.length : 0

  params.push(P('C2', 'C', 'Evidence', 'Quote verification',
    'Does the cited page actually say this?', c2, 0.35,
    checked.length
      ? `${supported} of ${checked.length} claims verified word-for-word on the page`
      : 'Nothing to verify — no sources',
    checked.length ? band(c2) : 'skipped',
    'We re-fetch every cited page, demand a verbatim supporting quote, then check that quote really appears in the page text.'))

  if (fabricated.length) {
    warnings.push(`A quote was fabricated — the cited page does not contain it`)
  }

  const leaks = claims.filter((c) => c.note?.includes('appears in no source'))
  params.push(P('C3', 'C', 'Evidence', 'Specificity leak',
    'Did the model invent a detail no source contains?',
    leaks.length ? 0 : 1, 0.05,
    leaks.length ? `${leaks.length} detail(s) appear in no source` : 'Every name and date appears in a source',
    leaks.length ? 'fail' : 'pass'))

  params.push(P('C4', 'C', 'Evidence', 'Contradiction',
    'Does any source say the opposite?',
    contradicted.length ? 0 : 1, 0,
    contradicted.length ? 'A source contradicts this answer' : 'No source contradicts the answer',
    contradicted.length ? 'fail' : 'pass'))

  const conf = gen.grounding?.groundingSupports?.flatMap((s) => s.confidenceScores ?? []) ?? []
  const c5 = conf.length ? conf.reduce((a, b) => a + b, 0) / conf.length : 0
  params.push(P('C5', 'C', 'Evidence', 'Grounding confidence',
    "How confident is Gemini's own source linkage?", c5, 0.05,
    conf.length ? `${Math.round(c5 * 100)}% average linkage confidence` : 'Not reported',
    conf.length ? band(c5) : 'skipped'))

  // ---- Group D
  const d1 = live.length ? live.reduce((a, s) => a + s.trustScore, 0) / live.length : 0
  const tierCounts = live.reduce<Record<string, number>>((a, s) => {
    a[s.tierLabel] = (a[s.tierLabel] || 0) + 1; return a
  }, {})
  params.push(P('D1', 'D', 'Sources', 'Domain tier',
    'Are these good sources?', d1, 0.12,
    live.length
      ? Object.entries(tierCounts).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(', ')
      : 'No sources',
    live.length ? band(d1) : 'skipped'))

  const goodUnique = unique.filter((s) => s.trustScore >= 0.65).length
  const d2 = goodUnique === 0 ? 0 : goodUnique === 1 ? 0.5 : goodUnique === 2 ? 0.8 : 1
  params.push(P('D2', 'D', 'Sources', 'Corroboration',
    'How many independent good sources agree?', d2, 0.05,
    goodUnique ? `${goodUnique} independent source${goodUnique > 1 ? 's' : ''} agree` : 'No source supports the claim',
    band(d2)))

  const dupes = sources.filter((s) => s.duplicateOf).length
  params.push(P('D3', 'D', 'Sources', 'Independence',
    'Are these sources actually independent?',
    sources.length ? unique.length / Math.max(sources.length, 1) : 1, 0,
    dupes
      ? `${sources.length} sources, but ${dupes} are the same wire story — counted as ${unique.length}`
      : `All ${sources.length} sources are genuinely separate`,
    dupes ? 'warn' : 'pass',
    'Sites sharing over 80% of their text are carrying the same news agency copy. We count them once.'))

  const newest = live.map((s) => s.publishedAt).filter(Boolean).sort().reverse()[0]
  const ageDays = newest ? (Date.now() - Date.parse(newest)) / 86400000 : null
  const stale = vol === 'VOLATILE' && (ageDays === null || ageDays > 90)
  params.push(P('D4', 'D', 'Sources', 'Recency',
    'Is the evidence current enough?', stale ? 0.25 : 1, 0.03,
    ageDays !== null
      ? `Newest source is ${Math.round(ageDays)} days old`
      : vol === 'STATIC' ? 'Not time-sensitive — age does not matter here' : 'No publication dates found',
    stale ? 'fail' : 'pass'))

  // ---- Group E
  params.push(P('E1', 'E', 'Question type', 'Volatility',
    'Can the true answer change over time?',
    vol === 'STATIC' ? 1 : vol === 'SLOW' ? 0.6 : 0.2, 0,
    vol === 'STATIC' ? 'Static fact — the answer will not change'
      : vol === 'SLOW' ? 'Slow-changing fact'
        : 'Time-sensitive — this can change without notice',
    vol === 'VOLATILE' ? 'warn' : 'pass'))

  params.push(P('E2', 'E', 'Question type', 'Grounding coverage',
    'Did the model search at all?', sources.length ? 1 : 0, 0,
    sources.length ? `Searched the web and used ${sources.length} page${sources.length > 1 ? 's' : ''}`
      : 'No sources — answered from training data alone',
    sources.length ? 'pass' : 'fail'))

  // ---- weighted score
  const weighted = params.filter((p) => p.weight > 0)
  const total = weighted.reduce((a, p) => a + p.weight, 0)
  let score = total ? weighted.reduce((a, p) => a + p.score * p.weight, 0) / total : 0

  let label: Label = score >= 0.75 ? 'CERTAIN' : score >= 0.45 ? 'UNCERTAIN' : 'NEEDS_VERIFICATION'
  const cap = (l: Label, rule: Override['rule'], message: string) => {
    const rank: Label[] = ['NEEDS_VERIFICATION', 'UNCERTAIN', 'CERTAIN', 'NOT_APPLICABLE']
    if (rank.indexOf(label) > rank.indexOf(l)) label = l
    overrides.push({ rule, message, cappedAt: l })
  }

  if (contradicted.length) cap('NEEDS_VERIFICATION', 'CONTRADICTED', 'A source contradicts this claim')
  if (fabricated.length) cap('NEEDS_VERIFICATION', 'SPECIFICITY_LEAK', 'The model produced a quote that is not on the cited page')
  if (!sources.length) cap('UNCERTAIN', 'NO_GROUNDING', 'No sources were consulted, so nothing could be verified')
  if (sources.length && !live.length) cap('UNCERTAIN', 'ALL_SOURCES_UNVERIFIED', 'None of the cited pages could be read')
  if (leaks.length) cap('UNCERTAIN', 'SPECIFICITY_LEAK', 'The answer contains a detail that appears in no source')
  if (stale) cap('UNCERTAIN', 'VOLATILE_STALE', 'This answer can change over time and no source is recent')
  if (goodUnique === 1) cap('UNCERTAIN', 'SINGLE_SOURCE', 'Only one independent source supports this')

  // ---- narrative
  if (supported) reasons.push(`${supported} of ${checked.length} claims were verified against the pages that were cited`)
  if (fabricated.length) reasons.push('The model produced a supporting quote that does not appear on the page')
  if (goodUnique >= 2) reasons.push(`${goodUnique} independent sources agree`)
  if (consistency) reasons.push(`The model gave the same answer in ${consistency.agree} of ${consistency.n} runs`)
  if (!sources.length) reasons.push('The model did not search the web for this answer')
  if (dupes) warnings.push(`${sources.length} sources found, but only ${unique.length} are genuinely independent`)
  if (sources.some((s) => s.fetchFailed)) warnings.push(`${sources.filter((s) => s.fetchFailed).length} source could not be verified`)
  if (label === 'NEEDS_VERIFICATION') warnings.push('Do not rely on this answer without checking it yourself')

  const headline =
    label === 'CERTAIN' ? `Confirmed by ${goodUnique} independent source${goodUnique > 1 ? 's' : ''}`
      : label === 'UNCERTAIN' ? (overrides[0]?.message ?? 'Partially supported — verify before relying on it')
        : fabricated.length ? 'The cited page does not contain this claim'
          : 'Not enough evidence to trust this answer'

  return {
    label, score: Math.round(score * 100) / 100,
    headline, reasons: reasons.slice(0, 4), warnings, overrides, parameters: params,
    claims, sources,
    perplexity: ppx.method === 'unavailable'
      ? null
      : { value: ppx.value, interpretation: ppx.interpretation, caption: ppx.caption },
    timing: { totalMs: 0, cached: false },
    searchSuggestionHtml: gen.grounding?.searchEntryPoint?.renderedContent ?? null,
  }
}
