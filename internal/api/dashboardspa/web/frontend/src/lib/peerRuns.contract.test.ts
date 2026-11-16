import { describe, expect, it } from 'vitest';
import type { SupervisorBead } from '../supervisor/beadReads';
import { m04Idle } from '../test/fixtures/m04Idle';
import { buildBeadGraph } from './beadGraph';
import contract from './peerRuns.contract.json';
import {
  buildRouteIndex,
  deriveTaskStage,
  ROOT_TASK_KEYS,
  routeTaskId,
  stopCardsByTask,
  type TaskStage,
} from './stageBoard';

// PEER-STAGE (16.11): the home city ships its runs slimmed to this contract
// (city repo assets/scripts/boardsync/live_runs.py, its own copy of the JSON).
// These tests pin the contract to the one set of stage rules, stageBoard.ts:
// the key order the city uses to pick a run's task, and an allowlist that
// never changes where a card lands.

/** What the city keeps of a run bead (the contract, nothing else). */
function slim(bead: SupervisorBead): SupervisorBead {
  const out: Record<string, unknown> = {};
  for (const field of contract.bead_fields) {
    const value = (bead as unknown as Record<string, unknown>)[field];
    if (value !== undefined && value !== null) out[field] = value;
  }
  const meta: Record<string, string> = {};
  for (const key of contract.metadata_keys) {
    const value = bead.metadata?.[key];
    if (value !== undefined) meta[key] = value;
  }
  if (Object.keys(meta).length > 0) out.metadata = meta;
  return out as unknown as SupervisorBead;
}

function placed(task: SupervisorBead, runs: readonly SupervisorBead[], complete = true): TaskStage {
  const node = buildBeadGraph([task]).nodes.get(task.id);
  if (node === undefined) throw new Error('missing node');
  return deriveTaskStage(node, buildRouteIndex(runs, { routesComplete: complete }), stopCardsByTask([task]));
}

const view = (s: TaskStage) => ({
  stage: s.stage,
  stepLabel: s.stepLabel,
  pr: s.pr,
  step: s.step?.id ?? null,
  root: s.root?.id ?? null,
  marks: s.marks.map((m) => m.kind),
});

const TASK = 'dw-aa1';
const ROOT = 'gcg-100';
const t = (extra: Partial<SupervisorBead> = {}): SupervisorBead => ({
  id: TASK,
  title: 'Ship it',
  status: 'in_progress',
  issue_type: 'task',
  created_at: '2026-11-15T08:00:00Z',
  ...extra,
});
const root = (meta: Record<string, string> = {}, extra: Partial<SupervisorBead> = {}): SupervisorBead => ({
  id: ROOT,
  title: 'devwork-development',
  status: 'in_progress',
  issue_type: 'task',
  is_blocked: false,
  created_at: '2026-11-15T08:01:00Z',
  updated_at: '2026-11-15T09:00:00Z',
  assignee: 'someone',
  description: 'a long run description that never travels',
  metadata: {
    'gc.kind': 'workflow',
    'gc.var.issue': TASK,
    'gc.formula_name': 'devwork-development',
    'gc.root_store_ref': 'rig:devwork',
    'gc.session_name': 'secret-session',
    ...meta,
  },
  ...extra,
});
let n = 0;
const step = (
  stage: string | null,
  extra: Partial<SupervisorBead> = {},
  meta: Record<string, string> = {},
): SupervisorBead => {
  n += 1;
  return {
    id: `gcg-${200 + n}`,
    title: `Step ${n}`,
    status: 'open',
    issue_type: 'task',
    is_blocked: true,
    created_at: '2026-11-15T08:02:00Z',
    updated_at: '2026-11-15T09:10:00Z',
    assignee: 'worker',
    metadata: {
      'gc.root_bead_id': ROOT,
      'gc.step_ref': `devwork-development.s${n}`,
      ...(stage === null ? {} : { 'dashboard.stage': stage }),
      ...meta,
    },
    ...extra,
  };
};

// Every route shape the board places differently (stageBoard.test.ts cases).
const SCENARIOS: ReadonlyArray<[string, SupervisorBead, SupervisorBead[]]> = [
  ['running review step', t(), [root(), step('review', { status: 'in_progress', is_blocked: false }, { 'dashboard.label': 'ревью' }), step('pr')]],
  ['ready working step', t(), [root(), step('working', { is_blocked: false }, { 'dashboard.label': 'пишет код' }), step('review')]],
  ['queued run', t({ status: 'open' }), [root({}, { status: 'open', is_blocked: true }), step('working')]],
  ['await merge at the gate', t(), [root(), step(null, { issue_type: 'gate', is_blocked: false }, { 'devwork.pr_number': '584', 'devwork.pr_url': 'https://github.com/o/r/pull/584' }), step('pr', {}, { 'dashboard.label': 'ждёт вливания' })]],
  ['merged-labelled step on an open task', t(), [root(), step('merged', { status: 'in_progress', is_blocked: false })]],
  ['cancel requested', t(), [root({ 'gc.cancel_requested': 'true' }), step('working', { status: 'in_progress', is_blocked: false })]],
  ['task PR moves a working card to PR', t({ metadata: { 'devwork.pr_number': '12' } }), [root(), step('working', { status: 'in_progress', is_blocked: false })]],
  ['only spec members open', t(), [root(), step(null, { issue_type: 'spec', is_blocked: false }, { 'gc.kind': 'spec' })]],
  ['no run (in progress)', t(), []],
  ['closed task', t({ status: 'closed' }), [root(), step('pr')]],
  ['a run of another task only', t(), [root({ 'gc.var.issue': 'dw-other' }), step('review', { status: 'in_progress', is_blocked: false })]],
  ['two runs: live before queued', t(), [root({}, { id: 'gcg-900', status: 'open', is_blocked: true, created_at: '2026-11-15T10:00:00Z' }), root(), step('review', { status: 'in_progress', is_blocked: false })]],
];

describe('PEER-STAGE runs contract', () => {
  it('the task key order is stageBoard ROOT_TASK_KEYS', () => {
    expect([...ROOT_TASK_KEYS]).toEqual(contract.root_task_keys);
  });

  it('every root→task case resolves as routeTaskId does', () => {
    for (const c of contract.root_task_cases) {
      const r: SupervisorBead = {
        id: 'gcg-1',
        title: 'r',
        status: 'open',
        issue_type: 'task',
        created_at: '2026-11-15T08:00:00Z',
        metadata: c.metadata as Record<string, string>,
      };
      expect(routeTaskId(r)).toBe(c.task);
    }
  });

  it.each(SCENARIOS)('slimming to the contract never moves a card: %s', (_name, task, runs) => {
    for (const complete of [true, false]) {
      expect(view(placed(task, runs.map(slim), complete))).toEqual(view(placed(task, runs, complete)));
    }
  });

  it('slimming never moves the live-shaped M04 cards (fixture m04Idle)', () => {
    const input = m04Idle();
    const runs = input.routeItems;
    for (const task of input.tasks) {
      expect(view(placed(task, runs.map(slim)))).toEqual(view(placed(task, runs)));
    }
  });

  it('the contract drops what the board never reads (assignee, description, sessions)', () => {
    const s = slim(root());
    expect(Object.keys(s).sort()).toEqual(['created_at', 'id', 'is_blocked', 'issue_type', 'metadata', 'status', 'title']);
    expect(s.metadata).toEqual({ 'gc.kind': 'workflow', 'gc.var.issue': TASK });
  });
});
