/**
 * Demo verdicts for building and presenting the UI without Search grounding
 * quota. Everything rendered from here is badged "DEMO" in the interface —
 * it must never be mistaken for a live result.
 */

import type { Verdict, Parameter } from '@/lib/types'

const p = (
  id: string, group: Parameter['group'], groupLabel: string, name: string,
  question: string, score: number, weight: number, display: string,
  status: Parameter['status'], detail?: string
): Parameter => ({ id, group, groupLabel, name, question, score, weight, display, status, detail })

export type DemoCase = {
  key: string
  question: string
  answer: string
  verdict: Verdict
}

export const DEMO_CASES: DemoCase[] = [
  // ------------------------------------------------------------------ CERTAIN
  {
    key: 'certain',
    question: 'Who invented Python and when was it first released?',
    answer:
      'Python was created by Guido van Rossum. He began work on it in the late 1980s at CWI in the Netherlands. The first public release, version 0.9.0, came in February 1991.',
    verdict: {
      label: 'CERTAIN',
      score: 0.91,
      headline: 'Confirmed by 3 independent sources, including the official one',
      reasons: [
        '3 of 3 claims were verified word-for-word against the pages that were cited',
        'python.org is the primary source for claims about Python',
        'The model gave the same answer in 3 of 3 runs',
      ],
      warnings: [],
      overrides: [],
      parameters: [
        p('A1', 'A', 'Answer confidence', 'Perplexity', 'How surprised was the model by its own words?', 0.82, 0, '3.2 — low', 'info', 'Perplexity measures fluency, not truth. A confident-sounding fabrication scores low here too.'),
        p('A2', 'A', 'Answer confidence', 'Weakest token', "Where is the answer's most fragile word?", 0.79, 0.03, 'Least certain word: "1991" (79%)', 'pass'),
        p('A3', 'A', 'Answer confidence', 'Entity confidence', 'How confident on the parts that can actually be wrong?', 0.94, 0.07, '94% average on names, dates and numbers', 'pass', 'Function words are always near-certain and hide the signal. Fabrications concentrate in entities.'),
        p('A4', 'A', 'Answer confidence', 'Hedging language', 'Is the model hedging in its own words?', 1, 0, 'No hedging language', 'info'),
        p('B1', 'B', 'Consistency', 'Semantic agreement', 'Does the model agree with itself?', 1, 0.15, '3 of 3 runs gave the same answer', 'pass'),
        p('B2', 'B', 'Consistency', 'Entity stability', 'Does the key fact flip between runs?', 1, 0, '"Guido van Rossum" in all 3 runs', 'info'),
        p('C1', 'C', 'Evidence', 'Citation coverage', 'How much of the answer is backed by any source?', 1, 0.15, '3 of 3 sentences cite a source', 'pass'),
        p('C2', 'C', 'Evidence', 'Quote verification', 'Does the cited page actually say this?', 1, 0.35, '3 of 3 claims verified word-for-word on the page', 'pass', 'We re-fetch every cited page, demand a verbatim supporting quote, then check that quote really appears in the page text.'),
        p('C3', 'C', 'Evidence', 'Specificity leak', 'Did the model invent a detail no source contains?', 1, 0.05, 'Every name and date appears in a source', 'pass'),
        p('C4', 'C', 'Evidence', 'Contradiction', 'Does any source say the opposite?', 1, 0, 'No source contradicts the answer', 'pass'),
        p('C5', 'C', 'Evidence', 'Grounding confidence', "How confident is Gemini's own source linkage?", 0.88, 0.05, '88% average linkage confidence', 'pass'),
        p('D1', 'D', 'Sources', 'Domain tier', 'Are these good sources?', 0.93, 0.12, '1 official, 1 reliable, 1 encyclopedia', 'pass'),
        p('D2', 'D', 'Sources', 'Corroboration', 'How many independent good sources agree?', 1, 0.05, '3 independent sources agree', 'pass'),
        p('D3', 'D', 'Sources', 'Independence', 'Are these sources actually independent?', 1, 0, 'All 3 sources are genuinely separate', 'pass', 'Sites sharing over 80% of their text are carrying the same news agency copy. We count them once.'),
        p('D4', 'D', 'Sources', 'Recency', 'Is the evidence current enough?', 1, 0.03, 'Not time-sensitive — age does not matter here', 'pass'),
        p('E1', 'E', 'Question type', 'Volatility', 'Can the true answer change over time?', 1, 0, 'Static fact — the answer will not change', 'pass'),
        p('E2', 'E', 'Question type', 'Grounding coverage', 'Did the model search at all?', 1, 0, 'Searched the web and used 3 pages', 'pass'),
      ],
      claims: [
        { id: 'c1', text: 'Python was created by Guido van Rossum.', standalone: 'Python was created by Guido van Rossum.', span: [0, 39], verdict: 'SUPPORTED', quote: 'Python was created in the early 1990s by Guido van Rossum', quoteVerified: true, sourceIds: ['s1'], note: null },
        { id: 'c2', text: 'He began work on it in the late 1980s at CWI in the Netherlands.', standalone: 'Guido van Rossum began work on Python in the late 1980s at CWI in the Netherlands.', span: [40, 104], verdict: 'SUPPORTED', quote: 'at Stichting Mathematisch Centrum in the Netherlands', quoteVerified: true, sourceIds: ['s1', 's2'], note: null },
        { id: 'c3', text: 'The first public release, version 0.9.0, came in February 1991.', standalone: 'The first public release of Python, version 0.9.0, came in February 1991.', span: [105, 168], verdict: 'SUPPORTED', quote: 'Python 0.9.0 was released in February 1991', quoteVerified: true, sourceIds: ['s2', 's3'], note: null },
      ],
      sources: [
        { id: 's1', url: 'https://docs.python.org/3/faq/general.html', domain: 'python.org', title: 'General Python FAQ', tier: 'T0', tierLabel: 'Official', trustScore: 1, badge: 'official', snippet: 'Python was created in the early 1990s by Guido van Rossum at Stichting Mathematisch Centrum in the Netherlands as a successor of a language called ABC.', publishedAt: null, verificationPath: ['primary source for claims about Python'], duplicateOf: null, fetchFailed: false },
        { id: 's2', url: 'https://en.wikipedia.org/wiki/Python_(programming_language)', domain: 'wikipedia.org', title: 'Python (programming language)', tier: 'T3', tierLabel: 'Encyclopedia', trustScore: 0.65, badge: 'mixed', snippet: 'Python 0.9.0 was released in February 1991. It already included exception handling, functions, and the core datatypes.', publishedAt: '2026-08-11', verificationPath: ['in registry: Encyclopedia (T3)'], duplicateOf: null, fetchFailed: false },
        { id: 's3', url: 'https://www.britannica.com/technology/Python-computer-language', domain: 'britannica.com', title: 'Python | Definition, Uses & Facts', tier: 'T2', tierLabel: 'Reliable', trustScore: 0.85, badge: 'reliable', snippet: 'Python was conceived in the late 1980s and first released in 1991 by Guido van Rossum.', publishedAt: '2025-03-02', verificationPath: ['in registry: WP:RSP Generally Reliable (T2)'], duplicateOf: null, fetchFailed: false },
      ],
      perplexity: { value: 3.2, interpretation: 'low', caption: 'Low — the model was confident in its wording' },
      timing: { totalMs: 9840, cached: false },
      searchSuggestionHtml: null,
    },
  },

  // ---------------------------------------------------------------- UNCERTAIN
  {
    key: 'uncertain',
    question: 'Who is the current CEO of Northwind Systems?',
    answer:
      'As of the most recent reporting, the CEO of Northwind Systems is Ana Ramirez. She was appointed in March 2025.',
    verdict: {
      label: 'UNCERTAIN',
      score: 0.68,
      headline: 'This answer can change over time and no source is recent',
      reasons: [
        'The claim is supported, but the newest source is 8 months old',
        'This is the kind of fact that changes without warning',
        '3 sources were cited, but 2 are the same wire story',
      ],
      warnings: [
        'Newest source is 258 days old',
        '3 sources found, but only 2 are genuinely independent',
      ],
      overrides: [
        { rule: 'VOLATILE_STALE', message: 'This answer can change over time and no source is recent', cappedAt: 'UNCERTAIN' },
      ],
      parameters: [
        p('A1', 'A', 'Answer confidence', 'Perplexity', 'How surprised was the model by its own words?', 0.71, 0, '6.1 — moderate', 'info'),
        p('A2', 'A', 'Answer confidence', 'Weakest token', "Where is the answer's most fragile word?", 0.62, 0.03, 'Least certain word: "recent" (62%)', 'warn'),
        p('A3', 'A', 'Answer confidence', 'Entity confidence', 'How confident on the parts that can actually be wrong?', 0.81, 0.07, '81% average on names, dates and numbers', 'pass'),
        p('A4', 'A', 'Answer confidence', 'Hedging language', 'Is the model hedging in its own words?', 0.5, 0, 'The model hedged 1 time', 'info'),
        p('B1', 'B', 'Consistency', 'Semantic agreement', 'Does the model agree with itself?', 1, 0.15, '3 of 3 runs gave the same answer', 'pass'),
        p('C1', 'C', 'Evidence', 'Citation coverage', 'How much of the answer is backed by any source?', 1, 0.15, '2 of 2 sentences cite a source', 'pass'),
        p('C2', 'C', 'Evidence', 'Quote verification', 'Does the cited page actually say this?', 1, 0.35, '2 of 2 claims verified word-for-word on the page', 'pass', 'We re-fetch every cited page, demand a verbatim supporting quote, then check that quote really appears in the page text.'),
        p('C3', 'C', 'Evidence', 'Specificity leak', 'Did the model invent a detail no source contains?', 1, 0.05, 'Every name and date appears in a source', 'pass'),
        p('C4', 'C', 'Evidence', 'Contradiction', 'Does any source say the opposite?', 1, 0, 'No source contradicts the answer', 'pass'),
        p('C5', 'C', 'Evidence', 'Grounding confidence', "How confident is Gemini's own source linkage?", 0.8, 0.05, '80% average linkage confidence', 'pass'),
        p('D1', 'D', 'Sources', 'Domain tier', 'Are these good sources?', 0.85, 0.12, '2 reliable, 1 unknown', 'pass'),
        p('D2', 'D', 'Sources', 'Corroboration', 'How many independent good sources agree?', 0.8, 0.05, '2 independent sources agree', 'pass'),
        p('D3', 'D', 'Sources', 'Independence', 'Are these sources actually independent?', 0.66, 0, '3 sources, but 1 is the same wire story — counted as 2', 'warn', 'Two pages share 94% of their text, which means they are carrying the same news agency copy. We count them once.'),
        p('D4', 'D', 'Sources', 'Recency', 'Is the evidence current enough?', 0.25, 0.03, 'Newest source is 258 days old', 'fail'),
        p('E1', 'E', 'Question type', 'Volatility', 'Can the true answer change over time?', 0.2, 0, 'Time-sensitive — this can change without notice', 'warn'),
        p('E2', 'E', 'Question type', 'Grounding coverage', 'Did the model search at all?', 1, 0, 'Searched the web and used 3 pages', 'pass'),
      ],
      claims: [
        { id: 'c1', text: 'As of the most recent reporting, the CEO of Northwind Systems is Ana Ramirez.', standalone: 'The CEO of Northwind Systems is Ana Ramirez.', span: [0, 77], verdict: 'SUPPORTED', quote: 'Ramirez was appointed chief executive in March 2025', quoteVerified: true, sourceIds: ['s1'], note: 'Supported, but the newest source is 258 days old' },
        { id: 'c2', text: 'She was appointed in March 2025.', standalone: 'Ana Ramirez was appointed CEO of Northwind Systems in March 2025.', span: [78, 110], verdict: 'SUPPORTED', quote: 'appointed chief executive in March 2025', quoteVerified: true, sourceIds: ['s1', 's2'], note: null },
      ],
      sources: [
        { id: 's1', url: 'https://www.reuters.com/business/northwind-ceo', domain: 'reuters.com', title: 'Northwind names new chief executive', tier: 'T2', tierLabel: 'Reliable', trustScore: 0.85, badge: 'reliable', snippet: 'Ramirez was appointed chief executive in March 2025, succeeding the founder after a six-month search.', publishedAt: '2025-03-14', verificationPath: ['in registry: WP:RSP Generally Reliable (T2)'], duplicateOf: null, fetchFailed: false },
        { id: 's2', url: 'https://sector-weekly.example/leadership-moves', domain: 'sector-weekly.example', title: 'Leadership moves this quarter', tier: 'T4', tierLabel: 'Unknown', trustScore: 0.7, badge: 'unknown', snippet: 'Ramirez was appointed chief executive in March 2025, succeeding the founder after a six-month search.', publishedAt: '2025-03-14', verificationPath: ['not in registry', 'domain age 6 years', 'has named author and about page', 'text 94% identical to s1 — same wire story', 'agrees with 2 higher-tier sources — promoted to 0.70'], duplicateOf: 's1', fetchFailed: false },
        { id: 's3', url: 'https://www.bbc.com/news/business/northwind', domain: 'bbc.com', title: 'Northwind appoints Ramirez as chief executive', tier: 'T2', tierLabel: 'Reliable', trustScore: 0.85, badge: 'reliable', snippet: 'The company confirmed the appointment in a statement to the market.', publishedAt: '2025-03-15', verificationPath: ['in registry: WP:RSP Generally Reliable (T2)'], duplicateOf: null, fetchFailed: false },
      ],
      perplexity: { value: 6.1, interpretation: 'moderate', caption: 'Moderate — the model was reasonably sure of its wording' },
      timing: { totalMs: 11230, cached: false },
      searchSuggestionHtml: null,
    },
  },

  // ------------------------------------------------------- NEEDS VERIFICATION
  {
    key: 'fabricated',
    question: 'How much funding did the National Skills Programme receive in its first year?',
    answer:
      'The National Skills Programme received $4.2 million in first-year funding. It was expanded nationally the following year.',
    verdict: {
      label: 'NEEDS_VERIFICATION',
      score: 0.24,
      headline: 'The cited page does not contain this claim',
      reasons: [
        'The model produced a supporting quote that does not appear on the page',
        'The figure "$4.2 million" appears in none of the sources',
        'Only 1 of 3 runs gave this answer',
      ],
      warnings: [
        'A quote was fabricated — the cited page does not contain it',
        '1 source could not be verified',
        'Do not rely on this answer without checking it yourself',
      ],
      overrides: [
        { rule: 'SPECIFICITY_LEAK', message: 'The model produced a quote that is not on the cited page', cappedAt: 'NEEDS_VERIFICATION' },
      ],
      parameters: [
        p('A1', 'A', 'Answer confidence', 'Perplexity', 'How surprised was the model by its own words?', 0.86, 0, '2.6 — low', 'info', 'The model sounded confident. Low perplexity measures fluency, not truth — this is exactly the case the tool exists to catch.'),
        p('A2', 'A', 'Answer confidence', 'Weakest token', "Where is the answer's most fragile word?", 0.41, 0.03, 'Least certain word: "4.2" (41%)', 'fail'),
        p('A3', 'A', 'Answer confidence', 'Entity confidence', 'How confident on the parts that can actually be wrong?', 0.48, 0.07, '48% average on names, dates and numbers', 'fail', 'The sentence reads fluently but the model is unsure of the specific figures — the classic shape of a fabricated detail.'),
        p('A4', 'A', 'Answer confidence', 'Hedging language', 'Is the model hedging in its own words?', 1, 0, 'No hedging — the answer sounds certain', 'info'),
        p('B1', 'B', 'Consistency', 'Semantic agreement', 'Does the model agree with itself?', 0.33, 0.15, 'Only 1 of 3 runs gave this answer', 'fail'),
        p('B2', 'B', 'Consistency', 'Entity stability', 'Does the key fact flip between runs?', 0, 0, 'Figure varied across runs: $4.2M / $3.8M / $5.1M', 'fail', 'A model that knows a number repeats it. A model that is guessing produces a different one each time.'),
        p('C1', 'C', 'Evidence', 'Citation coverage', 'How much of the answer is backed by any source?', 0.5, 0.15, '1 of 2 sentences cites a source', 'warn'),
        p('C2', 'C', 'Evidence', 'Quote verification', 'Does the cited page actually say this?', 0, 0.35, '0 of 2 claims could be verified on the cited page', 'fail', 'The model cited a real, reputable article and produced a quote to support the claim. We fetched the page. The quote is not in it.'),
        p('C3', 'C', 'Evidence', 'Specificity leak', 'Did the model invent a detail no source contains?', 0, 0.05, '"$4.2 million" appears in no source', 'fail'),
        p('C4', 'C', 'Evidence', 'Contradiction', 'Does any source say the opposite?', 1, 0, 'No source contradicts it — but none supports it either', 'pass'),
        p('C5', 'C', 'Evidence', 'Grounding confidence', "How confident is Gemini's own source linkage?", 0.72, 0.05, '72% average linkage confidence', 'warn', 'Gemini reported reasonable confidence in its own citation. Independent checking disagreed.'),
        p('D1', 'D', 'Sources', 'Domain tier', 'Are these good sources?', 0.63, 0.12, '1 reliable, 1 unknown', 'warn'),
        p('D2', 'D', 'Sources', 'Corroboration', 'How many independent good sources agree?', 0, 0.05, 'No source supports the claim', 'fail'),
        p('D3', 'D', 'Sources', 'Independence', 'Are these sources actually independent?', 1, 0, 'The 2 sources are genuinely separate', 'pass'),
        p('D4', 'D', 'Sources', 'Recency', 'Is the evidence current enough?', 0.8, 0.03, 'Newest source is 94 days old', 'pass'),
        p('E1', 'E', 'Question type', 'Volatility', 'Can the true answer change over time?', 0.6, 0, 'Slow-changing fact', 'pass'),
        p('E2', 'E', 'Question type', 'Grounding coverage', 'Did the model search at all?', 1, 0, 'Searched the web and used 2 pages', 'pass'),
      ],
      claims: [
        { id: 'c1', text: 'The National Skills Programme received $4.2 million in first-year funding.', standalone: 'The National Skills Programme received $4.2 million in first-year funding.', span: [0, 73], verdict: 'NOT_FOUND', quote: 'the initiative received $4.2 million in first-year funding', quoteVerified: false, sourceIds: ['s1'], note: 'The model produced this quote to support the claim. It does not appear anywhere on the cited page.' },
        { id: 'c2', text: 'It was expanded nationally the following year.', standalone: 'The National Skills Programme was expanded nationally the year after its first year.', span: [74, 119], verdict: 'NOT_FOUND', quote: null, quoteVerified: false, sourceIds: [], note: 'No source was cited for this sentence' },
      ],
      sources: [
        { id: 's1', url: 'https://www.reuters.com/world/skills-programme-launch', domain: 'reuters.com', title: 'New skills programme launches nationwide', tier: 'T2', tierLabel: 'Reliable', trustScore: 0.85, badge: 'reliable', snippet: 'The programme launched this spring following a pilot in three regions. Officials declined to give a figure for its budget, saying details would follow the next review.', publishedAt: '2026-06-01', verificationPath: ['in registry: WP:RSP Generally Reliable (T2)'], duplicateOf: null, fetchFailed: false },
        { id: 's2', url: 'https://policy-notes.example/briefing', domain: 'policy-notes.example', title: 'Policy briefing', tier: 'T4', tierLabel: 'Unknown', trustScore: 0, badge: 'unknown', snippet: '', publishedAt: null, verificationPath: ['not in registry', 'domain registered 4 months ago', 'no named author', 'page could not be fetched — contributes nothing'], duplicateOf: null, fetchFailed: true },
      ],
      perplexity: { value: 2.6, interpretation: 'low', caption: 'Low — but low perplexity means fluent, not correct' },
      timing: { totalMs: 12470, cached: false },
      searchSuggestionHtml: null,
    },
  },

  // ----------------------------------------------------------- NOT APPLICABLE
  {
    key: 'social',
    question: 'thanks, that helps',
    answer: "Glad it helped. Ask me anything else you'd like checked.",
    verdict: {
      label: 'NOT_APPLICABLE',
      score: 0,
      headline: 'Not a factual claim',
      reasons: ['This message does not assert anything that can be checked'],
      warnings: [],
      overrides: [],
      parameters: [],
      claims: [],
      sources: [],
      perplexity: null,
      timing: { totalMs: 420, cached: false },
      searchSuggestionHtml: null,
    },
  },
]

export const findDemo = (q: string): DemoCase => {
  const s = q.toLowerCase()
  if (/thank|thanks|hi|hello|hey|cheers/.test(s)) return DEMO_CASES[3]
  if (/fund|million|budget|revenue|cost|\$/.test(s)) return DEMO_CASES[2]
  if (/ceo|current|latest|now|today|president|leader/.test(s)) return DEMO_CASES[1]
  return DEMO_CASES[0]
}
