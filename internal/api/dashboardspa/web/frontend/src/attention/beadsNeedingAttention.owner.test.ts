import { describe, expect, it } from 'vitest';
import type { Bead } from 'gas-city-dashboard-shared/gc-supervisor';
import { setLocale } from '../i18n';
import { selectBeadsNeedingAttention } from './beadsNeedingAttention';

const NOW = Date.parse('2026-06-05T12:00:00.000Z');
const FOUR_DAYS_AGO = '2026-06-01T12:00:00.000Z';

function bead(overrides: Partial<Bead>): Bead {
  return {
    created_at: FOUR_DAYS_AGO,
    updated_at: FOUR_DAYS_AGO,
    id: 'B-0',
    issue_type: 'task',
    status: 'open',
    title: 'Bead',
    ...overrides,
  };
}

describe('selectBeadsNeedingAttention, owner pass', () => {
  it('blocked, epic and gate are not unclaimed', () => {
    const rows = selectBeadsNeedingAttention(
      {
        beads: [
          bead({ id: 'B-1', is_blocked: true } as Partial<Bead>),
          bead({ id: 'B-2', issue_type: 'epic' }),
          bead({ id: 'B-3', issue_type: 'gate' }),
        ],
        escalations: [],
      },
      NOW,
    );
    expect(rows).toEqual([]);
  });

  it('workflow root is never stalled', () => {
    const rows = selectBeadsNeedingAttention(
      {
        beads: [bead({ status: 'in_progress', metadata: { 'gc.kind': 'workflow' } })],
        escalations: [],
        sessions: [],
      },
      NOW,
    );
    expect(rows).toEqual([]);
  });

  it('stalled step reports its task by title', () => {
    const root = bead({
      id: 'R',
      status: 'in_progress',
      assignee: 'x',
      metadata: { 'gc.kind': 'workflow', 'gc.var.issue': 'dw-1' },
    });
    const step = bead({
      id: 'R.3',
      status: 'in_progress',
      title: 'Review round 1',
      metadata: { 'gc.root_bead_id': 'R' },
    });
    const rows = selectBeadsNeedingAttention(
      {
        beads: [],
        escalations: [],
        sessions: [],
        routeItems: [root, step],
        taskTitles: new Map([['dw-1', 'Вход по ссылке']]),
      },
      NOW,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ beadId: 'dw-1', title: 'Вход по ссылке', reason: 'stalled' });
    expect(rows[0]?.summary).toContain('Review round 1');
  });

  it('stalled step outside the view is named as such, once per task', () => {
    const root = bead({
      id: 'R',
      status: 'in_progress',
      metadata: { 'gc.kind': 'workflow', 'gc.var.issue': 'dw-404' },
    });
    const a = bead({ id: 'R.1', status: 'in_progress', metadata: { 'gc.root_bead_id': 'R' } });
    const b = bead({ id: 'R.2', status: 'in_progress', metadata: { 'gc.root_bead_id': 'R' } });
    const rows = selectBeadsNeedingAttention(
      { beads: [], escalations: [], sessions: [], routeItems: [root, a, b] },
      NOW,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ beadId: 'dw-404', title: 'A task outside this view' });
    setLocale('ru');
    try {
      const ru = selectBeadsNeedingAttention(
        { beads: [], escalations: [], sessions: [], routeItems: [root, a, b] },
        NOW,
      );
      expect(ru[0]?.title).toBe('Задача вне окна');
    } finally {
      setLocale('en');
    }
  });

  // Review I3: one row per task, and a task worked by its run is not stalled
  // for lacking an assignee.
  it('an in-flight task and its stalled step give one row', () => {
    const task = bead({ id: 'dw-work', title: 'Bead read', status: 'in_progress' });
    const root = bead({
      id: 'R',
      status: 'in_progress',
      metadata: { 'gc.kind': 'workflow', 'gc.var.issue': 'dw-work' },
    });
    const stepBead = bead({
      id: 'R.2',
      title: 'Verify the test fails',
      status: 'in_progress',
      metadata: { 'gc.root_bead_id': 'R' },
    });
    const rows = selectBeadsNeedingAttention(
      {
        beads: [task],
        escalations: [],
        sessions: [],
        routeItems: [root, stepBead],
        taskTitles: new Map([['dw-work', 'Bead read']]),
      },
      NOW,
    );
    expect(rows.map((row) => `${row.beadId}:${row.reason}`)).toEqual(['dw-work:stalled']);
    expect(rows[0]?.summary).toContain('Verify the test fails');
  });

  it('a task worked by a live run is not stalled for lacking an assignee', () => {
    const task = bead({ id: 'dw-ok', status: 'in_progress' });
    const root = bead({
      id: 'R',
      status: 'in_progress',
      metadata: { 'gc.kind': 'workflow', 'gc.var.issue': 'dw-ok' },
    });
    const running = bead({
      id: 'R.1',
      status: 'in_progress',
      assignee: 'worker',
      metadata: { 'gc.root_bead_id': 'R' },
    });
    const rows = selectBeadsNeedingAttention(
      {
        beads: [task],
        escalations: [],
        sessions: [{ id: 's1', session_name: 'worker', state: 'active', last_active: '2026-06-05T11:59:00Z' }],
        routeItems: [root, running],
      },
      NOW,
    );
    expect(rows).toEqual([]);
  });

  it('waiting row names its actor', () => {
    const rows = selectBeadsNeedingAttention(
      {
        beads: [
          bead({
            id: 'B-w',
            title: 'Pick a colour',
            status: 'in_progress',
            assignee: 'w',
            metadata: { 'gc.checkpoint_hold': 'design', 'gc.waiting_on': 'human' },
          }),
        ],
        escalations: [],
      },
      NOW,
    );
    expect(rows[0]).toMatchObject({ waitingOn: 'human', title: 'Pick a colour' });
  });
});
