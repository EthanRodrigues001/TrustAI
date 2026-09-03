# Decision Log

Append-only. Newest at the bottom. If a decision is reversed, add a new entry
saying so — don't delete the old one.

Format: `## D-NN — <decision>` / Date / Context / Decision / Why / Status

---

## D-01 — Verify claims by re-fetching cited pages, don't trust grounding metadata
**Date:** 2026-09-03 · **Status:** Accepted

**Context:** Gemini's grounding metadata reports which pages it used. Easiest
build is to display those and call it done.

**Decision:** Re-fetch every cited page server-side and independently verify the
claim appears in it.

**Why:** The most common real-world AI failure is a *real, reputable* URL cited
for a claim the page never made. Displaying the citation without checking it
would reproduce the exact bug we're supposed to detect. This is the project's
differentiator.

---

## D-02 — Verbatim-quote entailment over free-form NLI
**Date:** 2026-09-03 · **Status:** Accepted

**Decision:** For each claim, require the judge model to return a **verbatim
quote** from the fetched page, then string-match that quote against the real page
text before accepting it.

**Why:** Catches hallucinated citations *and* hallucinated quotes in one move.
A model that can't produce a real supporting span hasn't got support.

---

## D-03 — Composite trust scoring, seeded from Wikipedia WP:RSP
**Date:** 2026-09-03 · **Status:** Accepted

**Context:** User asked whether a database of trusted sites exists.

**Decision:** No single authoritative list exists. Build a tiered composite
scorer seeded from Wikipedia's Reliable Sources/Perennial list (free, ~600
sources, public API), plus TLD rules and an escalation chain for unknowns.

**Why:** WP:RSP is the best free option and is community-maintained with stated
reasoning. NewsGuard is the "real" answer but is enterprise-priced — we name it
as the upgrade path instead of using it. Hand-curating tiers was the alternative;
rejected as slower and less defensible to judges.

---

## D-04 — Unverifiable sources can never raise confidence
**Date:** 2026-09-03 · **Status:** Accepted

**Decision:** A source we can't classify contributes **zero** to the score. It
may lower the label or be ignored, never raise it.

**Why:** The brief's stated focus is *reliability awareness, not perfect
accuracy*. Guessing upward on unknown sources would defeat the tool's purpose.

---

## D-05 — Hard override rules on top of the weighted score
**Date:** 2026-09-03 · **Status:** Accepted

**Decision:** Compute a weighted support score, then apply hard overrides that
can only cap or force the label down (see `02-architecture.md`).

**Why:** A pure weighted sum lets a contradicted-but-fluent answer pass. The
overrides are what make this a reliability tool rather than a vibes meter, and
they're the first thing a judge will probe.

---

## D-06 — Self-consistency sampling at N=3, not N=5
**Date:** 2026-09-03 · **Status:** Accepted

**Decision:** Default to 3 samples for the self-consistency signal. Make it
configurable.

**Why:** Latency for the live demo. N=5 is meaningfully better statistically but
the full pipeline is already 8-15s. Trade accuracy for a demo that doesn't stall.

---

## D-07 — Entity perplexity alongside whole-answer perplexity
**Date:** 2026-09-03 · **Status:** Accepted

**Decision:** Show the brief-mandated whole-answer perplexity, but weight
*entity* perplexity (numbers, dates, proper nouns only) in the actual score.

**Why:** Function words dominate whole-answer PPL and dilute the signal toward
zero. Fabrications concentrate in entities. Whole-answer PPL satisfies the brief;
entity PPL is what actually works.

---

## D-08 — Maintain this context folder
**Date:** 2026-09-03 · **Status:** Accepted

**Decision:** Keep `context/` with an overview, architecture, this decision log,
progress, and per-session chat logs.

**Why:** Hackathon work is bursty and multiple people (and AI sessions) touch it.
Decisions living only in chat get lost and re-litigated.

---

## D-09 - Chat interface, not single-shot Q&A
**Date:** 2026-09-03 * **Status:** Accepted

**Decision:** Ship a GPT-style multi-turn chat. Every assistant message carries a
trust badge; clicking it opens the full parameter breakdown.

**Why:** Familiar interaction model, judges grasp it instantly, and it makes the
point better than a form does - the same interface people already trust blindly,
now showing its work. Also demos better: you can push it toward a hallucination
live in conversation.

**Cost:** Adds two required gates (D-10, D-11).

---

## D-10 - Gate every message on whether it is a factual claim
**Date:** 2026-09-03 * **Status:** Accepted

**Decision:** Classify each assistant message FACTUAL / OPINION / CREATIVE /
META / SOCIAL before scoring. Only FACTUAL runs the pipeline.

**Why:** A chat receives "hi", "thanks", "say that shorter". Slapping a trust
score on a greeting makes the tool look broken. Consequence of D-09.

---

## D-11 - Coreference resolution before claim extraction
**Date:** 2026-09-03 * **Status:** Accepted

**Decision:** Rewrite each extracted claim into a standalone sentence using the
last 6 turns before any verification runs.

**Why:** "He founded it in 1991" is unverifiable in isolation. Every downstream
check assumes self-contained claims. Without this, multi-turn silently produces
garbage verdicts. Consequence of D-09.

---

## D-12 - Inline claim-level highlighting as the primary trust UI
**Date:** 2026-09-03 * **Status:** Accepted

**Decision:** Underline each sentence in the answer green / amber / red / grey by
its own verdict. Hover shows the supporting quote and source. The message-level
badge is a summary of these, not the main event.

**Why:** "What was it based on" is answered best per-sentence, not per-message.
One overall score hides that sentence 1 is solid and sentence 3 is invented -
which is exactly the failure mode we exist to expose.

---

## D-13 - Split: Ethan backend, team frontend, contract-first
**Date:** 2026-09-03 * **Status:** Accepted

**Decision:** Freeze the API response shape (`06-api-contract.md`) before either
side builds. Backend ships `data/mock-responses.json` on day one so the UI team
builds with no API key and no dependency on the pipeline.

**Why:** Two teams, one weekend. The contract is the only thing that lets them
work in parallel. Mock data first is an hour that buys the frontend team the
whole first day.

---

## D-14 - Backend supplies all display strings
**Date:** 2026-09-03 * **Status:** Accepted

**Decision:** `headline`, `reasons`, `warnings`, `display`, `caption` all arrive
as finished human-readable text. The frontend never turns a number into a
sentence.

**Why:** Scoring logic would otherwise leak into the UI and drift out of sync.
Keeps explanation logic in one place, and means tuning weights never requires a
frontend change.

---

## D-15 - Parameters render generically from an array
**Date:** 2026-09-03 * **Status:** Accepted

**Decision:** `Verdict.parameters` is a flat array of uniform `Parameter`
objects. The UI maps over it with no per-parameter special-casing.

**Why:** Adding, removing or reweighting a parameter becomes a backend-only
change. Critical when weights get tuned late against the seed dataset.

---

## D-16 - Perplexity falls back to a sampling estimator
**Date:** 2026-09-03 * **Status:** Accepted

**Context:** The brief mandates a perplexity metric. Probing the API showed
every Gemini 3.x model available to this key rejects `responseLogprobs` with
400 "Logprobs is not enabled for this model", and omits `avgLogprobs` even when
the flag is not sent. So `exp(-avgLogprobs)` is simply not available.

**Decision:** `lib/perplexity.ts` resolves by the best available instrument:
real logprobs -> sampling estimator -> unavailable. The estimator samples the
model N times at temperature 0.8 and takes p-hat(w) = (samples containing w) / N
over content words, then applies the standard perplexity formula. The response
always reports which instrument produced the number.

**Why:** This is the sampling estimator of the same quantity, not a substitute
metric. A model that is sure reproduces its wording (PPL -> 1); a model that is
guessing varies it (PPL climbs). Measured separation: 1.1 for a known fact vs
3.8 for a guess.

**Consequence:** The sampled scale is compressed relative to true perplexity, so
it carries its own interpretation bands (low <1.5, moderate <3) and its own
normalisation ceiling (8 rather than 50). Reusing the logprob bands would report
a guess as "low".

---

## D-17 - Demo mode is explicitly badged in the UI
**Date:** 2026-09-03 * **Status:** Accepted

**Decision:** `lib/demo.ts` supplies canned verdicts for building and presenting
the interface without Search grounding quota. Every message rendered from it
carries a DEMO badge and the header shows a "Demo data" pill.

**Why:** The project is about honesty regarding what is verified. Unbadged demo
data shown to judges would be the exact failure the tool exists to catch.
