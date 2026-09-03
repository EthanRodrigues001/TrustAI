# Architecture

## Pipeline

```
Question
  1. Gemini generate  (google_search grounding + logprobs)
  2. Extract atomic claims from the answer
  3. Resolve grounding URIs -> real domains -> re-fetch page text
  4. Signal bank:  A internal | B consistency | C evidence | D trust | E priors
  5. Fusion + hard override rules
-> Answer + label + reason + warnings + perplexity
```

## Signal bank

### A. Model-internal (1 call, free)

| ID | Signal | How |
|---|---|---|
| A1 | Perplexity | `exp(-avgLogprobs)`. Required by brief. Weak alone — fluent hallucinations score *low* |
| A2 | Min-token confidence | Worst token logprob; locates the fragile span |
| A3 | **Entity perplexity** | PPL over numbers/dates/proper nouns only. Much stronger than A1 — function words dilute whole-answer PPL |
| A4 | Hedge markers | Regex for "likely / around / I believe". Noisy, but good UI copy |

> `generationConfig: { responseLogprobs: true, logprobs: 5 }`
> **OPEN:** verify logprobs are returned *while* `google_search` grounding is
> active. If not, fall back to `avgLogprobs`, or a second ungrounded call for PPL.

### B. Self-consistency (strongest family)

| ID | Signal | How |
|---|---|---|
| B1 | Semantic entropy | N samples at `temperature: 0.8`, cluster by meaning, entropy over cluster sizes |
| B2 | Answer flip rate | Does the key entity change across samples? |

Research basis: semantic entropy (Farquhar et al., *Nature* 2024). Costs N×
tokens. N configurable, default 3 for demo latency.

### C. Evidence grounding (the moat)

| ID | Signal | How |
|---|---|---|
| C1 | Citation coverage | % of answer sentences covered by a `groundingSupports` segment |
| C2 | **Verbatim-quote entailment** | Per claim, Gemini (temp 0, structured JSON) must return a verbatim supporting quote from the re-fetched page. Then string-match the quote against the real page text |
| C3 | Specificity leak | Numbers/dates/names in the answer but in no source text |
| C4 | Contradiction | A source stating the negation -> hard fail |
| C5 | API confidence | `groundingSupports[].confidenceScores` |

C2 verdicts: `SUPPORTED | PARTIAL | NOT_FOUND | CONTRADICTED`

Requiring a verbatim span *and verifying it exists* kills hallucinated citations
and hallucinated quotes in one move.

### D. Source trust

Tiers:

```
T0  1.00  Primary source (entity's own domain for claims about itself)
T1  0.95  .gov .edu .int .ac.* | WHO/UN/NIST/IETF | Crossref-indexed DOI
T2  0.85  WP:RSP "Generally Reliable" | encyclopedias | standards bodies
T3  0.65  Wikipedia | established tech press | WP:RSP "No Consensus"
T4  0.40  Unknown -> escalation chain
T5  0.15  WP:RSP "Generally Unreliable"
T6  0.00  WP:RSP Deprecated/Blacklisted | content farms | AI-slop sites
```

Escalation chain for unknown (T4) domains — stop when confident:

1. **Corroboration promote** — agrees with >=2 independent T1/T2 sources -> 0.70
2. **Independence check** — near-identical text across sites = one wire story
   wearing several hats. Count as **one** source
3. **Structural heuristics** — valid cert, /about page, named author, byline
   date, corrections policy, low ad density
4. **RDAP domain age** (`rdap.org`, free) — under 1 year -> cap at 0.30
5. **Wikidata/Wikipedia** — does the publishing org have an article?
6. **Gemini-as-classifier** — last resort. Display as low-confidence; we are
   using an LLM to judge an LLM and should say so
7. Still unknown -> contributes **zero**, warning: "1 source could not be verified"

### E. Question-side priors (free, run first)

| Signal | Effect |
|---|---|
| Volatility ("current CEO / price") | Cap at Uncertain unless a source is <30 days old |
| Knowledge-cutoff gap | Post-cutoff event with no grounding -> Needs Verification |
| Obscurity | Zero grounding chunks -> answered from memory -> downgrade |

## Fusion

```
support = 0.35*C2 + 0.20*D + 0.15*C1 + 0.15*B1 + 0.10*A3 + 0.05*C5

OVERRIDES (evaluated after; they win):
  any CONTRADICTED source            -> NEEDS_VERIFICATION
  zero grounding chunks              -> max UNCERTAIN
  all sources T4+ unverified         -> max UNCERTAIN
  specificity leak on a number/date  -> max UNCERTAIN
  volatile question, sources >90d    -> max UNCERTAIN
  single source, no corroboration    -> max UNCERTAIN

BANDS:  >=0.75 CERTAIN | 0.45-0.75 UNCERTAIN | <0.45 NEEDS_VERIFICATION
```

A pure weighted sum lets a contradicted-but-fluent answer pass. The overrides
are what make this a reliability tool rather than a vibes meter.

## File layout (planned)

```
lib/
  gemini/
    client.ts        Gemini REST wrapper, logprobs + google_search tool
    generate.ts      primary call -> { text, groundingMetadata, logprobs }
    judge.ts         structured-output: claim extraction, entailment, clustering
  signals/
    perplexity.ts    A1-A4
    consistency.ts   B1-B2
    entailment.ts    C2-C4
    trust.ts         D + escalation chain
    fusion.ts        weights, overrides, bands
  sources/
    resolve.ts       redirect -> real domain   [BUILD FIRST]
    fetch.ts         page fetch + readability + 8s timeout + cache
    registry.json    tier list, seeded from WP:RSP
  types.ts           shared zod schemas
app/
  api/verify/route.ts   streaming; emit each stage as it lands
  page.tsx
data/
  seed.json          ~20 eval cases
components/
  verdict-badge.tsx  signal-bars.tsx  source-card.tsx  claim-row.tsx
```

## Known implementation gotchas

1. **Redirect URLs.** `groundingChunks[].web.uri` are
   `vertexaisearch.cloud.google.com/grounding-api-redirect/...`, not publisher
   domains. Cannot regex a domain out of them. Read `web.domain` if the API
   version provides it, else follow the redirect server-side
   (`fetch(uri, { redirect: 'manual' })` -> `Location` header). **Every trust
   signal depends on this. Build it first.**
2. **Search Suggestions are mandatory.** Google's terms require rendering
   `searchEntryPoint.renderedContent` when using grounding with Google Search.
3. **Cache aggressively.** Question hash -> result; page fetches -> 15 min.
   Conference wifi plus a 15s cold pipeline is how demos die.
4. **Stream the stages.** Full pipeline is 8-15s. Showing
   "resolving 4 sources -> checking claim 2 of 3" makes the method visible to
   judges and beats a spinner.
5. **Read the bundled Next docs** at `node_modules/next/dist/docs/` before
   writing route handlers — this Next version has breaking changes vs training
   data (see AGENTS.md).

## Source-trust landscape (research notes)

There is **no single authoritative trust database**. Composite scoring is the
correct answer, and a better talking point than "we used a database."

| Source | Cost | Coverage | Verdict |
|---|---|---|---|
| Wikipedia WP:RSP | Free | ~600 media sources, labeled reliable/unreliable/deprecated | **Best free option.** Scrape once via Wikipedia API, ship as JSON |
| Media Bias/Fact Check | Paid API, free CSV mirrors | ~7k domains | Good supplement |
| NewsGuard | Enterprise | 9k+ human-rated | Not viable for hackathon — **name it as the enterprise upgrade path** |
| Tranco / Cloudflare Radar | Free | Top 1M by traffic | Popularity != trust. Weak prior only |
| Open PageRank | Free | Domain authority proxy | Weak prior |
| Crossref / OpenAlex / PubMed | Free | Academic DOIs | Definitive for scientific claims |
| RDAP (rdap.org) | Free | Domain age/registrar | Age <1yr is a strong negative |
