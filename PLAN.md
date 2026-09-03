# TrustAI — Master Plan

**P6 — AI Hallucination Confidence Labeler** · TCS Tech Day @ Fr. C. Rodrigues
Institute of Technology

> A GPT-style chat that shows its work. Every answer carries a trust label, and
> one click reveals exactly what it was based on.

Deep detail lives in `context/`. This file is the plan; that folder is the
reference.

| Need | Read |
|---|---|
| Plain-language pitch | `context/00-overview.md` |
| The original brief | `context/01-problem-brief.md` |
| Pipeline + scoring | `context/02-architecture.md` |
| Every parameter + formula | `context/05-parameters.md` |
| **Backend/frontend boundary** | `context/06-api-contract.md` |
| Why we chose X | `context/03-decisions.md` |
| Live status | `context/04-progress.md` |

---

## 1. The thesis

Gemini can search the web and reports which pages it used. **We don't take its
word for it.**

The signature AI failure isn't a broken link — it's a *real, reputable* URL cited
for a claim that page never made. So we re-fetch every cited page and verify the
claim is actually in it.

Everything else in this project supports that one check.

---

## 2. What we must ship (from the brief)

- [ ] Question input
- [ ] Answer output
- [ ] Reliability tag: **Certain / Uncertain / Needs Verification**
- [ ] Short reason for the tag
- [ ] Warning when evidence is missing or weak
- [ ] **Perplexity metric displayed**
- [ ] Sample dataset with expected labels (supported / partial / unsupported)
- [ ] Simple interface for quick testing
- [ ] Demo

Everything below is in service of this list. If a feature doesn't advance a
checkbox or the demo, cut it.

---

## 3. Architecture

```
User message
  │
  ├─ Gate 0   Is this a factual claim?        → if not, neutral chip, stop
  ├─ Gate 0b  Resolve "he"/"it" from history  → standalone claims
  │
  ├─ Generate  Gemini + google_search grounding + logprobs
  │
  ├─ Resolve   redirect URLs → real domains
  ├─ Fetch     re-read every cited page
  │
  ├─ Signals   A internal │ B consistency │ C evidence │ D trust │ E priors
  │
  └─ Fuse      weighted score → hard overrides → label
                                                    ↓
        Answer + label + reason + warnings + sources + perplexity
```

---

## 4. The parameters

16 parameters, 5 groups. Full formulas in `context/05-parameters.md`.

| ID | Parameter | The question it answers | How we check | Weight |
|---|---|---|---|---|
| **A1** | Perplexity | How surprised was the model by its own words? | `exp(-avgLogprobs)` | *display* |
| **A2** | Weakest token | Where's the most fragile word? | min token logprob | 0.03 |
| **A3** | Entity confidence ⭐ | Confidence on the parts that can be *wrong* | mean logprob over numbers/dates/names only | 0.07 |
| **A4** | Hedging | Is it hedging in its own words? | regex for "likely / around / I believe" | *display* |
| **B1** | Semantic agreement ⭐ | Does it agree with itself? | ask 3× at temp 0.8, cluster by meaning | 0.15 |
| **B2** | Entity stability | Does the key fact flip between runs? | compare key entity across samples | *in B1* |
| **C1** | Citation coverage | How much is backed by *any* source? | cited sentences ÷ total sentences | 0.15 |
| **C2** | **Quote verification** ⭐⭐ | Does the page *actually* say this? | demand a verbatim quote, then string-match it against the real page | **0.35** |
| **C3** | Specificity leak | Did it invent a detail? | numbers/dates in answer but in no source | 0.05 |
| **C4** | Contradiction | Does a source say the opposite? | judge call per claim × source | *override* |
| **C5** | Grounding confidence | Gemini's own linkage confidence | `confidenceScores` | 0.05 |
| **D1** | Domain tier | Is this a good source? | tier lookup T0–T6 + escalation chain | 0.12 |
| **D2** | Corroboration | How many independent good sources agree? | count distinct T0–T2 domains | 0.05 |
| **D3** | Independence ⭐ | Are 3 sources actually 1 wire story? | pairwise text similarity > 0.8 → count once | *multiplier* |
| **D4** | Recency | Is the evidence current enough? | publish date vs question volatility | 0.03 |
| **E1** | Volatility | Is the true answer time-sensitive? | classify STATIC / SLOW / VOLATILE | *override* |
| **E2** | Grounding coverage | Did it search at all? | `groundingChunks.length` | *override* |
| **E3** | Cutoff gap | Is this after the training cutoff? | date entities vs model cutoff | *override* |

### Fusion

```
score = 0.35·C2 + 0.15·C1 + 0.15·B1 + 0.12·D1 + 0.07·A3
      + 0.05·C3 + 0.05·C5 + 0.05·D2 + 0.03·A2 + 0.03·D4

OVERRIDES (applied after; they can only make the label worse):
  any CONTRADICTED source            → NEEDS_VERIFICATION
  zero grounding chunks              → cap UNCERTAIN
  all sources unverified             → cap UNCERTAIN
  specificity leak on number/date    → cap UNCERTAIN
  volatile question, sources > 90d   → cap UNCERTAIN
  single source, no corroboration    → cap UNCERTAIN

BANDS   ≥ 0.75 CERTAIN │ 0.45–0.75 UNCERTAIN │ < 0.45 NEEDS VERIFICATION
```

A pure weighted sum lets a contradicted-but-fluent answer through. The overrides
are what make this a reliability tool instead of a vibes meter — and they're the
first thing a judge will probe.

### Source trust tiers

```
T0  1.00  Primary — the entity's own domain (python.org for Python)
T1  0.95  .gov .edu .int .ac.* │ WHO/UN/NIST/IETF │ Crossref DOI
T2  0.85  Wikipedia WP:RSP "Generally Reliable" │ standards bodies
T3  0.65  Wikipedia │ established tech press │ WP:RSP "No Consensus"
T4  0.40  Unknown → escalation chain
T5  0.15  WP:RSP "Generally Unreliable"
T6  0.00  Deprecated / blacklisted / content farms
```

**Unknown domain?** Escalate: agrees with ≥2 trusted sources → check independence
→ structural heuristics (author, about page, cert) → RDAP domain age → Wikidata
org lookup → LLM classifier as last resort. Still unknown → **counts as zero.**

> **An unverifiable source can never raise confidence.** It can only lower the
> label or be ignored. That rule is the whole ethic of the project.

---

## 5. Team split

**Backend — Ethan:** Gemini pipeline, all signals, scoring, `/api/chat`
**Frontend — team:** chat UI, badges, parameter panel, source cards

The boundary is **`context/06-api-contract.md`** — frozen types and stream
events. Both sides build against it in parallel. Two guarantees make this work:

1. **Backend supplies every display string.** `headline`, `reasons`, `warnings`,
   `caption` all arrive as finished text. The frontend never turns a number into
   a sentence.
2. **Parameters render generically.** `Verdict.parameters` is a uniform array;
   the UI maps over it. Adding or reweighting a parameter needs no UI change.

---

## 6. Build order

### Backend (Ethan)

| # | Task | Est | Why this order |
|---|---|---|---|
| 1 | **`data/mock-responses.json`** | 1h | **Unblocks the entire frontend team.** Do this before anything else |
| 2 | `lib/sources/resolve.ts` — redirect → real domain | 1h | Everything downstream needs real domains; only real unknown |
| 3 | Gemini client + generate + A1/A3 perplexity | 2h | First real output; satisfies a brief checkbox |
| 4 | `lib/sources/fetch.ts` — page fetch + extract + cache | 1.5h | Feeds C2 |
| 5 | Trust tiers + `registry.json` + escalation chain (D) | 2h | Seed registry from Wikipedia WP:RSP |
| 6 | **C2 verbatim quote verification** | 2.5h | **The differentiator.** Protect this time |
| 7 | Gates 0 + 0b (claim classifier, coref) | 1h | Makes chat safe |
| 8 | `fusion.ts` — weights + overrides + bands | 1.5h | Three labels working end to end |
| 9 | Self-consistency (B) | 1.5h | First thing to cut |
| 10 | `data/seed.json` + eval harness | 2h | Tune weights, gives an accuracy number for the pitch |

**Tasks 1–8 = a complete, defensible submission** (~12h). 9–10 are the winning
margin.

### Frontend (team)

| # | Task | Depends on |
|---|---|---|
| F1 | Chat shell — messages, input, streaming text | nothing |
| F2 | Trust badge + 4 label states (incl. `NOT_APPLICABLE`) | mock data |
| F3 | Parameter breakdown panel (map over array) | mock data |
| F4 | Source cards + `verificationPath` expander | mock data |
| F5 | Inline claim underlines from `span` offsets | mock data |
| F6 | Stage progress indicator during analysis | contract only |

**All of F1–F6 can be built before the backend works at all.**

### Critical path

```
mock-responses.json ──► frontend builds everything (parallel)
        │
        └─► resolve → generate → fetch → trust → C2 → gates → fusion ──► integrate
```

---

## 7. Seed dataset (~20 cases)

Each case must provably trip a specific signal — that's what makes the eval
meaningful rather than decorative.

| Case | Expected | Trips |
|---|---|---|
| "Who invented Python?" | Certain | full support, T0 python.org |
| "When was Python first released?" | Certain | corroboration across tiers |
| "Who is the current CEO of X?" | Uncertain | E1 volatility |
| "Company Y's exact Q3 2024 revenue?" | Needs Verification | C3 specificity leak |
| "What does §12(b) of [fake act] say?" | Needs Verification | E2 + B2 flip |
| Claim only a low-tier blog supports | Needs Verification | D1 trust floor |
| Same wire story on 3 sites | Uncertain | D3 → counts as 1 |
| **Real URL, claim not on page** | Needs Verification | **C2 — the headline** |
| "hi" / "thanks" | Not applicable | Gate 0 |
| "he founded it in 1991" (turn 3) | inherits | Gate 0b coref |

---

## 8. Demo script (4 minutes)

1. **Establish the familiar.** Ask "Who invented Python?" → 🟢 Certain. Open the
   panel: three sources, python.org official, 3/3 runs agreed, perplexity 3.2.
   *"Normal chat, but it shows its work."*

2. **Show honest doubt.** Ask something volatile — "Who is the current CEO of
   [company]?" → 🟡 Uncertain. *"It knows the answer can go stale."*

3. **The catch.** ⭐ Ask the question where Gemini cites a real, reputable
   article that doesn't support the claim → 🔴 Needs Verification.

   > *"The link is real. The source is Reuters. Click it — the article says
   > nothing of the kind. Most tools would show you a green checkmark. We read
   > the page."*

4. **The unknown-source story.** Show a `verificationPath` expander — domain not
   in any list, 11 years old, agrees with two government sources, promoted to
   0.70. *"There is no official database of trustworthy websites. So we built a
   chain of evidence, and when it runs out we say so instead of guessing."*

5. **Close on the ethic.** *"An unverifiable source never raises our confidence.
   The brief asked for reliability awareness, not perfect accuracy — so the tool
   is built to be honest about what it doesn't know."*

---

## 9. Risks and cuts

| Risk | Mitigation |
|---|---|
| Logprobs unavailable with grounding | Fall back to `avgLogprobs`, or a second ungrounded call purely for the PPL number |
| Redirect resolution harder than expected | Task 2, done early and standalone — fails fast |
| Page fetches slow / blocked | 8s timeout, cache 15min, `fetchFailed: true` counts as zero and continues |
| Pipeline too slow on conference wifi | Aggressive caching + pre-warm the demo questions before presenting |
| Running out of time | Cut in order: **B self-consistency → eval harness → coref → polish.** Never cut C2 |

### Non-negotiables

Google's terms require rendering `searchEntryPoint.renderedContent` (Search
Suggestions) when using grounding with Google Search. One div, but required.

`GEMINI_API_KEY` lives in `.env.local`. Never committed.

This Next version (16.3.4) has breaking changes vs older docs — read
`node_modules/next/dist/docs/` before writing route handlers. See `AGENTS.md`.

---

## 10. Open questions

- [ ] Does the chosen Gemini model return logprobs while `google_search`
      grounding is active? *One throwaway call settles it — do this first.*
- [ ] Does `groundingChunks[].web` carry a `domain` field, or must we follow the
      redirect ourselves?
- [ ] Which model, once rate limits are known?

## 11. Blocked on

- [ ] **Gemini API key** → `.env.local`

---

## Immediate next actions

**Ethan:** write `data/mock-responses.json` against the contract → then
`lib/sources/resolve.ts`
**Team:** read `context/06-api-contract.md`, object to it now rather than later,
then start F1
