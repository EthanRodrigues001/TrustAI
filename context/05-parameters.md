# Parameter Spec

Canonical list of every trust parameter: what it asks, how it's computed, what
it outputs, and how it surfaces in the UI. `02-architecture.md` holds the
pipeline; this file holds the parameters themselves.

All parameters normalize to **0.0–1.0** where **1.0 = most trustworthy**.

---

## Gate 0 — Is this even a factual claim?

Runs before everything. A chat interface receives "hi", "thanks", "rewrite that
shorter" — these must NOT get a trust badge. A badge on a greeting makes the
whole tool look stupid.

| | |
|---|---|
| **Check** | Classify the assistant message: `FACTUAL / OPINION / CREATIVE / META / SOCIAL` |
| **Method** | Gemini structured output, temp 0, cheap model. Cache by message hash |
| **Result** | Only `FACTUAL` runs the pipeline. Others render with a neutral "not a factual claim" chip |

## Gate 0b — Coreference resolution (chat-specific)

Turn 3 says "he founded it in 1991." Alone that's unverifiable — no subject.

| | |
|---|---|
| **Check** | Rewrite each claim into a standalone, self-contained sentence using prior turns |
| **Method** | Gemini structured output over last N=6 turns. "he" → "Guido van Rossum" |
| **Why** | Every downstream check needs claims that stand alone. Skipping this breaks multi-turn entirely |

---

## Group A — Answer confidence (from the model itself)

Free, arrives with the generation call. Cheap but weak — a fluent hallucination
scores *well* here. Never let Group A alone drive a Certain label.

### A1 · Perplexity  *(mandated by the brief)*

| | |
|---|---|
| **Asks** | How surprised was the model by its own words? |
| **Method** | `PPL = exp(-avgLogprobs)` from the response candidate |
| **Normalize** | `score = clamp(1 - ln(PPL)/ln(50), 0, 1)` |
| **Range** | PPL 1–3 confident · 3–10 normal · 10+ struggling |
| **Weight** | 0 (displayed only — A3 carries the weight) |
| **UI** | Numeric readout: `Perplexity 3.2 — low, model was confident` |

### A2 · Weakest token

| | |
|---|---|
| **Asks** | Where is the answer's most fragile word? |
| **Method** | Min token logprob across the answer; `p = exp(logprob)` |
| **Weight** | 0.03 |
| **UI** | Highlight that word in the answer text on hover |

### A3 · Entity confidence  ⭐

| | |
|---|---|
| **Asks** | How confident on the parts that can actually be wrong? |
| **Method** | Mean logprob over **entity tokens only** — numbers, dates, proper nouns, units. Tag via regex + capitalization, or ask the judge model |
| **Why stronger than A1** | Function words ("the", "is", "was") are near-certain and drag whole-answer PPL toward zero. Fabrications concentrate in entities |
| **Weight** | 0.07 |
| **UI** | Per-entity confidence on hover |

### A4 · Hedging language

| | |
|---|---|
| **Asks** | Is the model hedging in its own words? |
| **Method** | Regex: `likely, around, approximately, I believe, as of my knowledge, may have, roughly` → count / sentence count |
| **Weight** | 0 (explanation only) |
| **UI** | Feeds the reason string: "the model hedged twice" |

---

## Group B — Self-consistency (strongest single family)

Costs N× tokens. Toggleable; default N=3.

### B1 · Semantic agreement  ⭐

| | |
|---|---|
| **Asks** | Does the model agree with itself? |
| **Method** | Re-ask N=3 times at `temperature: 0.8`. Cluster answers by meaning (judge model: "same meaning yes/no"). `score = largest_cluster / N` |
| **Basis** | Semantic entropy — Farquhar et al., *Nature* 2024 |
| **Insight** | Fabrications differ each time; knowledge doesn't |
| **Weight** | 0.15 |
| **UI** | `3/3 runs agreed` or `2/3 runs disagreed — answers varied` |

### B2 · Entity stability

| | |
|---|---|
| **Asks** | Does the key fact flip between runs? |
| **Method** | Extract the answer's key entity from each sample; exact/fuzzy match |
| **Example** | `Guido van Rossum ×3` = stable · `1991 / 1989 / 1990` = guessing |
| **Weight** | folded into B1 |
| **UI** | Show the varying values — extremely convincing in a demo |

---

## Group C — Evidence grounding (the moat)

### C1 · Citation coverage

| | |
|---|---|
| **Asks** | How much of the answer is backed by *any* source? |
| **Method** | `sentences with a groundingSupports segment / total sentences` |
| **Weight** | 0.15 |
| **UI** | Uncited sentences get a dotted grey underline |

### C2 · Verbatim quote verification  ⭐⭐  *(the differentiator)*

| | |
|---|---|
| **Asks** | Does the cited page *actually* say this? |
| **Method** | 1. Re-fetch the cited page server-side. 2. Ask the judge (temp 0, structured JSON) for a **verbatim** supporting quote. 3. **String-match that quote against the real page text** — normalize whitespace, fuzzy match ≥90%. 4. No quote, or quote not found in page → `NOT_FOUND` |
| **Verdicts** | `SUPPORTED 1.0 · PARTIAL 0.5 · NOT_FOUND 0.0 · CONTRADICTED → override` |
| **Catches** | Hallucinated citations *and* hallucinated quotes, in one move |
| **Weight** | 0.35 — the single heaviest parameter |
| **UI** | Per-claim row: claim, verdict, the quote, the source. Green/amber/red underline inline in the answer |

### C3 · Specificity leak

| | |
|---|---|
| **Asks** | Did the model invent a detail no source contains? |
| **Method** | Extract numbers/dates/names from the answer; check each appears in at least one fetched source text |
| **Why** | The classic fabrication shape: right topic, invented precision |
| **Weight** | 0.05 + **triggers an override** |
| **UI** | `"$4.2M" appears in no source` |

### C4 · Contradiction

| | |
|---|---|
| **Asks** | Does any source say the opposite? |
| **Method** | Judge call per claim×source: does this source contradict the claim? |
| **Weight** | **Hard override → Needs Verification** regardless of every other score |
| **UI** | Red banner: `A source contradicts this` |

### C5 · Grounding confidence

| | |
|---|---|
| **Asks** | How confident is Gemini's own grounding linkage? |
| **Method** | `groundingSupports[].confidenceScores`, averaged |
| **Weight** | 0.05 |
| **UI** | Not shown directly; feeds the score |

---

## Group D — Source trust

### D1 · Domain tier

| | |
|---|---|
| **Asks** | Is this a good source? |
| **Method** | Resolve redirect → real domain → look up tier (T0–T6, see `02-architecture.md`) |
| **Unknown** | Runs the escalation chain: corroboration, independence, structural heuristics, RDAP age, Wikidata, LLM classifier |
| **Weight** | 0.12 |
| **UI** | Badge per source: `official` `gov` `reliable` `unknown` `low quality` |

### D2 · Corroboration

| | |
|---|---|
| **Asks** | How many *independent* good sources agree? |
| **Method** | Count distinct T0–T2 domains supporting the same claim |
| **Bands** | 0 → 0.0 · 1 → 0.5 · 2 → 0.8 · 3+ → 1.0 |
| **Weight** | 0.05 |
| **UI** | `Confirmed by 3 independent sources` |

### D3 · Independence  ⭐ *(the wire-story trap)*

| | |
|---|---|
| **Asks** | Are these 3 sources actually 1 source wearing 3 hats? |
| **Method** | Pairwise text similarity (shingle/Jaccard) across fetched sources. >0.8 → same story, count **once**. Also check shared parent org |
| **Why** | Three sites carrying the same news-agency copy is *one* source. Counting it as three is the biggest false-confidence trap in the whole design |
| **Weight** | Multiplier on D2, not a separate term |
| **UI** | `3 sources, but 2 are the same wire story — counted as 2` |

### D4 · Recency

| | |
|---|---|
| **Asks** | Is the evidence current enough for this question? |
| **Method** | Source publish date vs question volatility (E1). Volatile + source >90d → **override** |
| **Weight** | 0.03 |
| **UI** | `Newest source is 8 months old` |

---

## Group E — Question priors (free, run first)

### E1 · Volatility

| | |
|---|---|
| **Asks** | Is the true answer time-sensitive? |
| **Method** | Classify: `STATIC` (who invented Python) / `SLOW` (population) / `VOLATILE` (current CEO, stock price, "latest") |
| **Effect** | VOLATILE + no source under 30 days → **cap at Uncertain** |
| **UI** | `This answer can change over time` |

### E2 · Grounding coverage

| | |
|---|---|
| **Asks** | Did it search at all? |
| **Method** | `groundingChunks.length` |
| **Effect** | **0 chunks → answered from memory → cap at Uncertain** |
| **UI** | `No sources — answered from training data alone` |

### E3 · Cutoff gap

| | |
|---|---|
| **Asks** | Does this concern events after the model's training cutoff? |
| **Method** | Date entities in the question vs known model cutoff |
| **Effect** | Post-cutoff + no grounding → **Needs Verification** |
| **UI** | `Asks about events after the model's knowledge cutoff` |

---

## Weight summary

| Parameter | Weight |
|---|---|
| C2 Quote verification | **0.35** |
| C1 Citation coverage | 0.15 |
| B1 Semantic agreement | 0.15 |
| D1 Domain tier | 0.12 |
| A3 Entity confidence | 0.07 |
| C3 Specificity leak | 0.05 |
| C5 Grounding confidence | 0.05 |
| D2 Corroboration | 0.05 |
| A2 Weakest token | 0.03 |
| D4 Recency | 0.03 |
| **Total** | **1.00** |

Display-only: A1 Perplexity, A4 Hedging, B2 Entity stability
Override-only: C4 Contradiction, E1 Volatility, E2 Coverage, E3 Cutoff, D3 Independence

Weights are a starting point. Tune against `data/seed.json` in Phase 7 and
record any change as a new decision entry.

---

## Cost per message

| Group | Gemini calls | Notes |
|---|---|---|
| Gate 0 + 0b | 1 (cheap model) | Cacheable |
| A | 0 | Rides the generation call |
| Generation | 1 | With grounding + logprobs |
| B | N=3 | Toggleable — biggest cost lever |
| C | 1–2 | Batch all claims into one judge call |
| D | 0 Gemini | HTTP: redirect resolve, page fetch, RDAP |
| E | 0 | Folded into the Gate 0 call |

**~6 Gemini calls + 3–6 page fetches per message.** 8–15s cold, ~2s cached.
