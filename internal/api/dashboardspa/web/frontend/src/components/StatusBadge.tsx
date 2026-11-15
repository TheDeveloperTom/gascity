import type { ReactNode } from 'react';
import { StatusShape } from './icons';

// Status is a street signal: shape + word + colour, in that order of
// importance. Strip colour (the greyscale test) and the badge still reads.
// The pill is the default; `inline` drops the fill and padding so the badge
// can sit inside a sentence. The tone colour lives on the root only, so the
// One Mark Rule counts (`.text-accent`) do not change.

export type StatusTone = 'ok' | 'warn' | 'stuck' | 'neutral';

interface StatusBadgeProps {
  tone: StatusTone;
  label: ReactNode;
  /** Override the default shape with a text glyph (e.g. `◐`). */
  glyph?: ReactNode;
  /** Extra trailing meta (e.g. "attached"). */
  trailing?: ReactNode;
  /** `pill` (default) or `inline` for use inside a sentence. */
  variant?: 'pill' | 'inline';
  className?: string;
  title?: string;
}

const TONE_COLOR: Record<StatusTone, string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  stuck: 'text-accent',
  neutral: 'text-fg-muted',
};

const TONE_FILL: Record<StatusTone, string> = {
  ok: 'bg-ok/10',
  warn: 'bg-warn/10',
  stuck: 'bg-accent/10',
  neutral: 'bg-fg/[0.06]',
};

export function StatusBadge({
  tone,
  label,
  glyph,
  trailing,
  variant = 'pill',
  className = '',
  title,
}: StatusBadgeProps) {
  const shape = variant === 'pill' ? `rounded-full px-2 py-0.5 ${TONE_FILL[tone]}` : '';
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1.5 align-middle text-label font-medium ${TONE_COLOR[tone]} ${shape} ${className}`}
      // A text label can be cut by `truncate` in a narrow cell; the title
      // keeps the full word one hover away. An explicit title wins.
      title={title ?? (typeof label === 'string' ? label : undefined)}
    >
      {glyph !== undefined ? (
        <span aria-hidden="true" className="leading-none">
          {glyph}
        </span>
      ) : (
        <StatusShape tone={tone} />
      )}
      <span className="min-w-0 truncate">{label}</span>
      {trailing && <span className="shrink-0 text-fg-muted">{trailing}</span>}
    </span>
  );
}

export function beadStatusTone(status: string): StatusTone {
  switch (status) {
    case 'closed':
      return 'neutral';
    case 'in_progress':
      return 'ok';
    case 'blocked':
      return 'stuck';
    case 'open':
    case 'deferred':
    default:
      return 'warn';
  }
}

// Single source of truth for session/agent state → tone mapping. Aligned with
// how the gc supervisor emits agent (and session) states. Unknown states
// default to neutral so we don't lie about them. 'detached' is explicit (not a
// silent default) so reviewers see the intent. Co-located with the other tone
// mappers here so display components depend only on StatusBadge, not on the
// Agents route (which would be an import cycle: Agents imports WorkInFlight,
// WorkInFlight imported stateTone from Agents).
export function stateTone(state: string): StatusTone {
  switch (state) {
    case 'active':
    case 'running':
      return 'ok';
    case 'rate-limited':
    case 'rate_limited':
    case 'waiting':
      return 'warn';
    case 'failed':
    case 'closed':
    case 'errored':
    case 'stuck':
      return 'stuck';
    case 'detached':
    case 'asleep':
    case 'idle':
    case 'creating':
    default:
      return 'neutral';
  }
}
