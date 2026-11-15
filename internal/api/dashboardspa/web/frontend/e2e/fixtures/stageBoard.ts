import type { Page, Route } from '@playwright/test';

// Stage-board fixtures for the Beads e2e and its screenshots. They are layered
// onto the seeded fake supervisor's real /beads responses with page.route, so
// the shared testdata/dashport corpus (which Layer A asserts) stays untouched.
//
// Shapes follow the city route formula formulas/devwork-development.toml (step
// ids, titles, order) and the engine's metadata keys (gascity 792305a91):
// a workflow root carries gc.kind=workflow and names its task in
// gc.drain_member_id / gc.var.issue; each step carries gc.root_bead_id,
// gc.step_ref and the formula step's `dashboard.stage`; the gh:pr gate carries
// devwork.pr_number / devwork.pr_url; a stop card carries devwork.stopped_card.

interface FixtureBead {
  id: string;
  title: string;
  status: 'open' | 'in_progress' | 'blocked' | 'closed';
  issue_type: string;
  created_at: string;
  updated_at?: string;
  priority?: number;
  is_blocked?: boolean;
  close_reason?: string;
  assignee?: string;
  metadata?: Record<string, string>;
}

const T0 = '2026-11-15T06:00:00Z';

function task(
  id: string,
  title: string,
  status: FixtureBead['status'],
  extra: Partial<FixtureBead> = {},
): FixtureBead {
  return { id, title, status, issue_type: 'task', created_at: T0, priority: 2, ...extra };
}

function root(id: string, taskId: string, extra: Partial<FixtureBead> = {}): FixtureBead {
  return {
    id,
    title: 'devwork-development',
    status: 'open',
    issue_type: 'task',
    created_at: '2026-11-15T07:00:00Z',
    is_blocked: false,
    ...extra,
    metadata: {
      'gc.kind': 'workflow',
      'gc.formula_name': 'devwork-development',
      'gc.formula_contract': 'graph.v2',
      'gc.drain_member_id': taskId,
      'gc.var.issue': taskId,
      'gc.root_store_ref': 'city:dashport-city',
      'gc.workflow_expanded': 'true',
      ...(extra.metadata ?? {}),
    },
  };
}

// formulas/devwork-development.toml step ids → titles and city stage labels.
const STEPS: ReadonlyArray<[string, string, string]> = [
  ['prepare-worktree', 'Prepare item worktree', 'working'],
  ['mark-in-progress', 'Mark the task card in progress', 'working'],
  ['implement', 'Inspect Superpowers implementation task', 'working'],
  ['verify-test-fails', 'Verify Superpowers task test fails', 'working'],
  ['verify-test-passes', 'Verify Superpowers task tests pass', 'working'],
  ['task-review', 'Task review (one reviewer, up to review_rounds rounds)', 'review'],
  ['record-item-result', 'Record Superpowers task result', 'review'],
  ['open-pr', 'PR в цель задачи и auto-merge', 'pr'],
  ['await-merge', 'Wait for the merge gate', 'pr'],
  ['verify-merged', 'Verify the merge gate', 'pr'],
  ['close-source-anchor', 'Закрыть задачу, когда её код в цели', 'merged'],
];

/** The open steps of a route from `from` on; the first is `firstStatus`. */
function steps(rootId: string, from: string, firstStatus: 'open' | 'in_progress'): FixtureBead[] {
  const start = STEPS.findIndex(([id]) => id === from);
  return STEPS.slice(start).map(([id, title, stage], i) => ({
    id: `${rootId}.${id}`,
    title,
    status: i === 0 ? firstStatus : 'open',
    issue_type: 'task',
    created_at: '2026-11-15T07:00:01Z',
    is_blocked: i !== 0,
    metadata: {
      'gc.root_bead_id': rootId,
      'gc.step_id': `devwork-development.${id}`,
      'gc.step_ref': `devwork-development.${id}`,
      'gc.scope_ref': 'devwork-route',
      'gc.scope_role': 'member',
      'dashboard.stage': stage,
    },
  }));
}

export const STAGE_TASKS = {
  waiting: task('dw-wait1', 'Runs page: rig filter for history', 'open'),
  blocked: task('dw-wait2', 'Archyl drift stage for review gates', 'blocked', { priority: 1 }),
  queued: task('dw-queue', 'Embeddings gateway executor (after M04 #1)', 'open'),
  working: task('dw-work', 'Bead read: split route beads off the board', 'in_progress'),
  review: task('dw-review', 'Mail: thread view keeps the reply draft', 'in_progress'),
  pr: task('dw-pr', 'Health: dolt-noms trend uses local time', 'in_progress'),
  stopped: task('dw-stopped', 'Agents: show the context meter per session', 'in_progress'),
  tdd: task('dw-tdd', 'Activity: commits tab paginates past 100', 'in_progress', {
    metadata: { 'devwork.tdd_refusal': 'round 2: exit 0 is not a RED' },
  }),
  merged: task('dw-merged1', 'Home: needs-you sentence counts attention only', 'closed', {
    updated_at: '2026-11-15T09:40:00Z',
    close_reason: 'merged into main at 3f2a9c1 (PR #498)',
  }),
  noop: task('dw-merged2', 'Runs: remove the duplicated formula label', 'closed', {
    updated_at: '2026-11-15T08:10:00Z',
    close_reason: 'no code change: the label was already gone on main',
  }),
} as const;

const STOP_CARD = task('dw-stopcard', 'стоит: dw-stopped (Agents #3) с 08:44 UTC', 'open', {
  priority: 0,
  metadata: {
    'devwork.stopped_card': 'dw-stopped',
    rejection_reason:
      'origin/devwork/task/dw-stopped holds a superseded commit; the Mayor may not push',
  },
});

const ROUTE_BEADS: FixtureBead[] = [
  root('gcg-q', 'dw-queue', { is_blocked: true }),
  ...steps('gcg-q', 'prepare-worktree', 'open').map((s) => ({ ...s, is_blocked: true })),
  root('gcg-w', 'dw-work', { status: 'in_progress' }),
  ...steps('gcg-w', 'verify-test-fails', 'in_progress'),
  root('gcg-r', 'dw-review'),
  ...steps('gcg-r', 'task-review', 'in_progress'),
  root('gcg-p', 'dw-pr'),
  ...steps('gcg-p', 'await-merge', 'open'),
  {
    id: 'gcg-p.gate',
    title: 'gh:pr merge gate',
    status: 'open',
    issue_type: 'gate',
    created_at: '2026-11-15T07:00:02Z',
    metadata: {
      'gc.root_bead_id': 'gcg-p',
      'gc.gate_type': 'gh:pr',
      'devwork.task': 'dw-pr',
      'devwork.pr_number': '512',
      'devwork.pr_url': 'https://github.com/example/devwork/pull/512',
    },
  },
  root('gcg-s', 'dw-stopped'),
  ...steps('gcg-s', 'open-pr', 'open'),
  root('gcg-t', 'dw-tdd'),
  ...steps('gcg-t', 'verify-test-fails', 'open'),
];

const TASK_BEADS: FixtureBead[] = [...Object.values(STAGE_TASKS), STOP_CARD];
const ALL: FixtureBead[] = [...TASK_BEADS, ...ROUTE_BEADS];

/** Ids of every route bead the board must fold (never render as a card). */
export const ROUTE_BEAD_IDS: readonly string[] = ROUTE_BEADS.map((b) => b.id);

function matches(bead: FixtureBead, query: URLSearchParams): boolean {
  // Route beads live in the city store; a rig-scoped read sees only the tasks.
  if (query.has('rig') && !TASK_BEADS.includes(bead)) return false;
  const status = query.get('status');
  if (status !== null) return bead.status === status;
  if (query.get('all') === 'true') return true;
  return bead.status !== 'closed';
}

/** Layer the fixtures onto the fake supervisor's bead list and detail reads. */
export async function injectStageBoard(page: Page): Promise<void> {
  await page.route('**/v0/city/*/beads?*', async (route: Route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    const response = await route.fetch();
    const body = (await response.json()) as { items?: unknown[]; total?: number };
    const extra = ALL.filter((b) => matches(b, url.searchParams));
    const items = [...(body.items ?? []), ...extra];
    await route.fulfill({
      response,
      json: { ...body, items, total: (body.total ?? 0) + extra.length },
    });
  });
  await page.route('**/v0/city/*/bead/*', async (route: Route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop() ?? '');
    const hit = ALL.find((b) => b.id === id);
    if (hit === undefined || route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await route.fulfill({ json: hit });
  });
}
