import { afterEach, describe, expect, it } from 'vitest';
import type { Bead } from 'gas-city-dashboard-shared/gc-supervisor';

import { setLocale } from '../i18n';
import { m04Idle } from '../test/fixtures/m04Idle';
import type { TaskStage } from './stageBoard';
import {
  cardWait,
  explainIdle,
  holdsCount,
  milestoneOf,
  waitCauseText,
  type WaitCause,
} from './waitReasons';

function bead(id: string, extra: Partial<Bead> = {}): Bead {
  return {
    id,
    title: id,
    status: 'open',
    issue_type: 'task',
    created_at: '2026-11-15T08:00:00Z',
    ...extra,
  };
}

const blocks = (issue: string, target: string) => ({
  issue_id: issue,
  depends_on_id: target,
  type: 'blocks',
});

function stage(extra: Partial<TaskStage> = {}): TaskStage {
  return {
    stage: 'waiting',
    root: null,
    step: null,
    stepLabel: null,
    pr: null,
    marks: [],
    ...extra,
  };
}

const RUN_HREF = '/runs/gcg-153601?scope_kind=rig&scope_ref=devwork';
const DECISION_TITLE = 'M03 #2 / L1: перенос ящика на основной аккаунт и 0424 — когда окно?';

afterEach(() => setLocale('en'));

describe('milestoneOf', () => {
  it('reads the value after the stage label prefix', () => {
    expect(milestoneOf(bead('a', { labels: ['x', 'milestone:M04'] }))).toBe('M04');
    expect(milestoneOf(bead('b'))).toBeNull();
  });
});

describe('explainIdle', () => {
  it('idle with an open cross-store gate names the card', () => {
    expect(explainIdle(m04Idle(), 0)).toEqual({
      state: 'idle',
      causes: [
        {
          kind: 'card',
          tasks: 2,
          milestone: 'M04',
          blocker: {
            id: 'dw-4xn4b',
            title: 'Пакет этапа M04: исполнимый план по мастер-плану §4/§7',
          },
          runHref: RUN_HREF,
        },
        { kind: 'decision', tasks: 1, gate: { id: 'dw-ssmbcp', title: DECISION_TITLE } },
      ],
    });
  });

  it('a released gate is no cause', () => {
    const input = m04Idle();
    const gate = input.routeItems.find((b) => b.id === 'gcg-xsg-2212cab1108e')!;
    gate.status = 'closed';
    gate.metadata = { ...gate.metadata, 'gc.cross_store_gate_state': 'released' };
    const idle = explainIdle(input, 0);
    expect(idle.state).toBe('idle');
    if (idle.state !== 'idle') return;
    expect(idle.causes[0]).toEqual({
      kind: 'queue',
      tasks: 3,
      milestone: 'M04',
      runHref: RUN_HREF,
    });
  });

  it('busy when any task works', () => {
    expect(explainIdle(m04Idle(), 4)).toEqual({ state: 'busy' });
  });

  it('unknown on a truncated window', () => {
    expect(explainIdle({ ...m04Idle(), routesComplete: false }, 0)).toEqual({ state: 'unknown' });
  });

  it('no runs', () => {
    const input = {
      tasks: [bead('dw-a'), bead('dw-b'), bead('dw-c')],
      routeItems: [],
      serviceItems: [],
      routesComplete: true,
    };
    expect(explainIdle(input, 0)).toEqual({
      state: 'idle',
      causes: [{ kind: 'no-runs', ready: 3 }],
    });
  });

  it('a blocker outside the window keeps its id', () => {
    const input = m04Idle();
    input.tasks = input.tasks.filter((b) => b.id !== 'dw-4xn4b');
    const idle = explainIdle(input, 0);
    if (idle.state !== 'idle') throw new Error('not idle');
    const card = idle.causes.find((c) => c.kind === 'card');
    expect(card?.kind === 'card' && card.blocker).toEqual({ id: 'dw-4xn4b', title: null });
  });

  it('mixed stages give no stage name', () => {
    const input = m04Idle();
    input.tasks.find((b) => b.id === 'dw-iy9a')!.labels = ['milestone:M03'];
    const idle = explainIdle(input, 0);
    if (idle.state !== 'idle') throw new Error('not idle');
    const card = idle.causes.find((c) => c.kind === 'card');
    expect(card?.kind === 'card' && card.milestone).toBeNull();
  });

  it('at most three causes', () => {
    const gates = [1, 2, 3, 4, 5].map((n) => bead(`dw-g${n}`, { issue_type: 'gate' }));
    const waiters = [1, 2, 3, 4, 5].map((n) =>
      bead(`dw-w${n}`, { is_blocked: true, dependencies: [blocks(`dw-w${n}`, `dw-g${n}`)] }),
    );
    const idle = explainIdle(
      { tasks: waiters, routeItems: [], serviceItems: gates, routesComplete: true },
      0,
    );
    if (idle.state !== 'idle') throw new Error('not idle');
    expect(idle.causes).toHaveLength(3);
  });
});

describe('cardWait', () => {
  const byId = (beads: Bead[]) => new Map(beads.map((b) => [b.id, b]));

  it('queued', () => {
    const task = bead('dw-q', { is_blocked: true });
    expect(
      cardWait(task, stage({ stepLabel: 'Queued', root: bead('gcg-q') }), byId([task])),
    ).toEqual({ kind: 'queued' });
  });

  it('ready', () => {
    const task = bead('dw-r');
    expect(cardWait(task, stage(), byId([task]))).toEqual({ kind: 'ready' });
  });

  it('waits for two tasks', () => {
    const a = bead('dw-a');
    const b = bead('dw-b');
    const c = bead('dw-c', { status: 'closed' });
    const task = bead('dw-t', {
      is_blocked: true,
      needs: ['dw-a'],
      dependencies: [blocks('dw-t', 'dw-b'), blocks('dw-t', 'dw-c')],
    });
    expect(cardWait(task, stage(), byId([a, b, c, task]))).toEqual({ kind: 'tasks', count: 2 });
  });

  it('waits for a decision', () => {
    const input = m04Idle();
    const all = [...input.tasks, ...input.serviceItems];
    const task = all.find((b) => b.id === 'dw-eba63b7db1e9a14e.2')!;
    expect(cardWait(task, stage(), byId(all))).toEqual({
      kind: 'decision',
      gate: { id: 'dw-ssmbcp', title: DECISION_TITLE },
    });
  });

  it('held', () => {
    const task = bead('dw-h', { is_blocked: true });
    expect(cardWait(task, stage(), byId([task]))).toEqual({ kind: 'held' });
  });

  it('only Waiting', () => {
    const task = bead('dw-w');
    expect(cardWait(task, stage({ stage: 'working' }), byId([task]))).toBeNull();
  });
});

describe('holdsCount', () => {
  it('holdsCount counts open dependants only', () => {
    const tasks = [
      bead('dw-1', { dependencies: [blocks('dw-1', 'dw-4xn4b')] }),
      bead('dw-2', { needs: ['dw-4xn4b'] }),
      bead('dw-3', { dependencies: [blocks('dw-3', 'dw-4xn4b')] }),
      bead('dw-4', { status: 'closed', dependencies: [blocks('dw-4', 'dw-4xn4b')] }),
    ];
    expect(holdsCount('dw-4xn4b', tasks)).toBe(3);
  });
});

describe('waitCauseText', () => {
  const card = (tasks: number, milestone: string | null): WaitCause => ({
    kind: 'card',
    tasks,
    milestone,
    blocker: { id: 'dw-4xn4b', title: null },
    runHref: null,
  });

  it('speaks Russian', () => {
    setLocale('ru');
    expect(waitCauseText(card(13, 'M04'))).toBe('13 задач этапа M04 ждут карточку dw-4xn4b');
    expect(waitCauseText(card(1, 'M04'))).toBe('1 задача этапа M04 ждёт карточку dw-4xn4b');
    expect(waitCauseText(card(2, null))).toBe('2 задачи прогона ждут карточку dw-4xn4b');
    expect(
      waitCauseText({
        kind: 'decision',
        tasks: 3,
        gate: { id: 'dw-ssmbcp', title: DECISION_TITLE },
      }),
    ).toBe(`3 задачи ждут решения: «${DECISION_TITLE}»`);
    expect(waitCauseText({ kind: 'queue', tasks: 18, milestone: 'M04', runHref: null })).toBe(
      '18 задач этапа M04 в очереди, ни одна ещё не начата',
    );
    expect(waitCauseText({ kind: 'no-runs', ready: 3 })).toBe(
      'Запущенных прогонов нет. Можно брать 3 задачи.',
    );
  });

  it('speaks English', () => {
    expect(waitCauseText(card(13, 'M04'))).toBe('13 tasks of stage M04 wait for card dw-4xn4b');
  });
});
