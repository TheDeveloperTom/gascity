import { tn } from '../i18n';
import type { SupervisorBead } from '../supervisor/beadReads';
import { isRouteBead, isRouteRoot, routeRunHref, type TaskStage } from './stageBoard';

// Why work waits (OWNER-HOME-PLAN B3, RB6, RB7). Every reason is derived from
// the beads the board already reads: drains, cross-store gates and open `gate`
// blockers. Nothing here is a fixed sentence about a particular run.
//
// Engine keys: internal/beadmeta/keys.go:156-166, 199-200. Label:
// internal/dispatch/cross_store_gate.go:136. A gate is open while its status is
// not `closed`.

/** The city's stage label (`assets/scripts/archyl-drift-stage.sh:55-60`). */
export const MILESTONE_LABEL_PREFIX = 'milestone:';

const KIND_KEY = 'gc.kind';
const DRAIN_KIND = 'drain';
const ROOT_ID_KEY = 'gc.root_bead_id';
const DRAIN_COUNT_KEY = 'gc.drain_count';
const DRAIN_CONTROL_KEY = 'gc.drain_control_id';
const DRAIN_MEMBER_KEY = 'gc.drain_member_id';
const CROSS_STORE_GATE_LABEL = 'gc:cross-store-gate';
const GATE_OWNER_KEY = 'gc.cross_store_gate_owner';
const GATE_BLOCKER_KEY = 'gc.cross_store_blocker';

export const MAX_CAUSES = 3;

/**
 * `since` is when the wait began, as far as the beads tell (the blocker's,
 * gate's or drain's last update): «Застряло» lists a cause only once it is
 * older than an hour (dashboard v3, V1 b).
 */
export type WaitCause =
  | {
      kind: 'card';
      tasks: number;
      milestone: string | null;
      blocker: { id: string; title: string | null };
      runHref: string | null;
      since?: string;
    }
  | { kind: 'decision'; tasks: number; gate: { id: string; title: string }; since?: string }
  | {
      kind: 'queue';
      tasks: number;
      milestone: string | null;
      runHref: string | null;
      since?: string;
    }
  | { kind: 'no-runs'; ready: number };

export interface WaitInput {
  tasks: readonly SupervisorBead[];
  routeItems: readonly SupervisorBead[];
  serviceItems: readonly SupervisorBead[];
  routesComplete: boolean;
}

export type IdleExplanation =
  | { state: 'busy' }
  | { state: 'idle'; causes: readonly WaitCause[] }
  | { state: 'unknown' };

export type CardWait =
  | { kind: 'ready' }
  | { kind: 'queued' }
  | { kind: 'tasks'; count: number }
  | { kind: 'decision'; gate: { id: string; title: string } }
  | { kind: 'held' };

function meta(bead: SupervisorBead, key: string): string {
  return bead.metadata?.[key]?.trim() ?? '';
}

function isOpen(bead: SupervisorBead): boolean {
  return bead.status !== 'closed';
}

export function milestoneOf(bead: SupervisorBead): string | null {
  for (const label of bead.labels ?? []) {
    if (label.startsWith(MILESTONE_LABEL_PREFIX)) {
      const value = label.slice(MILESTONE_LABEL_PREFIX.length).trim();
      if (value.length > 0) return value;
    }
  }
  return null;
}

function sinceOf(bead: SupervisorBead | undefined): { since?: string } {
  if (bead === undefined) return {};
  const at = bead.updated_at ?? bead.created_at;
  return at.length > 0 ? { since: at } : {};
}

/** Ids a bead waits on: `needs` and `blocks` dependencies (never parent-child). */
export function blockerIds(bead: SupervisorBead): string[] {
  const ids = new Set<string>(bead.needs ?? []);
  for (const dep of bead.dependencies ?? []) {
    if (dep.type === 'blocks' && dep.depends_on_id.length > 0) ids.add(dep.depends_on_id);
  }
  ids.delete(bead.id);
  return [...ids];
}

function countFrom(raw: string): number {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

const KIND_RANK: Readonly<Record<WaitCause['kind'], number>> = {
  card: 0,
  decision: 1,
  queue: 2,
  'no-runs': 3,
};

function causeSize(cause: WaitCause): number {
  return cause.kind === 'no-runs' ? cause.ready : cause.tasks;
}

function isDecisionGate(bead: SupervisorBead): boolean {
  return bead.issue_type === 'gate' && isOpen(bead) && !isRouteBead(bead);
}

export function queueCauses(input: WaitInput): readonly WaitCause[] {
  const all = [...input.tasks, ...input.routeItems, ...input.serviceItems];
  const byId = new Map(all.map((bead) => [bead.id, bead]));
  const causes: WaitCause[] = [];

  const drains = input.routeItems.filter((b) => meta(b, KIND_KEY) === DRAIN_KIND && isOpen(b));
  const gates = [...input.routeItems, ...input.serviceItems].filter(
    (b) => (b.labels ?? []).includes(CROSS_STORE_GATE_LABEL) && isOpen(b),
  );
  for (const drain of drains) {
    const root = byId.get(meta(drain, ROOT_ID_KEY));
    const runHref =
      root !== undefined && input.routeItems.includes(root) ? routeRunHref(root, null) : null;
    const itemRoots = input.routeItems.filter(
      (b) => isRouteRoot(b) && meta(b, DRAIN_CONTROL_KEY) === drain.id,
    );
    const members = itemRoots
      .map((r) => byId.get(meta(r, DRAIN_MEMBER_KEY)))
      .filter((b): b is SupervisorBead => b !== undefined);
    const stages = new Set(members.map(milestoneOf));
    const only = stages.size === 1 ? [...stages][0] : null;
    const milestone = only ?? null;
    const drainCount = countFrom(meta(drain, DRAIN_COUNT_KEY));

    const owned = gates.filter((g) => meta(g, GATE_OWNER_KEY) === drain.id);
    for (const gate of owned) {
      const heldRoots = new Set<string>();
      for (const bead of input.routeItems) {
        const waits = (bead.dependencies ?? []).some(
          (d) => d.type === 'blocks' && d.depends_on_id === gate.id,
        );
        const rootId = meta(bead, ROOT_ID_KEY);
        if (waits && rootId.length > 0) heldRoots.add(rootId);
      }
      const blockerId = meta(gate, GATE_BLOCKER_KEY);
      const blocker = byId.get(blockerId);
      causes.push({
        kind: 'card',
        tasks: heldRoots.size > 0 ? heldRoots.size : drainCount,
        milestone,
        blocker: { id: blockerId, title: blocker?.title ?? null },
        runHref,
        ...sinceOf(blocker ?? gate),
      });
    }
    const running = itemRoots.some((r) => r.status === 'in_progress');
    if (owned.length === 0 && !running) {
      const waiting = itemRoots.filter(isOpen).length;
      causes.push({
        kind: 'queue',
        tasks: waiting > 0 ? waiting : drainCount,
        milestone,
        runHref,
        ...sinceOf(drain),
      });
    }
  }

  for (const gate of input.serviceItems.filter(isDecisionGate)) {
    const waiting = input.tasks.filter((t) => isOpen(t) && blockerIds(t).includes(gate.id));
    if (waiting.length === 0) continue;
    causes.push({
      kind: 'decision',
      tasks: waiting.length,
      gate: { id: gate.id, title: gate.title },
      ...sinceOf(gate),
    });
  }

  causes.sort((a, b) => causeSize(b) - causeSize(a) || KIND_RANK[a.kind] - KIND_RANK[b.kind]);
  return causes.slice(0, MAX_CAUSES);
}

export function explainIdle(input: WaitInput, activeTasks: number): IdleExplanation {
  if (activeTasks > 0) return { state: 'busy' };
  if (!input.routesComplete) return { state: 'unknown' };
  const causes = queueCauses(input);
  if (causes.length > 0) return { state: 'idle', causes };
  const liveRoots = input.routeItems.filter((b) => isRouteRoot(b) && isOpen(b));
  if (liveRoots.length > 0) return { state: 'idle', causes: [] };
  const ready = input.tasks.filter(
    (t) => isOpen(t) && t.issue_type !== 'epic' && t.is_blocked !== true,
  ).length;
  return { state: 'idle', causes: [{ kind: 'no-runs', ready }] };
}

export function cardWait(
  task: SupervisorBead,
  stage: TaskStage,
  byId: ReadonlyMap<string, SupervisorBead>,
): CardWait | null {
  if (stage.stage !== 'waiting') return null;
  if (stage.stepLabel === 'Queued' && stage.root !== null) return { kind: 'queued' };
  if (task.is_blocked !== true && task.status !== 'blocked') return { kind: 'ready' };
  const ids = blockerIds(task);
  const decisions = ids
    .map((id) => byId.get(id))
    .filter((b): b is SupervisorBead => b !== undefined && isDecisionGate(b))
    .sort((a, b) => a.title.localeCompare(b.title));
  const first = decisions[0];
  if (first !== undefined) return { kind: 'decision', gate: { id: first.id, title: first.title } };
  const open = ids.filter((id) => {
    const blocker = byId.get(id);
    return blocker === undefined || isOpen(blocker);
  }).length;
  return open >= 1 ? { kind: 'tasks', count: open } : { kind: 'held' };
}

export function holdsCount(taskId: string, tasks: readonly SupervisorBead[]): number {
  return tasks.filter((t) => isOpen(t) && t.id !== taskId && blockerIds(t).includes(taskId)).length;
}

/** Reverse blocker index, built once: blocker id → the open tasks that wait on it. */
export function buildWaitersIndex(
  tasks: readonly SupervisorBead[],
): ReadonlyMap<string, readonly string[]> {
  const index = new Map<string, string[]>();
  for (const task of tasks) {
    if (!isOpen(task)) continue;
    for (const id of blockerIds(task)) {
      const list = index.get(id);
      if (list) list.push(task.id);
      else index.set(id, [task.id]);
    }
  }
  return index;
}

export function waitCauseText(cause: WaitCause): string {
  switch (cause.kind) {
    case 'card':
      return cause.milestone !== null
        ? tn(
            cause.tasks,
            {
              one: '{n} task of stage {milestone} waits for card {id}',
              other: '{n} tasks of stage {milestone} wait for card {id}',
            },
            { milestone: cause.milestone, id: cause.blocker.id },
          )
        : tn(
            cause.tasks,
            {
              one: '{n} task of the run waits for card {id}',
              other: '{n} tasks of the run wait for card {id}',
            },
            { id: cause.blocker.id },
          );
    case 'decision':
      return tn(
        cause.tasks,
        {
          one: '{n} task waits for a decision: «{title}»',
          other: '{n} tasks wait for a decision: «{title}»',
        },
        { title: cause.gate.title },
      );
    case 'queue':
      return cause.milestone !== null
        ? tn(
            cause.tasks,
            {
              one: '{n} task of stage {milestone} is queued and not started',
              other: '{n} tasks of stage {milestone} are queued; none has started',
            },
            { milestone: cause.milestone },
          )
        : tn(cause.tasks, {
            one: '{n} task of the run is queued and not started',
            other: '{n} tasks of the run are queued; none has started',
          });
    case 'no-runs':
      return tn(cause.ready, {
        one: 'No runs are going. {n} task is ready to take.',
        other: 'No runs are going. {n} tasks are ready to take.',
      });
  }
}
