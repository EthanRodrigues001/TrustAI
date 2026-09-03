# Problem Brief (verbatim)

**Source:** printed handout, TCS Tech Day @ Fr. C. Rodrigues Institute of
Technology. Transcribed 2026-09-03. This file is the source of truth for scope.

---

## P6 — AI Hallucination Confidence Labeler

| Theme | AI Feature Expected | Prototype Scope |
|---|---|---|
| Responsible Enterprise AI | Confidence labeling + uncertainty explanation | Input question; output answer + reliability tag |

### Problem Statement

AI answers can sound confident even when they are uncertain, incomplete, or not
supported by evidence. Build a prototype that answers a question and labels the
answer as Certain, Uncertain, or Needs Verification. The tool should help users
understand when they can trust the answer and when they should verify it. The
focus is reliability awareness, not perfect accuracy.

### Data Considerations

Use sample questions, AI-generated answers, optional source snippets, and
expected reliability labels. Include examples where the answer is supported,
partially supported, or unsupported. Keep sources short so students can compare
quickly.

> **Example** — Question: "Who invented Python?" Answer: "Guido van Rossum."
> Reliability tag: Certain, if supported by the given source.

### Solution Expectations

Build a simple Q&A reliability checker. Compare the generated answer with
available source text or known support signals. Output the answer, reliability
tag, short reason, and warning if evidence is missing or weak. **Include
Perplexity metric.** Keep the interface simple for quick testing during the mini
hackathon.

> Prototype target: simple input, AI/ML models, rule logic, risk/explanation
> output, and demo.

---

## Explicit deliverables checklist

- [ ] Question input
- [ ] Answer output
- [ ] Reliability tag: Certain / Uncertain / Needs Verification
- [ ] Short reason for the tag
- [ ] Warning when evidence is missing or weak
- [ ] **Perplexity metric shown**
- [ ] Sample dataset with expected labels (supported / partial / unsupported)
- [ ] Simple interface for quick testing
- [ ] Demo
