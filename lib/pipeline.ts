/** The verification pipeline. Emits StreamEvents as each stage lands. */

import { generate, judgeJson, toContents, JUDGE_MODEL, MODEL } from '@/lib/gemini/client'
import { buildSources } from '@/lib/sources'
import { findEvidence } from '@/lib/search'
import { fuse } from '@/lib/signals'
import { resolvePerplexity } from '@/lib/perplexity'
import type {
  ChatRequest, StreamEvent, Claim, MessageKind, FetchedPage, Source,
  EvidenceLocation,
} from '@/lib/types'

type Emit = (e: StreamEvent) => void

/** Gate 0 + 0b — is this factual, and resolve pronouns against history. */
async function gate(messages: ChatRequest['messages']) {
  const history = messages.slice(-6).map((m) => `${m.role}: ${m.content}`).join('\n')
  const r = await judgeJson<{ kind: MessageKind; standalone: string }>(
    `Classify the user's LAST message and rewrite it as a self-contained question.\n` +
    `kind: FACTUAL (asks for checkable facts) | OPINION | CREATIVE | META (about the chat itself) | SOCIAL (greeting/thanks).\n` +
    `standalone: resolve every pronoun using the conversation. Keep the original wording otherwise.\n\n` +
    `Conversation:\n${history}`,
    {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['FACTUAL', 'OPINION', 'CREATIVE', 'META', 'SOCIAL'] },
        standalone: { type: 'string' },
      },
      required: ['kind', 'standalone'],
    }
  )
  const last = messages[messages.length - 1]?.content ?? ''
  return { kind: r?.kind ?? 'FACTUAL', standalone: r?.standalone || last }
}

function splitSentences(text: string): { text: string; span: [number, number] }[] {
  const out: { text: string; span: [number, number] }[] = []
  const re = /[^.!?]+[.!?]+(\s|$)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const s = m[0].trim()
    if (s.length > 3) out.push({ text: s, span: [m.index, m.index + m[0].length] })
  }
  if (!out.length && text.trim()) out.push({ text: text.trim(), span: [0, text.length] })
  return out
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * C2 — locate the model's quote in the page we actually fetched.
 *
 * Returns null when the quote is not there, which is the catch this whole
 * project is built around. When it is there, we report exactly where, so the
 * evidence can be opened and checked rather than taken on trust.
 *
 * `page.text` is already whitespace-collapsed, so offsets found here are real
 * offsets into that text and can be used for context and deep links.
 */
function locateQuote(
  quote: string,
  page: FetchedPage,
  sourceId: string
): EvidenceLocation | null {
  const q = quote.replace(/\s+/g, ' ').trim()
  if (!q || q.length < 12 || !page.text) return null

  const hay = page.text
  const lowerHay = hay.toLowerCase()
  let offset = lowerHay.indexOf(q.toLowerCase())
  let method: 'exact' | 'fuzzy' = 'exact'
  let matchedLength = q.length

  if (offset < 0) {
    // Fuzzy: require 90% of the quote's 4-word shingles to appear, and take the
    // earliest hit as the anchor so context lands in the right place.
    const w = q.toLowerCase().split(' ')
    if (w.length < 4) return null
    let hits = 0, total = 0, first = -1
    for (let i = 0; i <= w.length - 4; i++) {
      total++
      const at = lowerHay.indexOf(w.slice(i, i + 4).join(' '))
      if (at >= 0) { hits++; if (first < 0) first = at }
    }
    if (!total || hits / total < 0.9 || first < 0) return null
    offset = first
    method = 'fuzzy'
    matchedLength = Math.min(q.length, hay.length - offset)
  }

  const matchedText = hay.slice(offset, offset + matchedLength)

  // Nearest heading appearing before the match.
  let section: string | null = null
  let best = -1
  for (const h of page.headings) {
    const at = lowerHay.indexOf(h.toLowerCase())
    if (at >= 0 && at <= offset && at > best) { best = at; section = h }
  }

  // Text fragment link. Use the real page substring, never the model's wording,
  // or the browser will fail to find it.
  const frag = matchedText.split(' ').slice(0, 12).join(' ')
  const deepLink = `${page.url}#:~:text=${encodeURIComponent(frag)}`

  return {
    sourceId,
    offset,
    position: hay.length ? offset / hay.length : 0,
    section,
    contextBefore: hay.slice(Math.max(0, offset - 180), offset),
    contextAfter: hay.slice(offset + matchedLength, offset + matchedLength + 180),
    matchedText,
    deepLink,
    method,
  }
}

const STOPWORD_CAPS = /^(The|This|That|It|He|She|They|A|An|In|On|At|Of|But|And)$/

/**
 * Does this page independently assert the same fact?
 *
 * Verbatim matching is the right test for "did the model invent this quote",
 * but the wrong test for corroboration - two outlets state the same fact in
 * different words. So we check the claim's distinctive content instead: proper
 * nouns, numbers and years. A page carrying nearly all of them is asserting the
 * same thing, however it is phrased.
 */
function corroborates(claim: string, page: FetchedPage): boolean {
  if (!page.text) return false

  const matches = claim.match(/[A-Z][a-z]{2,}|\d[\d.,]*/g) ?? []
  const entities = [
    ...new Set(
      matches
        .filter((t) => !STOPWORD_CAPS.test(t))
        .map((t) => t.toLowerCase().replace(/[.,]+$/, ''))
    ),
  ]
  if (entities.length < 2) return false

  const hay = page.text.toLowerCase()
  const hits = entities.filter((e) => hay.includes(e)).length
  return hits / entities.length >= 0.8
}

async function verifyClaims(
  sentences: { text: string; span: [number, number] }[],
  sources: Source[],
  pages: FetchedPage[],
  emit: Emit
): Promise<Claim[]> {
  const usable = sources.map((s, i) => ({ s, p: pages[i] })).filter((x) => !x.p.failed && x.p.text)

  const claims: Claim[] = []
  for (let i = 0; i < sentences.length; i++) {
    const sent = sentences[i]
    const base: Claim = {
      id: `c${i + 1}`, text: sent.text, standalone: sent.text, span: sent.span,
      verdict: 'UNCHECKED', quote: null, quoteVerified: false, sourceIds: [],
      location: null, note: null,
    }

    if (!usable.length) {
      base.verdict = 'NOT_FOUND'
      base.note = 'No source was available for this sentence'
      claims.push(base); emit({ type: 'claim', claim: base }); continue
    }

    emit({ type: 'stage', stage: 'verifying', detail: `Checking claim ${i + 1} of ${sentences.length}` })

    const corpus = usable
      .map((x, k) => `[${x.s.id}] ${x.p.text.slice(0, 6000)}`)
      .join('\n\n---\n\n')

    const r = await judgeJson<{
      verdict: 'SUPPORTED' | 'PARTIAL' | 'NOT_FOUND' | 'CONTRADICTED'
      quote: string
      sourceId: string
    }>(
      `You are verifying one claim against source pages.\n` +
      `Return a VERBATIM quote copied exactly from a source that supports the claim.\n` +
      `If no source supports it, return verdict NOT_FOUND and an empty quote.\n` +
      `If a source states the opposite, return CONTRADICTED.\n` +
      `Never paraphrase. Never invent a quote.\n\n` +
      `CLAIM: ${sent.text}\n\nSOURCES:\n${corpus}`,
      {
        type: 'object',
        properties: {
          verdict: { type: 'string', enum: ['SUPPORTED', 'PARTIAL', 'NOT_FOUND', 'CONTRADICTED'] },
          quote: { type: 'string' },
          sourceId: { type: 'string' },
        },
        required: ['verdict', 'quote', 'sourceId'],
      },
      { model: JUDGE_MODEL() }
    )

    if (!r) {
      base.verdict = 'UNCHECKED'
      claims.push(base); emit({ type: 'claim', claim: base }); continue
    }

    // The judge names a source, but the quote may actually sit on another page,
    // so check the named one first and then fall back to searching them all.
    const named = usable.find((x) => x.s.id === r.sourceId) ?? usable[0]
    let location = r.quote ? locateQuote(r.quote, named.p, named.s.id) : null
    let src = named
    if (r.quote && !location) {
      for (const cand of usable) {
        if (cand.s.id === named.s.id) continue
        const loc = locateQuote(r.quote, cand.p, cand.s.id)
        if (loc) { location = loc; src = cand; break }
      }
    }
    const verified = !!location

    // The judge names one source per claim, so corroboration would otherwise be
    // capped at the number of claims and nothing could ever reach Certain.
    // Check the other pages ourselves - no extra model call.
    const corroborating: string[] = []
    if (location) {
      for (const cand of usable) {
        if (cand.s.id === src.s.id) continue
        if (corroborates(sent.text, cand.p)) corroborating.push(cand.s.id)
      }
    }

    base.verdict = r.verdict === 'SUPPORTED' && !verified ? 'NOT_FOUND' : r.verdict
    base.quote = r.quote || null
    base.quoteVerified = verified
    base.location = location
    base.sourceIds = verified ? [src.s.id, ...corroborating] : []
    if (r.quote && !verified) {
      base.note = 'The model produced this quote to support the claim. It does not appear on the cited page.'
    }

    claims.push(base)
    emit({ type: 'claim', claim: base })
  }
  return claims
}

export async function runPipeline(req: ChatRequest, emit: Emit): Promise<void> {
  const started = Date.now()
  const useConsistency = req.options?.selfConsistency ?? process.env.TRUSTAI_SELF_CONSISTENCY !== 'false'
  const N = req.options?.samples ?? Number(process.env.TRUSTAI_SAMPLES || 3)
  const timeout = Number(process.env.TRUSTAI_FETCH_TIMEOUT_MS || 8000)
  // The answering model is swappable; the judge is not, so a comparison
  // measures the models being compared rather than two different graders.
  const model = req.options?.model || MODEL()

  // Gate 0 / 0b
  emit({ type: 'stage', stage: 'classifying', detail: 'Checking if this is a factual claim' })
  const { kind, standalone } = await gate(req.messages)

  if (kind !== 'FACTUAL') {
    const gen = await generate(toContents(req.messages), { temperature: 0.7, model })
    emit({ type: 'token', text: gen.text })
    emit({
      type: 'verdict',
      verdict: {
        label: 'NOT_APPLICABLE', score: 0, headline: 'Not a factual claim',
        reasons: ['This message does not assert anything that can be checked'],
        warnings: [], overrides: [], parameters: [], claims: [], sources: [],
        perplexity: null, timing: { totalMs: Date.now() - started, cached: false },
        model,
      },
    })
    return
  }

  // Generate. No Search grounding: we retrieve evidence ourselves, so the
  // model never gets to pick the sources it will be judged against.
  emit({ type: 'stage', stage: 'generating', detail: 'Asking Gemini' })
  const gen = await generate(toContents(req.messages), {
    model, logprobs: true, temperature: 0,
    systemInstruction:
      'Answer factual questions concisely in 1-4 sentences. State facts plainly. Do not add caveats about your own uncertainty.',
  })
  emit({ type: 'token', text: gen.text })

  // Independent retrieval
  emit({ type: 'stage', stage: 'resolving', detail: 'Searching for independent evidence' })
  const hits = await findEvidence(standalone, 5).catch(() => [])

  emit({
    type: 'stage', stage: 'fetching',
    detail: hits.length
      ? `Reading ${hits.length} page${hits.length === 1 ? '' : 's'}`
      : 'No sources found',
  })
  const { sources, pages } = hits.length
    ? await buildSources(hits, timeout)
    : { sources: [], pages: [] as FetchedPage[] }
  for (const s of sources) emit({ type: 'source', source: s })

  // Claims
  const sentences = splitSentences(gen.text)
  const claims = await verifyClaims(sentences, sources, pages, emit)

  // Consistency — the samples double as the perplexity estimator's input when
  // the model does not expose logprobs.
  let consistency: { agree: number; n: number; variants: string[] } | null = null
  let samples: string[] = []
  const needSamples = useConsistency || gen.avgLogprobs === null
  if (needSamples && N > 1) {
    emit({ type: 'stage', stage: 'consistency', detail: `Re-asking ${N} times` })
    try {
      const raw = await Promise.all(
        Array.from({ length: N }, () =>
          generate([{ role: 'user', parts: [{ text: standalone + '\n\nAnswer in one short sentence.' }] }],
            { temperature: 0.8, model })
            .then((r) => r.text.trim())
            .catch(() => '')
        )
      )
      const valid = raw.filter(Boolean)
      samples = valid
      const buckets = new Map<string, number>()
      for (const s of valid) {
        const key = norm(s).split(' ').slice(0, 12).join(' ')
        let found = false
        for (const k of buckets.keys()) {
          const a = new Set(k.split(' ')), b = new Set(key.split(' '))
          const inter = [...a].filter((x) => b.has(x)).length
          if (inter / Math.max(a.size, b.size) > 0.6) { buckets.set(k, buckets.get(k)! + 1); found = true; break }
        }
        if (!found) buckets.set(key, 1)
      }
      if (useConsistency) {
        const agree = Math.max(0, ...buckets.values())
        consistency = {
          agree, n: valid.length || N,
          variants: buckets.size > 1 ? [...buckets.keys()].map((k) => k.slice(0, 40)) : [],
        }
      }
    } catch { /* non-fatal */ }
  }

  // Fuse
  emit({ type: 'stage', stage: 'scoring', detail: 'Scoring' })
  // Without Gemini grounding there are no citation spans, so coverage is
  // measured by how many of our own sentences found supporting evidence.
  const citedSentences = claims.filter(
    (c) => c.sourceIds.length > 0 && c.quoteVerified
  ).length
  const verdict = fuse({
    gen, claims, sources, pages,
    question: standalone, consistency,
    perplexity: resolvePerplexity(gen, samples),
    model,
    sentenceCount: sentences.length,
    citedSentences: Math.min(citedSentences, sentences.length),
  })
  verdict.timing.totalMs = Date.now() - started

  emit({ type: 'verdict', verdict })
  emit({ type: 'stage', stage: 'done' })
}
