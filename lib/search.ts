/**
 * Independent evidence retrieval.
 *
 * We deliberately do NOT rely on Gemini's own Search grounding. Two reasons:
 *
 *  1. Practical — grounding returns 429 on a free-tier key, so it is unusable.
 *  2. Principled — the whole point of this tool is to check the model's claims
 *     against evidence it did not choose for itself. Retrieving independently
 *     is a stronger test than reading back the model's own citations.
 *
 * Keyless providers only, so the project runs with nothing but a Gemini key.
 */

export type SearchResult = {
  url: string
  title: string
  snippet: string
  provider: 'duckduckgo' | 'wikipedia'
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'

const decodeEntities = (s: string) =>
  s
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')

const stripTags = (s: string) => decodeEntities(s.replace(/<[^>]+>/g, '')).trim()

/** DuckDuckGo wraps every hit in //duckduckgo.com/l/?uddg=<real url>. */
function unwrapDdg(href: string): string | null {
  try {
    const u = decodeEntities(href)
    const m = u.match(/[?&]uddg=([^&]+)/)
    if (m) return decodeURIComponent(m[1])
    if (u.startsWith('http')) return u
    return null
  } catch {
    return null
  }
}

async function duckduckgo(query: string, limit: number): Promise<SearchResult[]> {
  const res = await fetch(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(9000) }
  )
  if (!res.ok) return []
  const html = await res.text()

  const out: SearchResult[] = []
  const re =
    /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) && out.length < limit) {
    const url = unwrapDdg(m[1])
    if (!url || !/^https?:/.test(url)) continue
    if (out.some((r) => r.url === url)) continue
    out.push({
      url,
      title: stripTags(m[2]).slice(0, 200),
      snippet: '',
      provider: 'duckduckgo',
    })
  }

  // attach snippets where we can find them
  const snips = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)]
    .map((x) => stripTags(x[1]))
  out.forEach((r, i) => { r.snippet = snips[i]?.slice(0, 300) ?? '' })

  return out
}

async function wikipedia(query: string, limit: number): Promise<SearchResult[]> {
  const res = await fetch(
    'https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*' +
      `&srlimit=${limit}&srsearch=${encodeURIComponent(query)}`,
    { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) }
  )
  if (!res.ok) return []
  const json = (await res.json()) as {
    query?: { search?: { title: string; snippet: string }[] }
  }
  return (json.query?.search ?? []).slice(0, limit).map((s) => ({
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(s.title.replace(/ /g, '_'))}`,
    title: s.title,
    snippet: stripTags(s.snippet).slice(0, 300),
    provider: 'wikipedia' as const,
  }))
}

/**
 * Turn a question into search terms. Drops interrogatives and filler so the
 * query reads like something a person would actually type.
 */
export function toQuery(question: string): string {
  return question
    .replace(/[?!.]/g, ' ')
    .replace(/\b(who|what|when|where|why|how|is|are|was|were|did|does|do|the|a|an|of|in|on|for|to|and|please|tell|me|about|can|you)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200) || question.slice(0, 200)
}

/**
 * Search for evidence. DuckDuckGo first; Wikipedia always contributes one
 * result as a dependable backstop when DDG rate-limits or returns nothing.
 */
export async function findEvidence(
  question: string,
  limit = 5
): Promise<SearchResult[]> {
  const q = toQuery(question)

  const [ddg, wiki] = await Promise.all([
    duckduckgo(q, limit).catch(() => [] as SearchResult[]),
    wikipedia(q, 2).catch(() => [] as SearchResult[]),
  ])

  const seen = new Set<string>()
  const merged: SearchResult[] = []
  for (const r of [...ddg, ...wiki]) {
    let host = ''
    try { host = new URL(r.url).hostname } catch { continue }
    // at most two pages from any one host, so one site cannot dominate
    const n = merged.filter((x) => {
      try { return new URL(x.url).hostname === host } catch { return false }
    }).length
    if (n >= 2) continue
    if (seen.has(r.url)) continue
    seen.add(r.url)
    merged.push(r)
    if (merged.length >= limit) break
  }
  return merged
}
