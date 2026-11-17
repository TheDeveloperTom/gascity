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
  stepNoteOf,
  type StageId,
  type TaskStage,
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
// labels each one with (STAGE-BOARD-PLAN.md, city labels table; round 1:
// close-source-anchor is PR, because Merged means the task is closed).
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
  ['close-source-anchor', 'pr'],
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

  it('links a root to its task through the engine keys, the city anchor first', () => {
    expect(routeTaskId(root())).toBe(TASK);
    expect(routeTaskId(root({}, { 'gc.source_bead_id': 'dw-src' }))).toBe('dw-src');
    // Review M9: the city's own resolver (devwork-strand.sh) reads
    // gc.source_anchor_id first, so the board does too.
    expect(
      routeTaskId(root({}, { 'gc.source_bead_id': 'dw-src', 'gc.source_anchor_id': 'dw-anchor' })),
    ).toBe('dw-anchor');
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

describe('closed but not merged (review M2)', () => {
  it.each([['skipped'], ['fail']])(
    'gives a closed task with outcome %s a quiet hint',
    (outcome) => {
      const result = stageOf(task({ status: 'closed', metadata: { 'gc.outcome': outcome } }), []);
      expect(result.stage).toBe('merged');
      expect(result.marks).toContainEqual(
        expect.objectContaining({ kind: 'not-merged', tone: 'quiet', label: 'closed, not merged' }),
      );
    },
  );

  it('gives a merged task (outcome pass) no hint', () => {
    const result = stageOf(task({ status: 'closed', metadata: { 'gc.outcome': 'pass' } }), []);
    expect(result.marks).toEqual([]);
  });
});

describe('Merged means closed (coordinator ruling I4)', () => {
  it('an open task is never Merged, even at a step labelled merged', () => {
    const lastStep = step('close-source-anchor', 'merged', { is_blocked: false });
    const result = stageOf(task({ status: 'in_progress' }), [root(), lastStep]);
    expect(result.stage).toBe('pr');
    expect(result.step?.id).toBe(lastStep.id);
  });

  it('an open task claimed at a merged-labelled step is still PR', () => {
    const lastStep = step('close-source-anchor', 'merged', {
      status: 'in_progress',
      is_blocked: false,
    });
    expect(stageOf(task({ status: 'in_progress' }), [root(), lastStep]).stage).toBe('pr');
  });
});

describe('a stopped run shows on its open task (review I6)', () => {
  function stageWith(t: SupervisorBead, routeBeads: SupervisorBead[], routesComplete: boolean) {
    const graph = buildBeadGraph([t]);
    const node = graph.nodes.get(t.id);
    if (!node) throw new Error('missing node');
    return deriveTaskStage(node, buildRouteIndex(routeBeads, { routesComplete }), new Map());
  }

  it('marks an in-progress task with no live run as route stopped', () => {
    // mark-in-progress ran, then the run ended (scope abort closes every
    // member and the root), so no open route bead names the task any more.
    const result = stageWith(task({ status: 'in_progress' }), [], true);
    const mark = result.marks.find((m) => m.kind === 'route-stopped');
    expect(mark?.tone).toBe('attention');
    expect(mark?.label).toBe('route stopped');
  });

  it('does not infer a stop when the route window was truncated', () => {
    const result = stageWith(task({ status: 'in_progress' }), [], false);
    expect(result.marks.map((m) => m.kind)).not.toContain('route-stopped');
  });

  it('does not mark a task whose run is live', () => {
    const result = stageWith(task({ status: 'in_progress' }), [root(), ...routeFrom(3)], true);
    expect(result.marks.map((m) => m.kind)).not.toContain('route-stopped');
  });

  it('shows a visible failed run once, as route failed, and never as ready', () => {
    const failed = root({ status: 'closed' }, { 'gc.outcome': 'fail' });
    const result = stageWith(task(), [failed], true);
    const kinds = result.marks.map((m) => m.kind);
    expect(kinds).toContain('route-failed');
    expect(kinds).not.toContain('route-stopped');
    expect(kinds).not.toContain('ready');
  });
});

describe('columns move forward only (coordinator ruling I5)', () => {
  it('a task with a PR stays in PR while a pr-accept run reviews it', () => {
    const accept = root({}, { 'gc.formula_name': 'devwork-pr-accept' });
    const review = step('accept-evidence', 'review', {
      title: 'review of the fix',
      status: 'in_progress',
      is_blocked: false,
    });
    const result = stageOf(
      task({ status: 'in_progress', metadata: { 'devwork.pr_number': '475' } }),
      [accept, review],
    );
    expect(result.stage).toBe('pr');
    expect(result.stepLabel).toBe('review of the fix');
  });

  it('a PR on the route gate also holds the card in PR during a repair review', () => {
    const gate = step('await-merge', null, { issue_type: 'gate' }, { 'devwork.pr_number': '9' });
    const reviewing = step('task-review', 'review', { status: 'in_progress', is_blocked: false });
    expect(stageOf(task({ status: 'in_progress' }), [root(), gate, reviewing]).stage).toBe('pr');
  });

  it('an open task with a PR and no live run is in PR, not Waiting', () => {
    const result = stageOf(task({ metadata: { 'devwork.pr_number': '12' } }), []);
    expect(result.stage).toBe('pr');
  });

  it('a task without a PR still shows Review during its first review', () => {
    expect(stageOf(task({ status: 'in_progress' }), [root(), ...routeFrom(5)]).stage).toBe(
      'review',
    );
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

  // B6: the `ready` mark is gone; lib/waitReasons cardWait owns «можно брать».
  it('a waiting task carries no ready mark', () => {
    const dep = bead('dw-dep', { status: 'closed' });
    const result = stageOf(task({ needs: ['dw-dep'] }), [], [dep]);
    expect(result.marks.map((m) => m.kind as string)).not.toContain('ready');
  });

  it('a queued run says Queued', () => {
    const result = stageOf(task(), [
      root({ is_blocked: true }),
      ...routeFrom(0, 'open').map(blocked),
    ]);
    expect(result.stepLabel).toBe('Queued');
  });

  it('the step label prefers dashboard.label', () => {
    const steps = routeFrom(0).map((s, i) =>
      i === 0
        ? { ...s, metadata: { ...s.metadata, 'dashboard.label': 'готовит рабочую копию' } }
        : s,
    );
    const result = stageOf(task(), [root(), ...steps]);
    expect(result.stepLabel).toBe('готовит рабочую копию');
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

  it('combines a number on the task with the url on the gate (review M8)', () => {
    const gate = step(
      'await-merge',
      null,
      { issue_type: 'gate' },
      { 'devwork.pr_url': 'https://github.com/o/r/pull/77' },
    );
    const result = stageOf(
      task({ status: 'in_progress', metadata: { 'devwork.pr_number': '77' } }),
      [root(), gate, ...routeFrom(8)],
    );
    expect(result.pr).toEqual({ number: '77', url: 'https://github.com/o/r/pull/77' });
  });
});

describe('PR url safety (agents write card metadata, so the url is untrusted)', () => {
  function prWith(url: string) {
    const gate = step(
      'await-merge',
      null,
      { issue_type: 'gate' },
      {
        'devwork.pr_number': '512',
        'devwork.pr_url': url,
      },
    );
    return stageOf(task({ status: 'in_progress' }), [root(), gate, ...routeFrom(8)]).pr;
  }

  it.each([
    ['javascript:alert(1)'],
    ['JavaScript:alert(1)'],
    ['data:text/html,<script>alert(1)</script>'],
    ['not a url at all'],
    ['//evil.example/pull/1'],
    ['ftp://example.com/pull/1'],
  ])('drops %s as a link but keeps the PR number', (url) => {
    expect(prWith(url)).toEqual({ number: '512', url: null });
  });

  it('keeps an https PR url', () => {
    expect(prWith('https://github.com/o/r/pull/512')).toEqual({
      number: '512',
      url: 'https://github.com/o/r/pull/512',
    });
  });

  // Review M4: an agent-written url may point anywhere, so only a GitHub pull
  // request page becomes a link; the number still shows as text.
  it.each([
    ['http://github.com/o/r/pull/512'],
    ['https://evil.example/o/r/pull/512'],
    ['https://github.com.evil.example/o/r/pull/512'],
    ['https://github.com/o/r/issues/512'],
    ['https://github.com/o/r/pull/512/../../../settings'],
    ['https://user@github.com/o/r/pull/512'],
  ])('keeps %s as text, not a link', (url) => {
    expect(prWith(url)).toEqual({ number: '512', url: null });
  });

  it('keeps a GitHub pull url with a trailing path such as /files', () => {
    expect(prWith('https://github.com/o/r/pull/512/files')?.url).toBe(
      'https://github.com/o/r/pull/512/files',
    );
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

  it('keeps hostile ids and scope values inside an encoded /runs/ path', () => {
    const r = bead('javascript:alert(1)//x', {
      metadata: { 'gc.kind': 'workflow', 'gc.scope_kind': 'javascript', 'gc.scope_ref': 'x' },
    });
    const s = bead('javascript:alert(2)');
    const href = routeRunHref(r, s);
    expect(href.startsWith('/runs/javascript%3Aalert(1)%2F%2Fx')).toBe(true);
    expect(href).not.toContain('scope_kind');
    expect(new URLSearchParams(href.split('?')[1]).get('node')).toBe('javascript:alert(2)');
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

describe('stepNoteOf (PEER-STAGE: one step note for our cards and the peer\'s)', () => {
  const stage = (s: StageId, stepLabel: string | null): TaskStage => ({
    stage: s,
    root: null,
    step: null,
    stepLabel,
    pr: null,
    marks: [],
  });

  it('names the step of an active card', () => {
    expect(stepNoteOf(stage('working', 'пишет код'))).toBe('пишет код');
    expect(stepNoteOf(stage('review', 'ревью'))).toBe('ревью');
    expect(stepNoteOf(stage('pr', 'ждёт вливания'))).toBe('ждёт вливания');
  });

  it('says nothing for a waiting or merged card, a queued run or an empty label', () => {
    expect(stepNoteOf(stage('waiting', 'Queued'))).toBeNull();
    expect(stepNoteOf(stage('waiting', 'готовит рабочую копию'))).toBeNull();
    expect(stepNoteOf(stage('merged', 'Finalize workflow'))).toBeNull();
    expect(stepNoteOf(stage('working', 'Queued'))).toBeNull();
    expect(stepNoteOf(stage('working', ''))).toBeNull();
    expect(stepNoteOf(stage('working', null))).toBeNull();
  });
});

describe('a card the Mayor paused (hold:mayor / hold:external) waits, it is not a stopped run', () => {
  function stageWith(t: SupervisorBead, routeBeads: SupervisorBead[] = []) {
    const graph = buildBeadGraph([t]);
    const node = graph.nodes.get(t.id);
    if (!node) throw new Error('missing node');
    return deriveTaskStage(node, buildRouteIndex(routeBeads, { routesComplete: true }), new Map());
  }
  const REASON = 'mayor, 2026-11-16T08:12:00Z: ждём решения по схеме';

  it('an in-progress paused task sits in Waiting with its pause and no «route stopped»', () => {
    const result = stageWith(
      task({ status: 'in_progress', labels: ['hold:mayor'], metadata: { 'devwork.pause_reason': REASON } }),
    );
    expect(result.stage).toBe('waiting');
    expect(result.marks.map((m) => m.kind)).not.toContain('route-stopped');
    expect(result.pause).toMatchObject({ hold: 'mayor', who: 'mayor', reason: 'ждём решения по схеме' });
  });

  it('hold:external is a pause too, even with a live run left over', () => {
    const result = stageWith(task({ status: 'in_progress', labels: ['hold:external'] }), [root(), ...routeFrom(3)]);
    expect(result.stage).toBe('waiting');
    expect(result.pause?.hold).toBe('external');
  });

  it('hold:plan and hold:cleared are not a pause; a closed paused task is merged', () => {
    expect(stageWith(task({ status: 'in_progress', labels: ['hold:cleared'] })).stage).toBe('working');
    expect(stageWith(task({ status: 'in_progress', labels: ['hold:cleared'] })).pause ?? null).toBeNull();
    expect(stageWith(task({ labels: ['hold:plan'] })).pause ?? null).toBeNull();
    expect(stageWith(task({ status: 'closed', labels: ['hold:mayor'] })).stage).toBe('merged');
  });
});
