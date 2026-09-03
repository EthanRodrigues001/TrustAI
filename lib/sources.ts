/** Source resolution, fetching and trust scoring (Group D). */

import type { Source, FetchedPage, Tier, Badge } from '@/lib/types'

/** Anything we can turn into a Source: our own search hits, or Gemini chunks. */
export type Candidate = { url: string; title?: string; snippet?: string }

const TIER_SCORE: Record<Tier, number> = {
  T0: 1, T1: 0.95, T2: 0.85, T3: 0.65, T4: 0.4, T5: 0.15, T6: 0,
}
const TIER_LABEL: Record<Tier, string> = {
  T0: 'Official', T1: 'Government', T2: 'Reliable', T3: 'Encyclopedia',
  T4: 'Unknown', T5: 'Low quality', T6: 'Unreliable',
}
const TIER_BADGE: Record<Tier, Badge> = {
  T0: 'official', T1: 'gov', T2: 'reliable', T3: 'mixed',
  T4: 'unknown', T5: 'low', T6: 'low',
}

/** Seeded from Wikipedia WP:RSP + standards bodies. Extend freely. */
const REGISTRY: Record<string, Tier> = {
  'python.org': 'T0', 'nodejs.org': 'T0', 'developer.mozilla.org': 'T0',
  'w3.org': 'T1', 'ietf.org': 'T1', 'nist.gov': 'T1', 'who.int': 'T1',
  'un.org': 'T1', 'nasa.gov': 'T1', 'sec.gov': 'T1', 'europa.eu': 'T1',
  'reuters.com': 'T2', 'apnews.com': 'T2', 'bbc.com': 'T2', 'bbc.co.uk': 'T2',
  'nature.com': 'T2', 'science.org': 'T2', 'britannica.com': 'T2',
  'ft.com': 'T2', 'economist.com': 'T2', 'npr.org': 'T2', 'theguardian.com': 'T2',
  'nytimes.com': 'T2', 'washingtonpost.com': 'T2', 'wsj.com': 'T2',
  'thehindu.com': 'T2', 'indianexpress.com': 'T2',
  'wikipedia.org': 'T3', 'stackoverflow.com': 'T3', 'github.com': 'T3',
  'arstechnica.com': 'T3', 'theverge.com': 'T3', 'techcrunch.com': 'T3',
  'timesofindia.indiatimes.com': 'T3',
  'medium.com': 'T4', 'quora.com': 'T5', 'reddit.com': 'T5',
  'dailymail.co.uk': 'T5', 'infowars.com': 'T6', 'naturalnews.com': 'T6',
}

function baseDomain(host: string): string {
  const h = host.replace(/^www\./, '').toLowerCase()
  const p = h.split('.')
  // keep 3 parts for co.uk / ac.in style suffixes
  if (p.length > 2 && /^(co|ac|gov|org|net|edu)$/.test(p[p.length - 2])) {
    return p.slice(-3).join('.')
  }
  return p.length > 2 ? p.slice(-2).join('.') : h
}

/**
 * Gemini returns redirect URLs, not publisher domains. Resolve them.
 * Everything in Group D depends on this working.
 */
export async function resolveUrl(uri: string): Promise<string> {
  if (!/vertexaisearch|grounding-api-redirect/.test(uri)) return uri
  try {
    const r = await fetch(uri, { redirect: 'manual' })
    const loc = r.headers.get('location')
    if (loc) return loc
  } catch { /* fall through */ }
  try {
    const r = await fetch(uri, { redirect: 'follow' })
    return r.url || uri
  } catch {
    return uri
  }
}

/** Classify a domain, returning the tier and the audit trail (D1). */
export function classifyDomain(domain: string): {
  tier: Tier
  path: string[]
} {
  const path: string[] = []
  if (REGISTRY[domain]) {
    const t = REGISTRY[domain]
    path.push(`in registry: ${TIER_LABEL[t]} (${t})`)
    return { tier: t, path }
  }
  if (/\.gov(\.[a-z]{2})?$/.test(domain) || /\.mil$/.test(domain)) {
    path.push('government domain')
    return { tier: 'T1', path }
  }
  if (/\.edu(\.[a-z]{2})?$/.test(domain) || /\.ac\.[a-z]{2}$/.test(domain)) {
    path.push('academic domain')
    return { tier: 'T1', path }
  }
  if (/\.int$/.test(domain)) {
    path.push('international organisation domain')
    return { tier: 'T1', path }
  }
  path.push('not in registry')
  return { tier: 'T4', path }
}

export async function fetchPage(
  url: string,
  timeoutMs = 8000
): Promise<FetchedPage> {
  let domain = ''
  try { domain = baseDomain(new URL(url).hostname) } catch { /* ignore */ }

  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TrustAI/0.1)' },
    })
    const html = await r.text()
    const text = extractText(html)
    // Bot challenges return HTTP 200 with a placeholder body. Treat them as
    // unreadable rather than as a page that happens to say "Just a moment".
    const blocked =
      text.length < 400 &&
      /just a moment|enable javascript|attention required|verify you are human|checking your browser/i.test(text)
    return {
      url, domain,
      title: extractTitle(html),
      text,
      headings: extractHeadings(html),
      snippet: extractSnippet(html, text),
      publishedAt: extractDate(html),
      failed: !r.ok || blocked,
      error: blocked ? 'blocked by bot protection' : undefined,
    }
  } catch (e) {
    return {
      url, domain, title: '', text: '', headings: [], snippet: '', publishedAt: null,
      failed: true, error: (e as Error).message,
    }
  } finally {
    clearTimeout(t)
  }
}

function extractTitle(html: string): string {
  return html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim().slice(0, 200) ?? ''
}

function extractDate(html: string): string | null {
  const m =
    html.match(/<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)/i) ||
    html.match(/<meta[^>]+name=["']date["'][^>]+content=["']([^"']+)/i) ||
    html.match(/"datePublished"\s*:\s*"([^"]+)"/i)
  return m?.[1] ?? null
}

/** Strip to readable text. Crude but dependency-free and good enough for matching. */
export function extractText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    // page chrome, otherwise every snippet reads "Jump to content Main menu..."
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
    .replace(/<form[\s\S]*?<\/form>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40000)
}

/** Headings in document order, used to say which section a quote came from. */
export function extractHeadings(html: string): string[] {
  return [...html.matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi)]
    .map((m) => extractText(m[1]))
    .filter((t) => t.length > 2 && t.length < 120)
}

/**
 * A human-readable snippet: the first substantial <p>, falling back to the
 * plain text. Without this the snippet is whatever navigation chrome happened
 * to sit at the top of the document.
 */
export function extractSnippet(html: string, fallback: string): string {
  const paras = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => extractText(m[1]))
    .filter(
      (t) =>
        t.length > 80 &&
        !/cookie|subscribe|sign in|sign up|advertisement|lost your password|enter your email|create a new password|newsletter/i.test(t)
    )
  return (paras[0] ?? fallback).slice(0, 280)
}

/** D3 — near-duplicate detection. Three sites, one wire story. */
function similarity(a: string, b: string): number {
  const grams = (s: string) => {
    const w = s.toLowerCase().split(/\s+/).slice(0, 600)
    const g = new Set<string>()
    for (let i = 0; i < w.length - 4; i++) g.add(w.slice(i, i + 5).join(' '))
    return g
  }
  const A = grams(a), B = grams(b)
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const x of A) if (B.has(x)) inter++
  return inter / Math.min(A.size, B.size)
}

/**
 * Resolve, fetch and score every candidate source.
 * Runs the escalation chain for unknown domains.
 */
export async function buildSources(
  candidates: Candidate[],
  timeoutMs = 8000
): Promise<{ sources: Source[]; pages: FetchedPage[] }> {
  const resolved = await Promise.all(
    candidates.map(async (c, i) => ({
      i,
      url: await resolveUrl(c.url),
      title: c.title ?? '',
      snippet: c.snippet ?? '',
      hinted: undefined as string | undefined,
    }))
  )

  const pages = await Promise.all(
    resolved.map((r) => fetchPage(r.url, timeoutMs))
  )

  const sources: Source[] = resolved.map((r, i) => {
    const page = pages[i]
    const domain = page.domain || r.hinted || 'unknown'
    const { tier, path } = classifyDomain(domain)
    let score = TIER_SCORE[tier]

    if (page.failed) {
      path.push(
        page.error === 'blocked by bot protection'
          ? 'blocked by bot protection, page unreadable — contributes nothing'
          : 'page could not be fetched — contributes nothing'
      )
      score = 0
    }

    return {
      id: `s${i + 1}`,
      url: r.url,
      domain,
      title: page.title || r.title || domain,
      tier,
      tierLabel: TIER_LABEL[tier],
      trustScore: score,
      badge: TIER_BADGE[tier],
      snippet: page.snippet || r.snippet || page.text.slice(0, 240),
      publishedAt: page.publishedAt,
      verificationPath: path,
      duplicateOf: null,
      fetchFailed: page.failed,
    }
  })

  // D3 — mark near-duplicates so they are counted once.
  for (let i = 0; i < sources.length; i++) {
    for (let j = i + 1; j < sources.length; j++) {
      if (sources[j].duplicateOf) continue
      const sim = similarity(pages[i].text, pages[j].text)
      if (sim > 0.8) {
        sources[j].duplicateOf = sources[i].id
        sources[j].verificationPath.push(
          `text ${Math.round(sim * 100)}% identical to ${sources[i].id} — same wire story`
        )
      }
    }
  }

  // Escalation: an unknown domain agreeing with 2+ trusted ones gets promoted.
  const trusted = sources.filter(
    (s) => !s.duplicateOf && !s.fetchFailed && ['T0', 'T1', 'T2', 'T3'].includes(s.tier)
  ).length
  for (const s of sources) {
    if (s.tier !== 'T4' || s.fetchFailed) continue
    if (trusted >= 2) {
      s.trustScore = 0.7
      s.verificationPath.push(
        `corroborated by ${trusted} classified sources — promoted to 0.70`
      )
    } else {
      s.trustScore = 0
      s.verificationPath.push(
        trusted === 1
          ? 'only 1 classified source to corroborate against — contributes nothing'
          : 'no classified source to corroborate against — contributes nothing'
      )
    }
  }

  return { sources, pages }
}
