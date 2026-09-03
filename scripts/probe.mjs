/**
 * Settles the two open questions in context/04-progress.md:
 *
 *   1. Does the model return logprobs while google_search grounding is ON?
 *   2. Do groundingChunks carry a real `domain`, or only a redirect URI?
 *
 * Run:  node scripts/probe.mjs
 */

import { readFileSync } from 'node:fs'

// --- load .env.local without a dependency ---------------------------------
try {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
} catch {
  console.error('No .env.local found')
}

const KEY = process.env.GEMINI_API_KEY
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
const BASE = 'https://generativelanguage.googleapis.com/v1beta'

if (!KEY) {
  console.error('GEMINI_API_KEY missing')
  process.exit(1)
}

const ok = (s) => `\x1b[32m${s}\x1b[0m`
const bad = (s) => `\x1b[31m${s}\x1b[0m`
const dim = (s) => `\x1b[2m${s}\x1b[0m`

async function call(label, body) {
  process.stdout.write(`\n── ${label}\n`)
  const res = await fetch(`${BASE}/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    console.log(bad(`   HTTP ${res.status}`), json?.error?.message ?? '')
    return null
  }
  console.log(ok(`   HTTP ${res.status}`))
  return json
}

const Q = 'Who invented the Python programming language, and in what year was it first released?'
const contents = [{ role: 'user', parts: [{ text: Q }] }]

console.log(dim(`model: ${MODEL}`))
console.log(dim(`key:   ${KEY.slice(0, 6)}…${KEY.slice(-4)} (${KEY.length} chars)`))

// 1. Plain call ------------------------------------------------------------
const plain = await call('1. plain generateContent (is the key valid at all?)', {
  contents,
  generationConfig: { temperature: 0 },
})
if (!plain) {
  console.log(
    bad('\nKey rejected. Get a Gemini API key at https://aistudio.google.com/apikey')
  )
  process.exit(1)
}
console.log(dim(`   text: ${plain.candidates?.[0]?.content?.parts?.[0]?.text?.slice(0, 80)}…`))

// 2. Logprobs, no search ---------------------------------------------------
const lp = await call('2. logprobs WITHOUT search', {
  contents,
  generationConfig: { temperature: 0, responseLogprobs: true, logprobs: 5 },
})
const c2 = lp?.candidates?.[0]
console.log(
  `   avgLogprobs: ${c2?.avgLogprobs !== undefined ? ok(c2.avgLogprobs) : bad('absent')}`
)
console.log(
  `   token logprobs: ${
    c2?.logprobsResult?.chosenCandidates?.length
      ? ok(`${c2.logprobsResult.chosenCandidates.length} tokens`)
      : bad('absent')
  }`
)

// 3. Search, no logprobs ---------------------------------------------------
const gr = await call('3. google_search WITHOUT logprobs', {
  contents,
  tools: [{ google_search: {} }],
  generationConfig: { temperature: 0 },
})
const gm = gr?.candidates?.[0]?.groundingMetadata
const chunks = gm?.groundingChunks ?? []
console.log(`   groundingChunks: ${chunks.length ? ok(chunks.length) : bad('0')}`)
console.log(
  `   searchEntryPoint: ${gm?.searchEntryPoint?.renderedContent ? ok('present') : bad('absent')}`
)

// ── QUESTION 2: does web.domain exist? ────────────────────────────────────
if (chunks.length) {
  const web = chunks[0].web ?? {}
  console.log(`\n   ${dim('first chunk keys:')} ${Object.keys(web).join(', ')}`)
  console.log(
    `   web.domain: ${web.domain ? ok(web.domain) : bad('ABSENT — must follow the redirect')}`
  )
  console.log(dim(`   web.uri:    ${(web.uri ?? '').slice(0, 90)}…`))

  if (!web.domain && web.uri) {
    process.stdout.write('   resolving redirect… ')
    try {
      const r = await fetch(web.uri, { redirect: 'manual' })
      const loc = r.headers.get('location')
      if (loc) console.log(ok(new URL(loc).hostname))
      else {
        const r2 = await fetch(web.uri, { redirect: 'follow' })
        console.log(ok(new URL(r2.url).hostname) + dim(' (via follow)'))
      }
    } catch (e) {
      console.log(bad(`failed: ${e.message}`))
    }
  }
}

// 4. THE BIG ONE: search + logprobs together -------------------------------
const both = await call('4. google_search AND logprobs TOGETHER', {
  contents,
  tools: [{ google_search: {} }],
  generationConfig: { temperature: 0, responseLogprobs: true, logprobs: 5 },
})
const c4 = both?.candidates?.[0]

console.log('\n════════════════════ VERDICT ════════════════════')
if (!both) {
  console.log(bad('Search + logprobs together: REJECTED by the API'))
  console.log('→ Use avgLogprobs only, or a second ungrounded call for perplexity.')
} else {
  const hasAvg = typeof c4?.avgLogprobs === 'number'
  const hasTok = (c4?.logprobsResult?.chosenCandidates?.length ?? 0) > 0
  const hasGround = (c4?.groundingMetadata?.groundingChunks?.length ?? 0) > 0
  console.log(`grounding chunks:  ${hasGround ? ok('YES') : bad('NO')}`)
  console.log(`avgLogprobs:       ${hasAvg ? ok('YES') : bad('NO')}`)
  console.log(`token logprobs:    ${hasTok ? ok('YES') : bad('NO')}`)
  console.log('')
  if (hasGround && hasTok) {
    console.log(ok('Both work together. A1 + A2 + A3 all available in one call.'))
  } else if (hasGround && hasAvg) {
    console.log('Partial: avgLogprobs works, per-token does not.')
    console.log('→ A1 perplexity OK. A2/A3 need a second ungrounded call.')
  } else {
    console.log(bad('Logprobs unavailable with grounding.'))
    console.log('→ Run a second ungrounded call purely for the perplexity number.')
  }
}
console.log('═════════════════════════════════════════════════\n')
console.log(dim('Record the outcome in context/04-progress.md.'))
