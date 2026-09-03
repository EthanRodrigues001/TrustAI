# TrustAI — Overview

**One line:** A traffic light for AI answers. Ask a question, get an answer plus
an honest label saying whether you can trust it.

Hackathon submission for TCS Tech Day problem **P6 — AI Hallucination Confidence
Labeler**. Full brief in `01-problem-brief.md`.

## Interface

A **GPT-style chat**. Familiar on the surface - but every assistant message
carries a trust badge, every sentence is underlined by its own verdict, and one
click opens the full parameter breakdown showing exactly what the answer was
based on.

The point of the familiar shell: this is the interface people already trust
blindly. Ours shows its work.

## What it does

Every answer gets one of three labels:

| Label | Meaning |
|---|---|
| Certain | Well supported by good sources. Use it. |
| Uncertain | Probably right, but verify before relying on it. |
| Needs Verification | Evidence is missing, weak, or contradicting. Don't trust yet. |

Plus: a short reason, warnings, the sources with trust badges, and the
perplexity metric. Full parameter list in `05-parameters.md`.

## The core idea

Gemini can search the web and reports which pages it used. **We do not take its
word for it.**

The common AI failure is not a broken link — it's a *real, reputable* link cited
for a claim that page never made. So our tool re-fetches every cited page and
verifies the claim is actually there. That check is the project's differentiator.

## How we judge an answer — four questions

1. **Did it cite anything at all?** No sources = answered from memory = suspicious.
2. **Do the sources actually say it?** We re-read each page and require a
   verbatim supporting quote, then string-match that quote against the real page
   text. Can't quote it, or quote isn't there → not supported. *(Most important.)*
3. **Are the sources any good?** `.gov` / official docs rank far above a random
   blog. Tiered scoring.
4. **Does the AI agree with itself?** Ask 3x. Stable answer = it knows.
   Changing answer = it's guessing.

These combine into a score, then hard override rules produce the final label.

## Guiding principle

> An unverifiable source can never *raise* confidence. It can only lower it or
> count for nothing.

Being honest about not knowing is the entire point of the tool. The brief says
it directly: *"the focus is reliability awareness, not perfect accuracy."*

## Stack

Next.js 16.3.4 · React 19.2.8 · Tailwind v4 · shadcn/ui · Gemini API
(grounding with Google Search)

## The demo moment

Find a question where Gemini cites a real, respectable site — but the article
doesn't actually back the claim. Show the tool catching it.

*"The link was real. The source was reputable. The claim still wasn't supported.
We caught it."*
