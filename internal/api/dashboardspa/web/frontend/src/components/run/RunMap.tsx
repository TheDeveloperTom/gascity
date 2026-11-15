import { useState } from 'react';
import {
  MAX_VISIBLE_ACTIVE_LANES,
  selectBlockedRuns,
  type RunLane,
  type RunSummary,
  type SourceState,
} from 'gas-city-dashboard-shared';
import type { BadgeSeverity } from '../../attention/compose';
import { LaneCard } from './LaneCard';

// Run phase-lane map (gascity-dashboard-0t6). Renders the snapshot's
// runs source: a quiet counts row up top, then the runs that need the
// owner (Blocked, in a red signal band), then active lanes grouped by rig,
// then completed runs on request. Each lane list is one panel with
// hairline-separated rows (Signal & Pavement R9, R10).
//
// gascity-dashboard-yh5i: the active/historical split is rendered as two
// optional sections. Active lanes always show; historical lanes show only
// when `showHistory` is true (controlled by ?history=1 in the URL,
// threaded down from /runs).

interface RunMapProps {
  source: SourceState<RunSummary>;
  now: number;
  showHistory: boolean;
  attentionSeverity?: (lane: RunLane) => BadgeSeverity | null;
}

const COUNT_LABELS: Array<[keyof RunSummary['runCounts'], string]> = [
  ['prReview', 'PR'],
  ['designReview', 'Design'],
  ['bugfix', 'Bugfix'],
  ['other', 'Other'],
];

const HISTORICAL_SECTION_ID = 'runs-historical-section';
const HISTORICAL_LIST_ID = 'runs-historical-list';
const ACTIVE_LIST_ID = 'runs-active-list';
// How many completed runs show before the operator opts into the rest.
// The wire carries up to MAX_HISTORICAL_LANES most-recent historical lanes
// (gascity-dashboard-l9q9, recency-bounded in gascity-dashboard-9w3k); this
// preview keeps the section ambient by default per DESIGN.md.
const HISTORICAL_PREVIEW = 5;

// Panel recipe (DESIGN-PLAN §7) for a lane list, and the quiet text toggle
// used by the "Show N more" expanders.
const LANE_PANEL = 'rounded-lg border border-rule bg-surface-raised divide-y divide-rule';
const EXPANDER =
  'mt-3 inline-flex h-8 items-center rounded px-3 text-label font-semibold text-primary tnum transition-colors duration-150 ease-out-quart hover:bg-primary/10 focus-mark';

export function RunMap({ source, now, showHistory, attentionSeverity }: RunMapProps) {
  if (source.status === 'error') {
    return (
      <section>
        <CountsHeader summary={null} />
        <p className="mt-8 text-body text-fg-muted">{`Run data unavailable: ${source.error}.`}</p>
      </section>
    );
  }

  const summary = source.data;

  return (
    <section>
      <CountsHeader summary={summary} />
      <BlockedSection
        summary={summary}
        now={now}
        {...(attentionSeverity === undefined ? {} : { attentionSeverity })}
      />
      <ActiveSection
        summary={summary}
        now={now}
        {...(attentionSeverity === undefined ? {} : { attentionSeverity })}
      />
      {showHistory && (
        <HistoricalSection
          summary={summary}
          now={now}
          {...(attentionSeverity === undefined ? {} : { attentionSeverity })}
        />
      )}
    </section>
  );
}

function ActiveSection({
  summary,
  now,
  attentionSeverity,
}: {
  summary: RunSummary;
  now: number;
  attentionSeverity?: (lane: RunLane) => BadgeSeverity | null;
}) {
  // gascity-dashboard: `lanes` now carries the FULL active set; the collapsed
  // window (MAX_VISIBLE_ACTIVE_LANES) and its "Show N more runs" expander live
  // here, mirroring HistoricalSection. Collapsed by default keeps the calm
  // density; expansion is opt-in. The hook precedes the empty-state early
  // returns so hook order stays stable across renders.
  const [expanded, setExpanded] = useState(false);

  if (summary.lanes.length === 0) {
    // gascity-dashboard-4xcv: a partial fetch with zero lanes is "we could
    // not see the runs", not "there are no runs". Never present a degraded
    // read as an empty store; say so in words instead.
    if (summary.lanesPartial === true) {
      return (
        <p className="mt-8 text-body text-fg-muted">
          Run sources were partially unavailable; the lane set may be incomplete.
        </p>
      );
    }
    // Distinguish "nothing at all" from "nothing active but N completed".
    const trailer = summary.totalHistorical > 0 ? ` (${summary.totalHistorical} completed.)` : '';
    return <p className="mt-8 text-body text-fg-muted">{`No active formula runs.${trailer}`}</p>;
  }
  const shown = expanded ? summary.lanes : summary.lanes.slice(0, MAX_VISIBLE_ACTIVE_LANES);
  // gascity-dashboard-7hek: organize active lanes by rig (the run-root store).
  // A flat list of same-named molecule runs is indistinguishable; grouping
  // under the rig — a section head, no card, per the Flat Page Rule — gives
  // the operator the store context they navigate by. Within a group, lanes
  // keep their pre-sorted (recency/priority) order.
  const groups = groupLanesByRig(shown);
  return (
    <>
      <div id={ACTIVE_LIST_ID}>
        {groups.map(({ rig, lanes }) => (
          <div key={rig} className="mt-8">
            <h3 className="text-title font-semibold text-fg [overflow-wrap:anywhere]">
              {rigLabel(rig)}
            </h3>
            <LaneList
              lanes={lanes}
              now={now}
              {...(attentionSeverity === undefined ? {} : { attentionSeverity })}
            />
          </div>
        ))}
      </div>
      {summary.lanes.length > MAX_VISIBLE_ACTIVE_LANES && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-controls={ACTIVE_LIST_ID}
          className={EXPANDER}
        >
          {expanded
            ? 'Show fewer'
            : `Show ${summary.lanes.length - MAX_VISIBLE_ACTIVE_LANES} more runs`}
        </button>
      )}
    </>
  );
}

/** The hairline-separated lane list shared by the active rig groups, the
 *  Blocked section, and the Historical section. */
function LaneList({
  lanes,
  now,
  attentionSeverity,
  listId,
}: {
  lanes: readonly RunLane[];
  now: number;
  attentionSeverity?: (lane: RunLane) => BadgeSeverity | null;
  listId?: string;
}) {
  return (
    <ol {...(listId === undefined ? {} : { id: listId })} className={`mt-3 ${LANE_PANEL}`}>
      {lanes.map((lane) => (
        <LaneCard
          key={lane.id}
          lane={lane}
          now={now}
          {...(attentionSeverity === undefined
            ? {}
            : { attentionSeverity: attentionSeverity(lane) })}
        />
      ))}
    </ol>
  );
}

/** Group lanes by their run-root rig, preserving first-seen (pre-sorted)
 *  order so the most-recently-active rig surfaces first.
 *
 *  gascity-dashboard-4xcv: non-rig lanes group under 'city'. A city-scoped
 *  run (control-dispatcher work) is not an "unknown rig" — and a lane whose
 *  scope metadata is unavailable still came from the city's bead store, so
 *  the city group is the honest default. */
function groupLanesByRig(lanes: readonly RunLane[]): Array<{ rig: string; lanes: RunLane[] }> {
  const order: string[] = [];
  const byRig = new Map<string, RunLane[]>();
  for (const lane of lanes) {
    const rig =
      lane.scope.status === 'available' && lane.scope.kind === 'rig'
        ? lane.scope.rootStoreRef
        : 'city';
    let bucket = byRig.get(rig);
    if (bucket === undefined) {
      bucket = [];
      byRig.set(rig, bucket);
      order.push(rig);
    }
    bucket.push(lane);
  }
  return order.map((rig) => ({ rig, lanes: byRig.get(rig) as RunLane[] }));
}

function rigLabel(rig: string): string {
  return rig.replace(/^rig:/, '');
}

/** Blocked runs (gascity-dashboard-4xcv). A blocked lane needs the operator,
 *  so it stays on the page — but in its own labeled section, never mixed
 *  into (or counted with) the Active set. Hidden entirely when nothing is
 *  blocked: the calm room does not announce the absence of trouble. */
function BlockedSection({
  summary,
  now,
  attentionSeverity,
}: {
  summary: RunSummary;
  now: number;
  attentionSeverity?: (lane: RunLane) => BadgeSeverity | null;
}) {
  // gascity-dashboard-2j8e.2: selectBlockedRuns is the SAME selector the nav
  // badge counts, so the header count here and the badge number are one number.
  // Each row carries why-blocked + how-to-unblock (LaneCard `blocked`), so the
  // destination is a path to action, not just a list. Rendered inline rather
  // than through the shared LaneList so that generic list stays blocked-unaware.
  const detailById = new Map(selectBlockedRuns(summary.blockedLanes).map((run) => [run.id, run]));
  if (detailById.size === 0) return null;
  return (
    <section
      aria-label="Blocked runs"
      className="mt-8 overflow-hidden rounded-lg border border-rule bg-surface-raised"
    >
      <div className="border-b border-accent/40 bg-accent/[0.08] px-4 py-3">
        <h2 className="text-title font-semibold text-fg">
          Blocked <span className="tnum text-fg-muted">({detailById.size})</span>
        </h2>
      </div>
      <ol className="divide-y divide-rule">
        {summary.blockedLanes.map((lane) => {
          const detail = detailById.get(lane.id);
          return (
            <LaneCard
              key={lane.id}
              lane={lane}
              now={now}
              {...(attentionSeverity === undefined
                ? {}
                : { attentionSeverity: attentionSeverity(lane) })}
              {...(detail === undefined ? {} : { blocked: detail })}
            />
          );
        })}
      </ol>
    </section>
  );
}

function HistoricalSection({
  summary,
  now,
  attentionSeverity,
}: {
  summary: RunSummary;
  now: number;
  attentionSeverity?: (lane: RunLane) => BadgeSeverity | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const lanes = summary.historicalLanes;
  const shown = expanded ? lanes : lanes.slice(0, HISTORICAL_PREVIEW);

  return (
    <section id={HISTORICAL_SECTION_ID} aria-label="Historical runs" className="mt-12">
      <h2 className="text-title font-semibold text-fg">Completed runs</h2>
      {lanes.length === 0 ? (
        <p className="mt-3 text-body text-fg-muted">No completed runs in the current window.</p>
      ) : (
        <>
          <LaneList
            lanes={shown}
            now={now}
            listId={HISTORICAL_LIST_ID}
            {...(attentionSeverity === undefined ? {} : { attentionSeverity })}
          />
          {lanes.length > HISTORICAL_PREVIEW && (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              aria-expanded={expanded}
              aria-controls={HISTORICAL_LIST_ID}
              className={EXPANDER}
            >
              {expanded ? 'Show fewer' : `Show ${lanes.length - HISTORICAL_PREVIEW} more`}
            </button>
          )}
          {/* gascity-dashboard-9w3k: the wire caps historicalLanes at
              MAX_HISTORICAL_LANES while totalHistorical keeps the true count.
              Disclose the cap so the operator knows the rendered set is the
              recent window, not the whole history — mirroring the Active
              section's "N more not shown" note (same typographic register). */}
          {summary.totalHistorical > lanes.length && (
            <p className="mt-3 text-label text-fg-muted tnum">
              Showing {lanes.length} most-recent of {summary.totalHistorical}
            </p>
          )}
        </>
      )}
    </section>
  );
}

function CountsHeader({ summary }: { summary: RunSummary | null }) {
  // yh5i: tile labeled "Active" (was "Runs") so the denominator is
  // self-describing — runCounts.total counts only active lanes after the
  // split. Sub-tiles (PR / Design / Bugfix / Other) break down the active
  // set by formula kind, matching the headline metric. Historical counts
  // surface via the toggle button in the page header, not here.
  const total = summary?.runCounts.total ?? 0;
  const blocked = summary?.runCounts.blocked ?? 0;
  return (
    <header>
      <dl className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <CountTile label="Active" value={total} tone="strong" />
        {COUNT_LABELS.map(([key, label]) => (
          <CountTile key={key} label={label} value={summary?.runCounts[key] ?? 0} tone="muted" />
        ))}
        {blocked > 0 && <CountTile label="Blocked" value={blocked} tone="muted" />}
      </dl>
    </header>
  );
}

function CountTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'strong' | 'muted';
}) {
  // One reading per pair: the word, then its number. No box around either.
  const valueTone = tone === 'strong' ? 'font-semibold text-fg' : 'font-medium text-fg-muted';
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-label text-fg-muted">{label}</dt>
      <dd className={`text-title tnum ${valueTone}`}>{value}</dd>
    </div>
  );
}

export const RUNS_HISTORICAL_SECTION_ID = HISTORICAL_SECTION_ID;
