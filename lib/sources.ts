/** Source resolution, fetching and trust scoring (Group D). */

import type { Source, FetchedPage, Tier, Badge, GroundingChunk } from '@/lib/types'

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
    return {
      url, domain,
      title: extractTitle(html),
      text: extractText(html),
      publishedAt: extractDate(html),
      failed: !r.ok,
    }
  } catch (e) {
    return {
      url, domain, title: '', text: '', publishedAt: null,
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
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40000)
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
 * Resolve, fetch and score every grounding chunk.
 * Runs the escalation chain for unknown domains.
 */
export async function buildSources(
  chunks: GroundingChunk[],
  timeoutMs = 8000
): Promise<{ sources: Source[]; pages: FetchedPage[] }> {
  const resolved = await Promise.all(
    chunks.map(async (c, i) => {
      const raw = c.web?.uri ?? ''
      const url = c.web?.domain ? raw : await resolveUrl(raw)
      return { i, url, title: c.web?.title ?? '', hinted: c.web?.domain }
    })
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
      path.push('page could not be fetched — contributes nothing')
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
      snippet: page.text.slice(0, 240),
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
    (s) => !s.duplicateOf && !s.fetchFailed && ['T0', 'T1', 'T2'].includes(s.tier)
  ).length
  for (const s of sources) {
    if (s.tier === 'T4' && !s.fetchFailed && trusted >= 2) {
      s.trustScore = 0.7
      s.verificationPath.push(
        `agrees with ${trusted} higher-tier sources — promoted to 0.70`
      )
    } else if (s.tier === 'T4' && !s.fetchFailed) {
      s.verificationPath.push('no corroboration from higher-tier sources — contributes nothing')
      s.trustScore = 0
    }
  }

  return { sources, pages }
}
