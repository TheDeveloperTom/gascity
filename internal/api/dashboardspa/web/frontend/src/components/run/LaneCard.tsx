import type { RunLane } from 'gas-city-dashboard-shared';
import { Link } from 'react-router';
import type { BadgeSeverity } from '../../attention/compose';
import { attentionListItemProps } from '../../attention/routeHighlight';
import { formatRelative } from '../../hooks/time';
import { runDetailHref } from '../../supervisor/runHref';
import { StageLadder } from './StageLadder';
import { ExternalLink } from '../../vk/ExternalLink';

// One lane row inside a RunMap panel (hairline dividers between rows). The
// phase pill and the title link lead, the updated time sits right, then the
// stage ladder (shared with the run-detail view), then the root id,
// assignees and status counts. Reads in greyscale: phase identity comes from
// the pill's word + stage glyphs, not color.

interface LaneCardProps {
  lane: RunLane;
  now: number;
  attentionSeverity?: BadgeSeverity | null;
  /**
   * gascity-dashboard-2j8e.2: why-blocked + how-to-unblock, shown only in the
   * Blocked section so a blocked run reads as actionable (which step, what to
   * do) rather than just "blocked". Derived by selectBlockedRuns.
   */
  blocked?: { reason: string; remedy: string };
}

/**
 * gascity-dashboard-f4ps: historical (closed) lanes carry
 * `health: { status: 'unavailable' }` because run health is derived only for
 * the active subset. The health concepts (thrashing, stalled-session) are
 * meaningless for completed runs.
 *
 * Single source for the historical predicate so any future UI that wants to
 * surface health-derived signal can gate on it without re-stating the rule.
 */
export function isHistoricalLane(lane: RunLane): boolean {
  return lane.phase === 'complete';
}

function phaseLabelTone(phase: RunLane['phase']): 'text-accent' | 'text-fg-muted' | 'text-fg' {
  if (phase === 'blocked') return 'text-accent';
  if (phase === 'complete') return 'text-fg-muted';
  return 'text-fg';
}

export function LaneCard({ lane, now, attentionSeverity = null, blocked }: LaneCardProps) {
  const statusEntries = Object.entries(lane.statusCounts).sort((a, b) =>
    statusSortKey(a[0]).localeCompare(statusSortKey(b[0])),
  );
  const { className: attentionClassName = '', ...attentionProps } =
    attentionListItemProps(attentionSeverity);

  return (
    <li
      {...attentionProps}
      className={`px-4 py-3.5 transition-colors duration-150 ease-out-quart ${attentionClassName}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <span
            className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-label font-medium ${PHASE_FILL[phaseLabelTone(lane.phase)]} ${phaseLabelTone(lane.phase)}`}
          >
            {lane.phaseLabel}
            {lane.stale && (
              <span
                className="ml-1.5 text-fg-faint"
                title={
                  lane.staleSince ? `no activity since ${lane.staleSince}` : 'no recent activity'
                }
              >
                · stale
              </span>
            )}
          </span>
          <Link
            to={runDetailHref(lane.id, lane.scope)}
            className="focus-mark min-w-0 rounded-sm text-body font-medium text-fg leading-snug [overflow-wrap:anywhere] hover:text-primary hover:underline"
          >
            {lane.title}
          </Link>
        </div>
        <span
          className="shrink-0 text-label text-fg-muted tnum"
          title={lane.updatedAt.status === 'available' ? lane.updatedAt.at : lane.updatedAt.error}
        >
          {lane.updatedAt.status === 'available' ? formatRelative(lane.updatedAt.at, now) : '·'}
        </span>
      </div>

      {(lane.external.status !== 'unavailable' || lane.formula.status === 'known') && (
        <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-label">
          {lane.external.status !== 'unavailable' &&
            (lane.external.status === 'available' ? (
              <ExternalLink
                href={lane.external.url}
                className="rounded-sm font-medium text-primary underline-offset-2 hover:underline focus-mark"
              >
                {lane.external.label}
              </ExternalLink>
            ) : (
              <span className="font-medium text-fg-muted">{lane.external.label}</span>
            ))}
          {lane.formula.status === 'known' && (
            <span className="text-fg-muted">{lane.formula.name}</span>
          )}
        </div>
      )}

      <StageLadder stages={lane.stages} label={lane.title} />

      <div className="mt-2 flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1 text-label text-fg-muted">
        <span className={ID_TAG} title="run root bead">
          {lane.id}
        </span>
        {lane.activeAssignees.length > 0 && (
          <span className="flex min-w-0 max-w-full items-baseline gap-1">
            <span className="shrink-0 text-fg-faint">on</span>
            {lane.activeAssignees.map((assignee, index) => (
              <span
                key={assignee}
                className={`${ID_TAG} inline-block min-w-0 max-w-[16rem] truncate align-bottom`}
                title={assignee}
              >
                {assignee}
                {index < lane.activeAssignees.length - 1 ? ',' : ''}
              </span>
            ))}
          </span>
        )}
        {statusEntries.length > 0 && (
          <span className="tnum">
            {statusEntries
              .map(([status, count]) => `${count} ${status.replace(/_/g, ' ')}`)
              .join(' · ')}
          </span>
        )}
      </div>

      {blocked !== undefined && (
        <div className="mt-2.5">
          <p className="text-body text-fg leading-snug">
            <span aria-hidden="true" className="text-accent">
              ✕
            </span>{' '}
            {blocked.reason}
          </p>
          <p className="mt-1 text-body text-fg-muted leading-snug">{blocked.remedy}</p>
        </div>
      )}
    </li>
  );
}

// Copyable identifiers (run root, sessions) are id tags (DESIGN-PLAN §7).
const ID_TAG = 'font-mono text-[0.8125rem] text-fg-muted';

// The phase pill's fill. The tone class itself (text-accent / text-fg-muted /
// text-fg) stays on the pill, so the complete-phase pin keeps holding.
const PHASE_FILL: Record<ReturnType<typeof phaseLabelTone>, string> = {
  'text-accent': 'bg-accent/10',
  'text-fg-muted': 'bg-fg/[0.06]',
  'text-fg': 'bg-surface-tint',
};

function statusSortKey(status: string): string {
  const order: Record<string, string> = {
    blocked: '0',
    in_progress: '1',
    open: '2',
    closed: '3',
  };
  return `${order[status] ?? '9'}-${status}`;
}
