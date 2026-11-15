import { describe, expect, it } from 'vitest';
import type { SupervisorBead } from '../supervisor/beadReads';
import { buildBeadGraph } from './beadGraph';
import {
  STAGES,
  buildRouteIndex,
  buildStageColumns,
  deriveTaskStage,
  isRouteBead,
  routeRunHref,
  routeTaskId,
  stopCardsByTask,
  type StageId,
} from './stageBoard';

// Fixtures follow the city formula formulas/devwork-development.toml (step ids
// and order) and the engine's metadata keys: a workflow root (gc.kind=workflow)
// linked to its task by gc.drain_member_id / gc.var.issue, and step beads that
// carry gc.root_bead_id, gc.step_ref and the formula step's `dashboard.stage`.

const TASK = 'dw-aa1';
const ROOT = 'gcg-100';

function bead(id: string, extra: Partial<SupervisorBead> = {}): SupervisorBead {
  return {
    id,
    title: `bead ${id}`,
    status: 'open',
    issue_type: 'task',
    created_at: '2026-11-15T08:00:00Z',
    ...extra,
  };
}

function task(extra: Partial<SupervisorBead> = {}): SupervisorBead {
  return bead(TASK, { title: 'Ship the stage board', ...extra });
}

function root(
  extra: Partial<SupervisorBead> = {},
  meta: Record<string, string> = {},
): SupervisorBead {
  return bead(ROOT, {
    title: 'devwork-development',
    status: 'open',
    is_blocked: false,
    ...extra,
    metadata: {
      'gc.kind': 'workflow',
      'gc.formula_name': 'devwork-development',
      'gc.drain_member_id': TASK,
      'gc.var.issue': TASK,
      'gc.root_store_ref': 'rig:devwork',
      ...meta,
    },
  });
}

// The devwork-development steps in formula order, with the stage the city
// labels each one with (STAGE-BOARD-PLAN.md, city labels table).
const DEVWORK_STEPS: ReadonlyArray<[string, StageId]> = [
  ['prepare-worktree', 'working'],
  ['mark-in-progress', 'working'],
  ['implement', 'working'],
  ['verify-test-fails', 'working'],
  ['verify-test-passes', 'working'],
  ['task-review', 'review'],
  ['record-item-result', 'review'],
  ['open-pr', 'pr'],
  ['await-merge', 'pr'],
  ['verify-merged', 'pr'],
  ['close-source-anchor', 'merged'],
];

let seq = 0;
function step(
  stepId: string,
  stage: StageId | null,
  extra: Partial<SupervisorBead> = {},
  meta: Record<string, string> = {},
): SupervisorBead {
  seq += 1;
  return bead(`gcg-${200 + seq}`, {
    title: `Step ${stepId}`,
    is_blocked: true,
    ...extra,
    metadata: {
      'gc.root_bead_id': ROOT,
      'gc.step_id': `devwork-development.${stepId}`,
      'gc.step_ref': `devwork-development.${stepId}`,
      ...(stage === null ? {} : { 'dashboard.stage': stage }),
      ...meta,
    },
  });
}

/** Every step of the route from `fromIndex` on (earlier ones are closed and
 *  therefore absent from the open window), the first one in `firstStatus`. */
function routeFrom(fromIndex: number, firstStatus: 'open' | 'in_progress' = 'in_progress') {
  return DEVWORK_STEPS.slice(fromIndex).map(([id, stage], i) =>
    step(id, stage, i === 0 ? { status: firstStatus, is_blocked: false } : {}),
  );
}

function stageOf(t: SupervisorBead, routeBeads: SupervisorBead[], others: SupervisorBead[] = []) {
  const graph = buildBeadGraph([t, ...others]);
  const node = graph.nodes.get(t.id);
  if (!node) throw new Error('missing node');
  return deriveTaskStage(node, buildRouteIndex(routeBeads), stopCardsByTask([t, ...others]));
}

describe('stage columns', () => {
  it('orders the five owner-approved columns with English labels', () => {
    expect(STAGES.map((s) => s.label)).toEqual(['Waiting', 'Working', 'Review', 'PR', 'Merged']);
  });
});

describe('route recognition', () => {
  it('recognises workflow roots and their members as route beads', () => {
    expect(isRouteBead(root())).toBe(true);
    expect(isRouteBead(step('implement', 'working'))).toBe(true);
    expect(isRouteBead(task())).toBe(false);
  });

  it('links a root to its task through the engine keys, source bead first', () => {
    expect(routeTaskId(root())).toBe(TASK);
    expect(routeTaskId(root({}, { 'gc.source_bead_id': 'dw-src' }))).toBe('dw-src');
    expect(
      routeTaskId(
        bead('gcg-1', { metadata: { 'gc.kind': 'workflow', 'gc.source_anchor_id': 'dw-anchor' } }),
      ),
    ).toBe('dw-anchor');
    expect(
      routeTaskId(bead('gcg-2', { metadata: { 'gc.kind': 'workflow', 'gc.var.issue': 'dw-v' } })),
    ).toBe('dw-v');
    // A `tracks` edge points at the root's own finalize step, never the task.
    expect(
      routeTaskId(
        bead('gcg-3', {
          metadata: { 'gc.kind': 'workflow' },
          dependencies: [{ issue_id: 'gcg-3', depends_on_id: 'dw-x', type: 'tracks' }],
        }),
      ),
    ).toBeNull();
  });
});

describe('every devwork-development step maps to its stage', () => {
  DEVWORK_STEPS.forEach(([stepId, expected], index) => {
    it(`${stepId} in progress → ${expected}`, () => {
      const result = stageOf(task({ status: 'in_progress' }), [root(), ...routeFrom(index)]);
      expect(result.stage).toBe(expected);
      expect(result.step?.metadata?.['gc.step_id']).toBe(`devwork-development.${stepId}`);
    });

    it(`${stepId} ready (not yet claimed) → ${expected}`, () => {
      const result = stageOf(task({ status: 'in_progress' }), [
        root(),
        ...routeFrom(index, 'open'),
      ]);
      expect(result.stage).toBe(expected);
    });
  });
});

describe('fallbacks', () => {
  it('an open task with no route waits', () => {
    expect(stageOf(task(), []).stage).toBe('waiting');
  });

  it('a blocked task with no route waits with a blocked mark', () => {
    const result = stageOf(task({ status: 'blocked' }), []);
    expect(result.stage).toBe('waiting');
    expect(result.marks.map((m) => m.kind)).toContain('blocked');
  });

  it('a closed task is merged with or without a route', () => {
    expect(stageOf(task({ status: 'closed' }), []).stage).toBe('merged');
    expect(stageOf(task({ status: 'closed' }), [root(), ...routeFrom(2)]).stage).toBe('merged');
  });

  it('an in-progress task with no route is being worked', () => {
    expect(stageOf(task({ status: 'in_progress' }), []).stage).toBe('working');
  });

  it('a queued route (root open and blocked by earlier runs) waits', () => {
    const result = stageOf(task(), [
      root({ is_blocked: true }),
      ...routeFrom(0, 'open').map(blocked),
    ]);
    expect(result.stage).toBe('waiting');
    expect(result.stepLabel).toBe('Queued');
    expect(result.root?.id).toBe(ROOT);
  });

  it('an unlabelled running route (compiled before the labels) is Working', () => {
    const steps = DEVWORK_STEPS.slice(3).map(([id], i) =>
      step(id, null, i === 0 ? { status: 'in_progress', is_blocked: false } : {}),
    );
    const result = stageOf(task({ status: 'in_progress' }), [
      root({ status: 'in_progress' }),
      ...steps,
    ]);
    expect(result.stage).toBe('working');
    expect(result.step?.id).toBe(steps[0]?.id);
  });

  it('an open unlabelled member between labelled ones never moves the card', () => {
    // write-failing-test comes from the pack and carries no label.
    const result = stageOf(task({ status: 'in_progress' }), [
      root(),
      step('write-failing-test', null, { status: 'in_progress', is_blocked: false }),
      ...routeFrom(3, 'open').map(blocked),
    ]);
    expect(result.stage).toBe('working');
  });

  it('spec members are ignored even when labelled and ready', () => {
    const spec = step(
      'implement.spec',
      'working',
      { issue_type: 'spec', is_blocked: false },
      { 'gc.kind': 'spec' },
    );
    const result = stageOf(task({ status: 'in_progress' }), [
      root(),
      spec,
      ...routeFrom(7, 'open'),
    ]);
    expect(result.stage).toBe('pr');
  });

  it('the most advanced in-progress member wins', () => {
    const result = stageOf(task({ status: 'in_progress' }), [
      root(),
      step('verify-test-passes', 'working', { status: 'in_progress', is_blocked: false }),
      step('open-pr', 'pr', { status: 'in_progress', is_blocked: false }),
    ]);
    expect(result.stage).toBe('pr');
  });

  it('a live route beats an older closed route for the same task', () => {
    const old = root(
      { status: 'closed', created_at: '2026-11-14T08:00:00Z' },
      { 'gc.outcome': 'fail' },
    );
    const live = bead('gcg-900', {
      status: 'in_progress',
      created_at: '2026-11-15T09:00:00Z',
      metadata: {
        'gc.kind': 'workflow',
        'gc.var.issue': TASK,
        'gc.formula_name': 'devwork-review-again',
      },
    });
    const liveStep = bead('gcg-901', {
      status: 'in_progress',
      title: 'Task review',
      metadata: { 'gc.root_bead_id': 'gcg-900', 'dashboard.stage': 'review' },
    });
    const result = stageOf(task({ status: 'in_progress' }), [old, live, liveStep]);
    expect(result.root?.id).toBe('gcg-900');
    expect(result.stage).toBe('review');
    expect(result.marks.map((m) => m.kind)).not.toContain('route-failed');
  });
});

describe('marks', () => {
  it('marks a failed route on an open task as attention', () => {
    const result = stageOf(task({ status: 'in_progress' }), [
      root({ status: 'closed' }, { 'gc.outcome': 'fail' }),
    ]);
    const mark = result.marks.find((m) => m.kind === 'route-failed');
    expect(mark?.tone).toBe('attention');
  });

  it('marks a task its stop card points at as stopped', () => {
    const stop = bead('dw-stop', {
      title: 'стоит: dw-aa1',
      metadata: { 'devwork.stopped_card': TASK, rejection_reason: 'GitHub Actions queue stalled' },
    });
    const result = stageOf(task({ status: 'in_progress' }), [root(), ...routeFrom(7)], [stop]);
    const mark = result.marks.find((m) => m.kind === 'stopped');
    expect(mark?.tone).toBe('attention');
    expect(mark?.title).toContain('GitHub Actions queue stalled');
    expect(result.stage).toBe('pr');
  });

  it('marks a cancelled route as stopped', () => {
    const result = stageOf(task({ status: 'in_progress' }), [
      root({}, { 'gc.cancel_requested': 'true' }),
      ...routeFrom(2),
    ]);
    expect(result.marks.map((m) => m.kind)).toContain('stopped');
  });

  it('marks a recorded TDD refusal', () => {
    const result = stageOf(
      task({
        status: 'in_progress',
        metadata: { 'devwork.tdd_refusal': 'round 2: exit 0 is not a RED' },
      }),
      [root(), ...routeFrom(3)],
    );
    expect(result.marks.find((m) => m.kind === 'tdd-refused')?.tone).toBe('attention');
  });

  it('marks a waiting task whose needs are all closed as ready', () => {
    const dep = bead('dw-dep', { status: 'closed' });
    const result = stageOf(task({ needs: ['dw-dep'] }), [], [dep]);
    expect(result.marks.map((m) => m.kind)).toContain('ready');
  });

  it('does not mark a queued run ready (ready is about a routeless task)', () => {
    const result = stageOf(task(), [
      root({ is_blocked: true }),
      ...routeFrom(0, 'open').map(blocked),
    ]);
    expect(result.stepLabel).toBe('Queued');
    expect(result.marks.map((m) => m.kind)).not.toContain('ready');
  });

  it('reads the PR number and url from the route gate', () => {
    const gate = step(
      'await-merge',
      null,
      { issue_type: 'gate' },
      {
        'gc.gate_type': 'gh:pr',
        'devwork.pr_number': '512',
        'devwork.pr_url': 'https://github.com/o/r/pull/512',
      },
    );
    const result = stageOf(task({ status: 'in_progress' }), [root(), gate, ...routeFrom(8)]);
    expect(result.pr).toEqual({ number: '512', url: 'https://github.com/o/r/pull/512' });
  });
});

describe('folding', () => {
  it('route beads never become board cards and land under their task', () => {
    const t = task({ status: 'in_progress' });
    const routeBeads = [root(), ...routeFrom(5)];
    const other = bead('dw-bb2');
    const graph = buildBeadGraph([t, other]);
    const columns = buildStageColumns(graph.nodes.values(), buildRouteIndex(routeBeads), new Map());
    const ids = Object.values(columns).flatMap((cards) => cards.map((c) => c.node.bead.id));
    expect(ids.sort()).toEqual(['dw-aa1', 'dw-bb2']);
    expect(columns.review.map((c) => c.node.bead.id)).toEqual([TASK]);
    expect(columns.waiting.map((c) => c.node.bead.id)).toEqual(['dw-bb2']);
  });

  it('keeps route beads off the board even if a caller passes them as nodes', () => {
    const graph = buildBeadGraph([task(), root(), step('implement', 'working')]);
    const columns = buildStageColumns(graph.nodes.values(), buildRouteIndex([]), new Map());
    const ids = Object.values(columns).flatMap((cards) => cards.map((c) => c.node.bead.id));
    expect(ids).toEqual([TASK]);
  });

  it('lists roots whose task is not on the board as orphans', () => {
    const orphan = bead('gcg-777', {
      metadata: { 'gc.kind': 'workflow', 'gc.formula_name': 'devwork-implementation' },
    });
    const index = buildRouteIndex([orphan, root()]);
    expect(index.orphanRoots(new Set([TASK])).map((r) => r.id)).toEqual(['gcg-777']);
  });

  it('sorts Merged by most recent close first', () => {
    const a = bead('dw-a', { status: 'closed', updated_at: '2026-11-15T07:00:00Z' });
    const b = bead('dw-b', { status: 'closed', updated_at: '2026-11-15T09:00:00Z' });
    const graph = buildBeadGraph([a, b]);
    const columns = buildStageColumns(graph.nodes.values(), buildRouteIndex([]), new Map());
    expect(columns.merged.map((c) => c.node.bead.id)).toEqual(['dw-b', 'dw-a']);
  });
});

describe('step link', () => {
  it('links to the run detail with the root scope and the step node', () => {
    const s = step('open-pr', 'pr');
    expect(routeRunHref(root(), s)).toBe(
      `/runs/${ROOT}?scope_kind=rig&scope_ref=devwork&node=${s.id}`,
    );
  });

  it('prefers explicit gc.scope_kind/gc.scope_ref and omits a missing step', () => {
    const r = bead('run-anchor', {
      metadata: { 'gc.kind': 'workflow', 'gc.scope_kind': 'city', 'gc.scope_ref': 'dashport-city' },
    });
    expect(routeRunHref(r, null)).toBe('/runs/run-anchor?scope_kind=city&scope_ref=dashport-city');
  });
});

function blocked(b: SupervisorBead): SupervisorBead {
  return { ...b, status: 'open', is_blocked: true };
}
