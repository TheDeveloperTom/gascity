import type { SupervisorBead } from '../supervisor/beadReads';
import type { BeadNode } from './beadGraph';

// The Beads board as route stages (owner ruling 2026-11-15): every product task
// travels one route from created to merged, and the board shows where it is.
// Columns are Waiting → Working → Review → PR → Merged.
//
// Data-driven: a formula step declares its stage in its own metadata
// (`dashboard.stage`), which the engine stamps verbatim onto the step bead. The
// dashboard groups by that label and never hardcodes step ids. A route step or
// route root is never a board card; it folds into the task it works on.
//
// Engine facts this module relies on (gascity 792305a91):
// - a workflow root carries gc.kind=workflow; its members carry gc.root_bead_id;
// - the root names its task in one of ROOT_TASK_KEYS (a `tracks` edge from the
//   root points at its own finalize step, not at the task);
// - a queued drain root is open with is_blocked=true until earlier runs finish.

export type StageId = 'waiting' | 'working' | 'review' | 'pr' | 'merged';

export interface StageColumn {
  id: StageId;
  label: string;
}

/** Column order, left to right. */
export const STAGES: readonly StageColumn[] = [
  { id: 'waiting', label: 'Waiting' },
  { id: 'working', label: 'Working' },
  { id: 'review', label: 'Review' },
  { id: 'pr', label: 'PR' },
  { id: 'merged', label: 'Merged' },
];

/** Step metadata key a formula sets to place its step in a column. */
export const STAGE_METADATA_KEY = 'dashboard.stage';

const STAGE_RANK: Readonly<Record<StageId, number>> = {
  waiting: 0,
  working: 1,
  review: 2,
  pr: 3,
  merged: 4,
};

/** Labels a step may declare. `waiting` is implicit (a run that has not started). */
const STEP_STAGES: ReadonlySet<string> = new Set(['working', 'review', 'pr', 'merged']);

const KIND_KEY = 'gc.kind';
const ROOT_ID_KEY = 'gc.root_bead_id';
const WORKFLOW_KIND = 'workflow';
/** Compile-time records that stay open without being work in progress. */
const IGNORED_MEMBER_KINDS: ReadonlySet<string> = new Set(['spec']);

/** Root → task link, first non-empty wins: engine sling/dispatch, the city's
 *  prepare-worktree anchor, the engine drain member, the sling `issue` var. */
const ROOT_TASK_KEYS = [
  'gc.source_bead_id',
  'gc.source_anchor_id',
  'gc.drain_member_id',
  'gc.var.issue',
] as const;

// City (devwork) keys, read only to decorate a card. Keeping them in one place
// makes the city coupling visible; the stage itself never depends on them.
const STOPPED_CARD_KEY = 'devwork.stopped_card';
const STOP_REASON_KEY = 'rejection_reason';
const TDD_REFUSAL_KEY = 'devwork.tdd_refusal';
const PR_NUMBER_KEY = 'devwork.pr_number';
const PR_URL_KEY = 'devwork.pr_url';

export type StageMarkKind =
  | 'blocked'
  | 'ready'
  | 'stopped'
  | 'route-failed'
  | 'route-stopped'
  | 'tdd-refused';

export interface StageMark {
  kind: StageMarkKind;
  /** attention = needs the owner; warn = held; quiet = informational. */
  tone: 'attention' | 'warn' | 'quiet';
  label: string;
  title?: string;
}

export interface TaskStage {
  stage: StageId;
  /** The route the card follows, when one is visible. */
  root: SupervisorBead | null;
  /** The step the route is at (or, for a merged task, its last visible step). */
  step: SupervisorBead | null;
  /** Text for the step line: the step title, `Queued`, or a close reason. */
  stepLabel: string | null;
  pr: { number: string | null; url: string | null } | null;
  marks: StageMark[];
}

export interface StageCard {
  node: BeadNode;
  stage: TaskStage;
}

interface Route {
  root: SupervisorBead;
  members: SupervisorBead[];
}

export interface RouteIndex {
  /**
   * True when the fetched route beads cover every live run (the open window
   * was not truncated). Only then may an absent run be read as a stopped one.
   */
  routesComplete: boolean;
  routesFor(taskId: string): readonly Route[];
  /** Live roots whose task is not among `taskIds` (they never get a card). */
  orphanRoots(taskIds: ReadonlySet<string>): SupervisorBead[];
}

function meta(bead: SupervisorBead, key: string): string {
  return bead.metadata?.[key]?.trim() ?? '';
}

export function isRouteRoot(bead: SupervisorBead): boolean {
  return meta(bead, KIND_KEY) === WORKFLOW_KIND;
}

export function isRouteBead(bead: SupervisorBead): boolean {
  return isRouteRoot(bead) || meta(bead, ROOT_ID_KEY).length > 0;
}

export function routeTaskId(root: SupervisorBead): string | null {
  for (const key of ROOT_TASK_KEYS) {
    const value = meta(root, key);
    if (value.length > 0) return value;
  }
  return null;
}

export function buildRouteIndex(
  routeBeads: readonly SupervisorBead[],
  options: { routesComplete?: boolean } = {},
): RouteIndex {
  const membersByRoot = new Map<string, SupervisorBead[]>();
  const roots: SupervisorBead[] = [];
  for (const bead of routeBeads) {
    if (isRouteRoot(bead)) {
      roots.push(bead);
      continue;
    }
    const rootId = meta(bead, ROOT_ID_KEY);
    if (rootId.length === 0) continue;
    const list = membersByRoot.get(rootId);
    if (list) list.push(bead);
    else membersByRoot.set(rootId, [bead]);
  }
  const byTask = new Map<string, Route[]>();
  for (const root of roots) {
    const taskId = routeTaskId(root);
    if (taskId === null) continue;
    const route: Route = { root, members: membersByRoot.get(root.id) ?? [] };
    const list = byTask.get(taskId);
    if (list) list.push(route);
    else byTask.set(taskId, [route]);
  }
  for (const list of byTask.values()) list.sort(byRoutePreference);
  return {
    routesComplete: options.routesComplete ?? true,
    routesFor: (taskId) => byTask.get(taskId) ?? [],
    orphanRoots: (taskIds) =>
      roots.filter((root) => {
        if (root.status === 'closed') return false;
        const taskId = routeTaskId(root);
        return taskId === null || !taskIds.has(taskId);
      }),
  };
}

/** Live before closed, running before queued, newest first. */
function byRoutePreference(a: Route, b: Route): number {
  const rank = (r: Route) =>
    r.root.status === 'closed' ? 2 : r.root.status === 'in_progress' ? 0 : 1;
  const diff = rank(a) - rank(b);
  if (diff !== 0) return diff;
  return a.root.created_at < b.root.created_at ? 1 : a.root.created_at > b.root.created_at ? -1 : 0;
}

/** Open stop cards keyed by the task they stop. */
export function stopCardsByTask(beads: Iterable<SupervisorBead>): Map<string, SupervisorBead> {
  const out = new Map<string, SupervisorBead>();
  for (const bead of beads) {
    if (bead.status === 'closed') continue;
    const target = meta(bead, STOPPED_CARD_KEY);
    if (target.length > 0 && !out.has(target)) out.set(target, bead);
  }
  return out;
}

function stepStage(bead: SupervisorBead): StageId | null {
  const label = meta(bead, STAGE_METADATA_KEY);
  return STEP_STAGES.has(label) ? (label as StageId) : null;
}

function isCountedMember(bead: SupervisorBead): boolean {
  return !IGNORED_MEMBER_KINDS.has(meta(bead, KIND_KEY)) && bead.issue_type !== 'spec';
}

function pick(
  members: readonly SupervisorBead[],
  direction: 'lowest' | 'highest',
): { bead: SupervisorBead; stage: StageId } | null {
  let best: { bead: SupervisorBead; stage: StageId } | null = null;
  for (const bead of members) {
    const stage = stepStage(bead);
    if (stage === null) continue;
    if (
      best === null ||
      (direction === 'lowest'
        ? STAGE_RANK[stage] < STAGE_RANK[best.stage]
        : STAGE_RANK[stage] > STAGE_RANK[best.stage])
    ) {
      best = { bead, stage };
    }
  }
  return best;
}

function routePosition(route: Route): {
  stage: StageId;
  step: SupervisorBead | null;
  label: string | null;
} {
  const open = route.members.filter((m) => m.status !== 'closed' && isCountedMember(m));
  const running = open.filter((m) => m.status === 'in_progress');
  const runningLabelled = pick(running, 'highest');
  if (runningLabelled)
    return { stage: runningLabelled.stage, step: runningLabelled.bead, label: null };

  const { root } = route;
  if (running.length === 0 && root.status === 'open' && root.is_blocked === true) {
    return { stage: 'waiting', step: null, label: 'Queued' };
  }

  const ready = open.filter((m) => m.is_blocked !== true);
  const frontier = pick(ready, 'lowest') ?? pick(open, 'lowest');
  const step = running[0] ?? frontier?.bead ?? ready[0] ?? open[0] ?? null;
  return { stage: frontier?.stage ?? 'working', step, label: null };
}

function lastClosedMember(route: Route): SupervisorBead | null {
  let last: SupervisorBead | null = null;
  for (const m of route.members) {
    if (m.status !== 'closed' || !isCountedMember(m)) continue;
    if (last === null || (m.updated_at ?? m.created_at) > (last.updated_at ?? last.created_at))
      last = m;
  }
  return last;
}

/**
 * An external link from bead metadata, or null. Agents write card metadata, so
 * the value is untrusted: only an absolute http(s) URL may become an href
 * (`javascript:`, `data:`, protocol-relative and unparsable values may not).
 */
export function safeExternalUrl(raw: string): string | null {
  if (raw.length === 0) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
}

function prOf(task: SupervisorBead, route: Route | null): TaskStage['pr'] {
  for (const bead of [task, ...(route?.members ?? [])]) {
    const number = meta(bead, PR_NUMBER_KEY);
    const url = safeExternalUrl(meta(bead, PR_URL_KEY));
    if (number.length > 0 || url !== null) {
      return { number: number.length > 0 ? number : null, url };
    }
  }
  return null;
}

export function deriveTaskStage(
  node: BeadNode,
  index: RouteIndex,
  stopCards: ReadonlyMap<string, SupervisorBead>,
): TaskStage {
  const task = node.bead;
  const route = index.routesFor(task.id)[0] ?? null;
  const marks: StageMark[] = [];

  let stage: StageId;
  let step: SupervisorBead | null = null;
  let stepLabel: string | null = null;

  if (task.status === 'closed') {
    stage = 'merged';
    step = route ? lastClosedMember(route) : null;
    if (step === null && task.close_reason) stepLabel = task.close_reason;
  } else if (route === null || route.root.status === 'closed') {
    stage = task.status === 'in_progress' ? 'working' : 'waiting';
    if (route !== null && meta(route.root, 'gc.outcome') === 'fail') {
      marks.push({
        kind: 'route-failed',
        tone: 'attention',
        label: 'route failed',
        title: `Run ${route.root.id} ended failed; the task is still open.`,
      });
    } else if (task.status === 'in_progress' && (route !== null || index.routesComplete)) {
      // Our route marks the task in progress (mark-in-progress) and closes it
      // at the end; a scope abort closes the root and every step. So an
      // in-progress task that no live run names had its run stop under it.
      // The API cannot look a task's closed root up, so this is inferred from
      // the open window, and only when that window was complete (review I6).
      marks.push({
        kind: 'route-stopped',
        tone: 'attention',
        label: 'route stopped',
        title:
          route !== null
            ? `Run ${route.root.id} ended; the task is still in progress.`
            : 'In progress, but no run is working on it: its run ended without closing the task.',
      });
    }
  } else {
    const position = routePosition(route);
    // Merged means the task is closed (ruling I4): a step labelled `merged`
    // still waits for the close, so an open task stops at PR.
    stage = position.stage === 'merged' ? 'pr' : position.stage;
    step = position.step;
    stepLabel = position.label;
  }

  // Columns move forward only (ruling I5): once the task has a PR, the card
  // stays in PR while repair, accept or review-again runs work on it; the step
  // line says what is happening (for example the review of the fix).
  const pr = prOf(task, route);
  if (task.status !== 'closed' && pr !== null && STAGE_RANK[stage] < STAGE_RANK.pr) stage = 'pr';

  if (task.status === 'blocked') marks.push({ kind: 'blocked', tone: 'warn', label: 'blocked' });
  // `ready` (every need closed) only helps a task no run has picked up yet; a
  // queued run already says where the task stands, and a visible ended run
  // means the task was picked up (review I6).
  if (stage === 'waiting' && node.ready && route === null)
    marks.push({ kind: 'ready', tone: 'quiet', label: 'ready' });

  const stopCard = stopCards.get(task.id);
  const cancelled =
    route !== null &&
    route.root.status !== 'closed' &&
    meta(route.root, 'gc.cancel_requested') === 'true';
  if (task.status !== 'closed' && (stopCard || cancelled)) {
    const reason = stopCard
      ? meta(stopCard, STOP_REASON_KEY) || stopCard.title
      : 'cancel requested';
    marks.push({
      kind: 'stopped',
      tone: 'attention',
      label: 'stopped',
      title: stopCard ? `${stopCard.id}: ${reason}` : `Run ${route?.root.id}: ${reason}`,
    });
  }

  const refusal = meta(task, TDD_REFUSAL_KEY);
  if (task.status !== 'closed' && refusal.length > 0) {
    marks.push({ kind: 'tdd-refused', tone: 'attention', label: 'TDD refused', title: refusal });
  }

  if (stepLabel === null && step !== null) stepLabel = step.title;

  return { stage, root: route?.root ?? null, step, stepLabel, pr, marks };
}

function emptyStageColumns(): Record<StageId, StageCard[]> {
  return { waiting: [], working: [], review: [], pr: [], merged: [] };
}

function byPriorityThenId(a: StageCard, b: StageCard): number {
  const pa = a.node.bead.priority ?? Number.POSITIVE_INFINITY;
  const pb = b.node.bead.priority ?? Number.POSITIVE_INFINITY;
  if (pa !== pb) return pa - pb;
  return a.node.bead.id < b.node.bead.id ? -1 : a.node.bead.id > b.node.bead.id ? 1 : 0;
}

function byRecentClose(a: StageCard, b: StageCard): number {
  const ta = a.node.bead.updated_at ?? a.node.bead.created_at;
  const tb = b.node.bead.updated_at ?? b.node.bead.created_at;
  if (ta !== tb) return ta < tb ? 1 : -1;
  return byPriorityThenId(a, b);
}

export function buildStageColumns(
  nodes: Iterable<BeadNode>,
  index: RouteIndex,
  stopCards: ReadonlyMap<string, SupervisorBead>,
): Record<StageId, StageCard[]> {
  const columns = emptyStageColumns();
  for (const node of nodes) {
    if (isRouteBead(node.bead)) continue;
    const stage = deriveTaskStage(node, index, stopCards);
    columns[stage.stage].push({ node, stage });
  }
  for (const col of STAGES)
    columns[col.id].sort(col.id === 'merged' ? byRecentClose : byPriorityThenId);
  return columns;
}

/** Run-detail href for a route, opened on its current step when known. */
export function routeRunHref(root: SupervisorBead, step: SupervisorBead | null): string {
  const search = new URLSearchParams();
  let kind = meta(root, 'gc.scope_kind');
  let ref = meta(root, 'gc.scope_ref');
  if (kind.length === 0 || ref.length === 0) {
    const [k = '', r = ''] = meta(root, 'gc.root_store_ref').split(':', 2);
    kind = k;
    ref = r;
  }
  if ((kind === 'city' || kind === 'rig') && ref.length > 0) {
    search.set('scope_kind', kind);
    search.set('scope_ref', ref);
  }
  if (step !== null) search.set('node', step.id);
  const qs = search.toString();
  return `/runs/${encodeURIComponent(root.id)}${qs.length > 0 ? `?${qs}` : ''}`;
}
