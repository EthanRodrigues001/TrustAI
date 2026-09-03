# Progress

**Last updated:** 2026-09-03

## Status: planning complete, contract frozen, not yet building

## Team split

**Backend — Ethan:** Gemini pipeline, all signals, scoring, `/api/chat`
**Frontend — team:** chat UI, trust badges, parameter panel, source cards

Boundary: `06-api-contract.md`. Both sides build against it in parallel.

---

## Backend phases (Ethan)

| # | Phase | Ships | Status |
|---|---|---|---|
| 0 | Scaffold + context folder | repo ready | **done** |
| 1 | **`data/mock-responses.json`** | unblocks the entire UI team | **next, do first** |
| 2 | `lib/sources/resolve.ts` — redirect → real domain | real domains | not started |
| 3 | Gemini call + grounding + perplexity (A1, A3) | answer + PPL | not started |
| 4 | Page fetch + readability + cache | source snippets | not started |
| 5 | Trust tiers + registry.json + escalation chain (D) | trust badges | not started |
| 6 | **Verbatim quote verification (C2)** | per-claim verdicts | not started |
| 7 | Gates 0/0b — claim classifier + coref | chat-safe | not started |
| 8 | Fusion + overrides (`fusion.ts`) | three labels working | not started |
| 9 | Self-consistency (B) | toggleable | not started |
| 10 | Seed dataset + eval harness | accuracy vs expected | not started |

**Phases 1–8 = a complete, defensible submission.** 9–10 are the winning margin.
If time runs out, cut 9 first.

Phase 1 before Phase 2: an hour of mock data buys the frontend team their whole
first day.

## Frontend phases (team)

| # | Phase | Depends on |
|---|---|---|
| F1 | Chat shell — message list, input, streaming text | nothing |
| F2 | Trust badge + label states (incl. `NOT_APPLICABLE`) | mock data |
| F3 | Parameter breakdown panel (generic map over array) | mock data |
| F4 | Source cards + `verificationPath` expander | mock data |
| F5 | Inline claim underlines from `span` offsets | mock data |
| F6 | Stage progress indicator | contract only |

All of F1–F6 can be built before the backend works at all.

---

## Blocked on

Nothing. The pipeline runs end to end against the live API.

Verified 2026-09-03 on the running dev server:

| Question | Result |
|---|---|
| "Who invented Python and when was it first released?" | CERTAIN 0.90, 1/1 quote verified, 3/3 runs agreed, PPX 1.9 (sampled) |
| "Who wrote the novel Things Fall Apart?" | CERTAIN 0.88, 2/2 quotes verified |
| "What is the current stock price of Tesla?" | NEEDS_VERIFICATION 0.20, VOLATILE_STALE override fired |
| "hi there" | NOT_APPLICABLE, Gate 0 held |

Search grounding remains 429 on this key, but D-18 removed the dependency.

## PROBE RESULTS — 2026-09-03 (run `node scripts/probe.mjs`)

Key is **valid and authenticates**. Findings:

| Test | Result |
|---|---|
| Plain generateContent on `gemini-3.5-flash-lite` | **works** |
| `gemini-2.5-*` models | 404 - retired for new users |
| `gemini-3.6/3.7/3.8-flash` | 429 - no quota |
| Logprobs on **every** Gemini 3.x model | **400 - "Logprobs is not enabled for this model"** |
| `avgLogprobs` without the flag | **absent** |
| **google_search grounding, every model** | **429 - quota exceeded** |

### What this means

1. **Grounding is the blocker.** Search grounding needs quota this key does not
   have. Without it there are no sources, so Groups C and D cannot run - which is
   the whole project. Fix: enable billing at https://ai.dev/rate-limit, or use a
   key on a project with Search grounding quota.
2. **Perplexity cannot come from the API at all.** Not a model-choice problem:
   3.5/3.6/3.7/3.8-flash and every lite model reject `responseLogprobs`, and
   `avgLogprobs` is absent even without the flag. Resolved by D-16 - a sampling
   estimator, with the real logprob path kept for when a model supports it.

Until grounding quota exists the pipeline runs end-to-end but every answer lands
on NO_GROUNDING -> capped UNCERTAIN, which is correct behaviour, not a bug.

## Open questions

- [x] ~~logprobs + grounding~~ - ANSWERED: lite models reject logprobs entirely;
      grounding is quota-blocked so the combination is still untested on a full model.
- [ ] Does `groundingChunks[].web` include a `domain` field in our API version,
      or must we follow the redirect ourselves?
- [ ] Which model — decide once the key is in hand and rate limits are known.

## Next action

Write `data/mock-responses.json` conforming to `06-api-contract.md`, then build
`lib/sources/resolve.ts`.

## Seed dataset plan (~20 cases)

Each case should provably trip a specific signal:

| Case | Expected | Trips |
|---|---|---|
| "Who invented Python?" | Certain | full support, T0 python.org |
| "When was Python first released?" | Certain | corroborated across tiers |
| "Who is the current CEO of X?" | Uncertain | volatility override (E1) |
| "Company Y's exact Q3 2024 revenue?" | Needs Verification | specificity leak (C3) |
| "What does §12(b) of [fake act] say?" | Needs Verification | no grounding (E2) + flip (B2) |
| Claim only a T5 blog supports | Needs Verification | trust floor (D1) |
| Same wire story on 3 sites | Uncertain | independence (D3) → counts as 1 |
| **Real URL, claim not on page** | Needs Verification | **C2 catch — headline demo** |
| "hi" / "thanks" | Not applicable | Gate 0 |
| "he founded it in 1991" (turn 3) | inherits | Gate 0b coref |
