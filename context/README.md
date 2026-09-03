# context/

`../PLAN.md` is the master plan. This folder is the reference behind it.

Durable memory for this project. Anyone (human or AI) picking up work here
should read `00-overview.md` first, then `03-decisions.md`.

| File | What it holds | Update when |
|---|---|---|
| `00-overview.md` | What we're building and why, in plain language | Scope changes |
| `01-problem-brief.md` | The original TCS problem statement, verbatim | Never (source of truth) |
| `02-architecture.md` | Pipeline, signals, scoring, file layout | Design changes |
| `05-parameters.md` | Every trust parameter: formula, weight, UI mapping | Parameters change |
| `06-api-contract.md` | **Frozen** backend/frontend boundary. Types + stream events | Never, ideally |
| `03-decisions.md` | Decision log — what we chose and why | A choice gets made |
| `04-progress.md` | Phase status, what's done, what's next | End of each work session |
| `logs/` | Chat session logs, one file per session | End of each session |

## Team split

**Backend (Ethan):** Gemini pipeline, all signals, scoring, `/api/chat`.
**Frontend (team):** chat UI, trust badges, parameter panel, source cards.

The boundary is `06-api-contract.md`. Build against it in parallel; do not
change it without telling the other side.

## Rules

1. **Decisions go in `03-decisions.md`, not in chat.** If it's only in a chat
   log, it will be lost.
2. **Log files are append-only.** Don't rewrite history; add a new entry.
3. **Naming:** `logs/YYYY-MM-DD-session-NN.md`
4. Keep entries short. This folder is a map, not a novel.
