# API Contract

**Owner:** backend (Ethan) · **Consumers:** frontend team

This is the boundary. Frontend builds against this shape with mock data; backend
fills it in. Neither side waits for the other.

**Freeze this early.** Changing it mid-hackathon costs both teams a rebuild.
Any change gets announced and recorded in `03-decisions.md`.

Parameter definitions and formulas: `05-parameters.md`.

---

## Endpoint

```
POST /api/chat        Content-Type: application/json
                      Response: text/event-stream (SSE)
```

### Request

```ts
type ChatRequest = {
  messages: { role: 'user' | 'assistant'; content: string }[]
  options?: {
    selfConsistency?: boolean   // Group B, default true. Off = ~3x faster
    samples?: number            // N for B1, default 3
  }
}
```

---

## Streaming events

Full analysis takes 8–15s. Stream stages so the UI shows progress instead of a
spinner — this is also the demo's best feature, because it makes the method
visible.

```ts
type StreamEvent =
  | { type: 'stage';   stage: Stage; detail?: string }
  | { type: 'token';   text: string }              // answer streams in
  | { type: 'claims';  claims: Claim[] }           // before verdicts land
  | { type: 'claim';   claim: Claim }              // one claim resolved
  | { type: 'source';  source: Source }            // one source resolved
  | { type: 'verdict'; verdict: Verdict }          // final, always last
  | { type: 'error';   message: string; fatal: boolean }

type Stage =
  | 'classifying'    // "Checking if this is a factual claim"
  | 'generating'     // "Asking Gemini"
  | 'resolving'      // "Resolving 4 sources"
  | 'fetching'       // "Reading source 2 of 4"
  | 'verifying'      // "Checking claim 1 of 3"
  | 'consistency'    // "Re-asking (run 2 of 3)"
  | 'scoring'        // "Scoring"
  | 'done'
```

UI can render `stage` strings directly — backend supplies human-readable
`detail`.

---

## Core types

```ts
type Label = 'CERTAIN' | 'UNCERTAIN' | 'NEEDS_VERIFICATION' | 'NOT_APPLICABLE'
// NOT_APPLICABLE = greeting, opinion, creative, meta. Render a neutral chip,
// no score, no sources.

type Verdict = {
  label: Label
  score: number                 // 0..1, the fused support score
  headline: string              // one line: "Confirmed by 3 independent sources"
  reasons: string[]             // 2–4 short bullets, already human-readable
  warnings: string[]            // [] when clean
  overrides: Override[]         // [] when none fired — see below
  parameters: Parameter[]       // the breakdown panel
  claims: Claim[]
  sources: Source[]
  perplexity: {                 // brief-mandated, always present for FACTUAL
    value: number               // e.g. 3.2
    interpretation: 'low' | 'moderate' | 'high'
    caption: string             // "Low — the model was confident in its wording"
  }
  timing: { totalMs: number; cached: boolean }
}
```

**Backend guarantees:** `headline`, `reasons`, `warnings`, and every `caption`
arrive as finished display strings. The frontend never builds sentences from
numbers — that logic lives in one place, server-side.

### Parameter (the breakdown panel)

```ts
type Parameter = {
  id: string          // 'C2', 'B1', 'D1' — stable, matches 05-parameters.md
  group: 'A' | 'B' | 'C' | 'D' | 'E'
  groupLabel: string  // "Evidence" | "Consistency" | "Sources" | ...
  name: string        // "Verbatim quote verification"
  question: string    // "Does the cited page actually say this?"
  score: number       // 0..1
  weight: number      // 0..1, contribution to the fused score
  display: string     // "3 of 3 claims verified"
  status: 'pass' | 'warn' | 'fail' | 'skipped' | 'info'
  detail?: string     // optional longer explanation for expanded view
}
```

`status: 'info'` = display-only, does not affect score (A1 perplexity, A4
hedging). `'skipped'` = not run (e.g. B when self-consistency is off).

Frontend can render the whole panel by mapping over this array — **no
per-parameter special-casing.** Adding a parameter later requires no UI change.

### Override

```ts
type Override = {
  rule: string        // 'CONTRADICTED' | 'NO_GROUNDING' | 'VOLATILE_STALE' | ...
  message: string     // "A source contradicts this claim"
  cappedAt: Label
}
```

Overrides explain why the label is worse than the score suggests. Render them
prominently — they're the most defensible part of the design.

### Claim

```ts
type Claim = {
  id: string
  text: string                  // as it appears in the answer
  standalone: string            // coref-resolved: "he" → "Guido van Rossum"
  span: [number, number]        // char offsets into answer, for inline underline
  verdict: 'SUPPORTED' | 'PARTIAL' | 'NOT_FOUND' | 'CONTRADICTED' | 'UNCHECKED'
  quote: string | null          // verbatim supporting text from the page
  quoteVerified: boolean        // did the quote actually string-match the page?
  sourceIds: string[]
  note: string | null           // "No source contains the figure $4.2M"
}
```

`span` drives the inline green/amber/red underline. **Offsets are into the final
answer string** — backend computes them after generation completes.

`quoteVerified: false` with a non-null `quote` means the model produced a quote
that isn't on the page. That is a fabricated quote — surface it loudly, it is the
single most impressive catch the tool makes.

### Source

```ts
type Source = {
  id: string
  url: string             // resolved, not the Gemini redirect
  domain: string          // "python.org"
  title: string
  tier: 'T0'|'T1'|'T2'|'T3'|'T4'|'T5'|'T6'
  tierLabel: string       // "Official" | "Government" | "Reliable" | "Unknown"
  trustScore: number      // 0..1
  badge: 'official' | 'gov' | 'reliable' | 'mixed' | 'unknown' | 'low'
  snippet: string         // short excerpt, brief says keep sources short
  publishedAt: string | null   // ISO
  verificationPath: string[]   // how we classified it — audit trail
  duplicateOf: string | null   // set when this is the same wire story as another
  fetchFailed: boolean         // couldn't read the page; counts as zero
}
```

`verificationPath` is the escalation-chain audit trail, e.g.
`["not in registry", "domain age 11 years", "agrees with 2 T1 sources", "promoted to 0.70"]`.
Show it in an expander — it is the honest answer to "how do you know this site is
trustworthy", and it makes the unknown-domain handling visible rather than magic.

---

## Rules the frontend can rely on

1. `verdict` is always the **last** event. Nothing after it.
2. `label: 'NOT_APPLICABLE'` → no score, no sources, no perplexity. Neutral chip.
3. `sources` may be empty. That is itself a finding (E2 fires), not an error.
4. `claims` may be empty for very short answers. Fall back to the message badge.
5. Every user-facing string is server-supplied. No number-to-sentence logic in UI.
6. `parameters` is order-stable: A → B → C → D → E, matching `05-parameters.md`.
7. A non-fatal `error` event means one stage degraded (e.g. a page fetch timed
   out). The pipeline continues; the verdict still arrives, with a warning.

---

## Mock data

Backend ships `data/mock-responses.json` on day one: one complete `Verdict` per
label, plus a `NOT_APPLICABLE` and a fabricated-quote case. Frontend builds the
entire UI against it with zero Gemini calls and no API key.

**This is the first thing to build.** It unblocks the whole UI team immediately
and costs an hour.
