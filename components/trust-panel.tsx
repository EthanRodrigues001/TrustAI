'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import type {
  Verdict, Label, Claim, Source, Parameter, EvidenceLocation,
} from '@/lib/types'

// ------------------------------------------------------------------ tokens

export const LABEL_UI: Record<Label, { text: string; dot: string; chip: string; ring: string }> = {
  CERTAIN: {
    text: 'Certain',
    dot: 'bg-emerald-500',
    chip: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/25',
    ring: 'border-emerald-500/30',
  },
  UNCERTAIN: {
    text: 'Uncertain',
    dot: 'bg-amber-500',
    chip: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/25',
    ring: 'border-amber-500/30',
  },
  NEEDS_VERIFICATION: {
    text: 'Needs verification',
    dot: 'bg-rose-500',
    chip: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/25',
    ring: 'border-rose-500/30',
  },
  NOT_APPLICABLE: {
    text: 'Not a factual claim',
    dot: 'bg-muted-foreground/40',
    chip: 'bg-muted text-muted-foreground border-border',
    ring: 'border-border',
  },
}

const STATUS_BAR: Record<Parameter['status'], string> = {
  pass: 'bg-emerald-500',
  warn: 'bg-amber-500',
  fail: 'bg-rose-500',
  info: 'bg-sky-500',
  skipped: 'bg-muted-foreground/30',
}

const CLAIM_UI: Record<Claim['verdict'], { label: string; cls: string; under: string }> = {
  SUPPORTED: { label: 'Supported', cls: 'text-emerald-600 dark:text-emerald-400', under: 'decoration-emerald-500' },
  PARTIAL: { label: 'Partly supported', cls: 'text-amber-600 dark:text-amber-400', under: 'decoration-amber-500' },
  NOT_FOUND: { label: 'Not found in source', cls: 'text-rose-600 dark:text-rose-400', under: 'decoration-rose-500' },
  CONTRADICTED: { label: 'Contradicted', cls: 'text-rose-600 dark:text-rose-400', under: 'decoration-rose-500' },
  UNCHECKED: { label: 'Unchecked', cls: 'text-muted-foreground', under: 'decoration-muted-foreground/40' },
}

const BADGE_UI: Record<Source['badge'], string> = {
  official: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/25',
  gov: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/25',
  reliable: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/25',
  mixed: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/25',
  unknown: 'bg-muted text-muted-foreground border-border',
  low: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/25',
}

// ------------------------------------------------------------------ badge

export function TrustBadge({
  label, score, onClick, open,
}: { label: Label; score: number; onClick?: () => void; open?: boolean }) {
  const ui = LABEL_UI[label]
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition',
        'hover:brightness-105 active:scale-[0.98]',
        ui.chip
      )}
    >
      <span className={cn('size-1.5 rounded-full', ui.dot)} />
      {ui.text}
      {label !== 'NOT_APPLICABLE' && (
        <span className="tabular-nums opacity-60">{Math.round(score * 100)}</span>
      )}
      <svg
        viewBox="0 0 12 12"
        className={cn('size-2.5 opacity-50 transition-transform', open && 'rotate-180')}
        fill="none" stroke="currentColor" strokeWidth="2"
      >
        <path d="M2 4l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  )
}

// ------------------------------------------------------------------ answer

/** Renders the answer with each claim underlined by its own verdict. */
export function AnnotatedAnswer({ text, claims }: { text: string; claims: Claim[] }) {
  if (!claims.length) return <p className="whitespace-pre-wrap leading-relaxed">{text}</p>

  const sorted = [...claims].sort((a, b) => a.span[0] - b.span[0])
  const out: React.ReactNode[] = []
  let cur = 0

  sorted.forEach((c, i) => {
    const [s, e] = c.span
    if (s > cur) out.push(<span key={`t${i}`}>{text.slice(cur, s)}</span>)
    const ui = CLAIM_UI[c.verdict]
    out.push(
      <span
        key={c.id}
        title={
          c.location
            ? `Verified on ${c.location.sourceId}${c.location.section ? ` under "${c.location.section}"` : ''}: “${c.location.matchedText}”`
            : c.note ?? ui.label
        }
        className={cn(
          'underline decoration-2 underline-offset-4 cursor-help',
          ui.under,
          c.verdict === 'NOT_FOUND' || c.verdict === 'CONTRADICTED'
            ? 'decoration-wavy'
            : ''
        )}
      >
        {text.slice(s, Math.min(e, text.length))}
      </span>
    )
    cur = Math.min(e, text.length)
  })
  if (cur < text.length) out.push(<span key="tail">{text.slice(cur)}</span>)

  return <p className="whitespace-pre-wrap leading-relaxed">{out}</p>
}

// ------------------------------------------------------------------ panel

const GROUPS = [
  { g: 'A', title: 'Answer confidence', sub: 'What the model itself revealed' },
  { g: 'B', title: 'Consistency', sub: 'Does it agree with itself?' },
  { g: 'C', title: 'Evidence', sub: 'Do the sources actually say it?' },
  { g: 'D', title: 'Sources', sub: 'Are the sources any good?' },
  { g: 'E', title: 'Question type', sub: 'Is this even answerable reliably?' },
] as const

export function TrustPanel({ verdict }: { verdict: Verdict }) {
  const [tab, setTab] = useState<'why' | 'params' | 'claims' | 'sources'>('why')
  const v = verdict

  if (v.label === 'NOT_APPLICABLE') {
    return (
      <div className="rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">
        {v.headline} — nothing here can be checked against a source.
      </div>
    )
  }

  const tabs = [
    { k: 'why', n: 'Why' },
    { k: 'params', n: `Parameters (${v.parameters.length})` },
    { k: 'claims', n: `Claims (${v.claims.length})` },
    { k: 'sources', n: `Sources (${v.sources.length})` },
  ] as const

  return (
    <div className={cn('rounded-xl border bg-card', LABEL_UI[v.label].ring)}>
      {/* header */}
      <div className="border-b px-4 py-3">
        <p className="text-sm font-medium">{v.headline}</p>
        <div className="mt-2 flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className={cn('h-full rounded-full transition-all', LABEL_UI[v.label].dot)}
              style={{ width: `${Math.round(v.score * 100)}%` }}
            />
          </div>
          <span className="text-xs tabular-nums text-muted-foreground">
            {Math.round(v.score * 100)}/100
          </span>
        </div>
      </div>

      {/* tabs */}
      <div className="flex gap-1 overflow-x-auto border-b px-2 py-1.5">
        {tabs.map((t) => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            className={cn(
              'whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition',
              tab === t.k
                ? 'bg-secondary text-secondary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {t.n}
          </button>
        ))}
      </div>

      <div className="p-4 text-sm">
        {tab === 'why' && <WhyTab v={v} />}
        {tab === 'params' && <ParamsTab v={v} />}
        {tab === 'claims' && <ClaimsTab v={v} />}
        {tab === 'sources' && <SourcesTab v={v} />}
      </div>
    </div>
  )
}

function WhyTab({ v }: { v: Verdict }) {
  return (
    <div className="space-y-4">
      {v.overrides.length > 0 && (
        <div className="space-y-2">
          {v.overrides.map((o, i) => (
            <div
              key={i}
              className="flex gap-2 rounded-lg border border-rose-500/25 bg-rose-500/5 px-3 py-2"
            >
              <span className="mt-0.5 text-rose-500">!</span>
              <div>
                <p className="font-medium text-rose-700 dark:text-rose-300">{o.message}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Rule <code className="font-mono">{o.rule}</code> — capped the label at{' '}
                  {LABEL_UI[o.cappedAt].text.toLowerCase()} regardless of the score
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      <ul className="space-y-1.5">
        {v.reasons.map((r, i) => (
          <li key={i} className="flex gap-2 text-muted-foreground">
            <span className="mt-1.5 size-1 shrink-0 rounded-full bg-muted-foreground/50" />
            {r}
          </li>
        ))}
      </ul>

      {v.warnings.length > 0 && (
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">
            Warnings
          </p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {v.warnings.map((w, i) => <li key={i}>· {w}</li>)}
          </ul>
        </div>
      )}

      {v.perplexity && (
        <div className="flex items-baseline gap-3 rounded-lg border bg-muted/30 px-3 py-2">
          <span className="font-mono text-lg tabular-nums">{v.perplexity.value}</span>
          <div className="min-w-0">
            <p className="text-xs font-medium">Perplexity</p>
            <p className="text-xs text-muted-foreground">{v.perplexity.caption}</p>
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Analysed in {(v.timing.totalMs / 1000).toFixed(1)}s
        {v.timing.cached && ' · cached'}
      </p>
    </div>
  )
}

function ParamsTab({ v }: { v: Verdict }) {
  return (
    <div className="space-y-5">
      {GROUPS.map(({ g, title, sub }) => {
        const items = v.parameters.filter((p) => p.group === g)
        if (!items.length) return null
        return (
          <div key={g}>
            <div className="mb-2">
              <p className="text-xs font-semibold uppercase tracking-wide">{title}</p>
              <p className="text-xs text-muted-foreground">{sub}</p>
            </div>
            <div className="space-y-2">
              {items.map((p) => (
                <div key={p.id} className="rounded-lg border px-3 py-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 font-medium">
                        <code className="rounded bg-muted px-1 font-mono text-[10px] text-muted-foreground">
                          {p.id}
                        </code>
                        {p.name}
                        {p.weight > 0 && (
                          <span className="text-[10px] text-muted-foreground">
                            ×{p.weight.toFixed(2)}
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-xs italic text-muted-foreground">{p.question}</p>
                      <p className="mt-1 text-xs">{p.display}</p>
                      {p.detail && (
                        <p className="mt-1 text-xs text-muted-foreground">{p.detail}</p>
                      )}
                    </div>
                    <div className="w-16 shrink-0">
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn('h-full rounded-full', STATUS_BAR[p.status])}
                          style={{ width: `${Math.round(p.score * 100)}%` }}
                        />
                      </div>
                      <p className="mt-1 text-right text-[10px] tabular-nums text-muted-foreground">
                        {p.status === 'skipped' ? '—' : Math.round(p.score * 100)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function whereOnPage(p: number): string {
  if (p < 0.15) return 'near the top of the page'
  if (p < 0.4) return 'in the first third of the page'
  if (p < 0.6) return 'about halfway down the page'
  if (p < 0.85) return 'in the last third of the page'
  return 'near the bottom of the page'
}

/** Shows exactly where the quote was found, so it can be checked. */
function Provenance({ loc, source }: { loc: EvidenceLocation; source?: Source }) {
  return (
    <div className="mt-2 rounded-lg border bg-muted/30 px-2.5 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        Found on the page
      </p>

      <p className="mt-1 text-xs">
        {source && (
          <span className="font-medium">{source.domain}</span>
        )}
        {loc.section && (
          <>
            {source && <span className="text-muted-foreground"> · </span>}
            <span>under &ldquo;{loc.section}&rdquo;</span>
          </>
        )}
        <span className="text-muted-foreground">
          {source || loc.section ? ' · ' : ''}
          {whereOnPage(loc.position)}
        </span>
      </p>

      {/* the quote in situ, so the surrounding text is visible too */}
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
        {loc.contextBefore && <>&hellip;{loc.contextBefore}</>}
        <mark className="rounded bg-emerald-500/20 px-0.5 text-foreground">
          {loc.matchedText}
        </mark>
        {loc.contextAfter && <>{loc.contextAfter}&hellip;</>}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <a
          href={loc.deepLink}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-medium underline underline-offset-2 hover:no-underline"
        >
          Open the page at this passage
        </a>
        <span className="font-mono text-[10px] text-muted-foreground">
          char {loc.offset.toLocaleString()}
          {loc.method === 'fuzzy' && ' · near match'}
        </span>
      </div>
    </div>
  )
}

function ClaimsTab({ v }: { v: Verdict }) {
  if (!v.claims.length) {
    return <p className="text-muted-foreground">No individual claims were extracted.</p>
  }
  return (
    <div className="space-y-2">
      {v.claims.map((c) => {
        const ui = CLAIM_UI[c.verdict]
        const source = v.sources.find((s) => c.sourceIds.includes(s.id))
        return (
          <div key={c.id} className="rounded-lg border px-3 py-2.5">
            <p className="font-medium">{c.text}</p>
            <p className={cn('mt-1.5 text-xs font-medium', ui.cls)}>{ui.label}</p>

            {c.quote && (
              <blockquote
                className={cn(
                  'mt-2 border-l-2 pl-3 text-xs italic',
                  c.quoteVerified
                    ? 'border-emerald-500/40 text-muted-foreground'
                    : 'border-rose-500/50 text-rose-600 line-through decoration-rose-500/50 dark:text-rose-400'
                )}
              >
                &ldquo;{c.quote}&rdquo;
              </blockquote>
            )}

            {c.location && <Provenance loc={c.location} source={source} />}

            {c.sourceIds.length > 1 && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                The same fact is independently stated by{' '}
                {c.sourceIds
                  .slice(1)
                  .map((id) => v.sources.find((s) => s.id === id)?.domain ?? id)
                  .join(', ')}
                .
              </p>
            )}

            {c.quote && !c.quoteVerified && (
              <p className="mt-1.5 rounded bg-rose-500/10 px-2 py-1 text-xs text-rose-700 dark:text-rose-300">
                This quote appears on none of the pages we read. The model invented it.
              </p>
            )}

            {c.note && !c.quote && (
              <p className="mt-1.5 text-xs text-muted-foreground">{c.note}</p>
            )}
          </div>
        )
      })}
    </div>
  )
}

function SourcesTab({ v }: { v: Verdict }) {
  if (!v.sources.length) {
    return (
      <p className="text-muted-foreground">
        No sources — this answer came from the model&rsquo;s training data alone.
      </p>
    )
  }
  return (
    <div className="space-y-2">
      {v.sources.map((s) => (
        <div
          key={s.id}
          className={cn('rounded-lg border px-3 py-2.5', s.duplicateOf && 'opacity-70')}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="line-clamp-1 font-medium hover:underline"
              >
                {s.title}
              </a>
              <p className="font-mono text-xs text-muted-foreground">{s.domain}</p>
            </div>
            <span
              className={cn(
                'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium',
                BADGE_UI[s.badge]
              )}
            >
              {s.tierLabel}
            </span>
          </div>

          {s.snippet && (
            <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">{s.snippet}</p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
            <span>trust {s.trustScore.toFixed(2)}</span>
            {s.publishedAt && <span>{s.publishedAt.slice(0, 10)}</span>}
            {s.duplicateOf && <span className="text-amber-600">same story as {s.duplicateOf}</span>}
            {s.fetchFailed && <span className="text-rose-600">could not be read</span>}
          </div>

          {s.verificationPath.length > 0 && (
            <details className="mt-2 group">
              <summary className="cursor-pointer text-[10px] uppercase tracking-wide text-muted-foreground hover:text-foreground">
                How we classified this
              </summary>
              <ol className="mt-1.5 space-y-1 border-l pl-3 text-xs text-muted-foreground">
                {s.verificationPath.map((step, i) => (
                  <li key={i}>{i + 1}. {step}</li>
                ))}
              </ol>
            </details>
          )}
        </div>
      ))}
    </div>
  )
}
