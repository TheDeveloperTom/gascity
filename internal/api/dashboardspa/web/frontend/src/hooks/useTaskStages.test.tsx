import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { AttentionProvider } from '../attention/context';
import type { BeadSnapshot } from '../attention/liveContributors';
import type { SupervisorBead } from '../supervisor/beadReads';
import { useTaskStages } from './useTaskStages';

// Shapes follow e2e/fixtures/stageBoard.ts (formulas/devwork-development.toml).
const T0 = '2026-11-15T06:00:00Z';

function task(id: string, title: string, status: SupervisorBead['status']): SupervisorBead {
  return { id, title, status, issue_type: 'task', created_at: T0, priority: 2 };
}

function root(id: string, taskId: string, extra: Partial<SupervisorBead> = {}): SupervisorBead {
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
      'gc.drain_member_id': taskId,
      'gc.var.issue': taskId,
      'gc.root_store_ref': 'city:dashport-city',
    },
  };
}

function step(
  rootId: string,
  ref: string,
  title: string,
  stage: string,
  status: SupervisorBead['status'],
): SupervisorBead {
  return {
    id: `${rootId}.${ref}`,
    title,
    status,
    issue_type: 'task',
    created_at: '2026-11-15T07:00:01Z',
    is_blocked: status !== 'in_progress',
    metadata: { 'gc.root_bead_id': rootId, 'dashboard.stage': stage },
  };
}

function wrap(snapshot: BeadSnapshot | undefined) {
  return ({ children }: { children: ReactNode }) => (
    <AttentionProvider contributors={[]} {...(snapshot ? { beadSnapshot: snapshot } : {})}>
      {children}
    </AttentionProvider>
  );
}

function stagesOf(
  items: SupervisorBead[],
  routeItems: SupervisorBead[],
  extra: Partial<BeadSnapshot> = {},
) {
  const snapshot: BeadSnapshot = {
    items,
    routeItems,
    fetchedAt: '2026-11-15T08:00:00Z',
    ...extra,
  };
  return renderHook(() => useTaskStages(), { wrapper: wrap(snapshot) }).result.current;
}

describe('useTaskStages', () => {
  it('running task is in flight with its step', () => {
    const stages = stagesOf(
      [task('dw-1', 'Вход по ссылке', 'in_progress')],
      [
        root('R1', 'dw-1', { status: 'in_progress' }),
        step('R1', 'task-review', 'Review round 1', 'review', 'in_progress'),
        step('R1', 'open-pr', 'Open the PR', 'pr', 'open'),
      ],
    );
    expect(stages.state).toBe('ready');
    expect(stages.inFlight).toEqual([
      {
        id: 'dw-1',
        title: 'Вход по ссылке',
        stage: 'review',
        stepLabel: 'Review round 1',
        href: '/runs/R1?scope_kind=city&scope_ref=dashport-city&node=R1.task-review',
      },
    ]);
    expect(stages.queued).toBe(0);
  });

  it('queued root counts as queued, not in flight', () => {
    const stages = stagesOf(
      [task('dw-2', 'Тарифы', 'open')],
      [
        root('R2', 'dw-2', { is_blocked: true }),
        step('R2', 'prepare-worktree', 'Prepare item worktree', 'working', 'open'),
      ],
    );
    expect(stages.inFlight).toEqual([]);
    expect(stages.queued).toBe(1);
  });

  it('a run that never started is never shown at a stage', () => {
    // Root open and not blocked, but no step has started: the stage board
    // places it by its frontier step; Home must not claim that stage.
    const stages = stagesOf(
      [task('dw-3', 'Ещё не начато', 'open')],
      [root('R3', 'dw-3'), step('R3', 'task-review', 'Review round 1', 'review', 'open')],
    );
    expect(stages.inFlight).toEqual([]);
    expect(stages.queued).toBe(1);
  });

  it('orphan route is counted, not named', () => {
    const stages = stagesOf(
      [],
      [
        root('R9', 'dw-elsewhere', { status: 'in_progress' }),
        step('R9', 'implement', 'Implement', 'working', 'in_progress'),
      ],
    );
    expect(stages.inFlight).toEqual([]);
    expect(stages.outsideWindow).toBe(1);
  });

  it('sorts pr, review, working, then title', () => {
    const stages = stagesOf(
      [
        task('dw-a', 'Б работа', 'in_progress'),
        task('dw-b', 'А работа', 'in_progress'),
        task('dw-c', 'Ревью', 'in_progress'),
      ],
      [
        root('Ra', 'dw-a', { status: 'in_progress' }),
        step('Ra', 'implement', 'Implement', 'working', 'in_progress'),
        root('Rb', 'dw-b', { status: 'in_progress' }),
        step('Rb', 'implement', 'Implement', 'working', 'in_progress'),
        root('Rc', 'dw-c', { status: 'in_progress' }),
        step('Rc', 'task-review', 'Review', 'review', 'in_progress'),
      ],
    );
    expect(stages.inFlight.map((t) => t.id)).toEqual(['dw-c', 'dw-b', 'dw-a']);
  });

  // Review I-1: the stage comes from the run's started steps, never from the
  // task's own in_progress status.
  it('an in-progress task whose new run has not started is queued, not at a stage', () => {
    const stages = stagesOf(
      [task('dw-4', 'Повторный запуск', 'in_progress')],
      [root('R4', 'dw-4'), step('R4', 'task-review', 'Review round 1', 'review', 'open')],
    );
    expect(stages.inFlight).toEqual([]);
    expect(stages.queued).toBe(1);
  });

  it('an in-progress task whose run ended is not shown as working', () => {
    const stages = stagesOf(
      [task('dw-5', 'Прогон кончился', 'in_progress')],
      [
        root('R5', 'dw-5', { status: 'closed' }),
        step('R5', 'implement', 'Implement', 'working', 'closed'),
      ],
    );
    expect(stages.inFlight).toEqual([]);
    expect(stages.queued).toBe(0);
  });

  it('an in-progress task with no run in a complete window is not working', () => {
    const stages = stagesOf([task('dw-6', 'Без прогона', 'in_progress')], []);
    expect(stages.inFlight).toEqual([]);
  });

  it('an in-progress task with no visible run in an incomplete window links to the bead', () => {
    const stages = stagesOf([task('dw-7', 'Окно неполное', 'in_progress')], [], {
      routesComplete: false,
    });
    expect(stages.inFlight.map((t) => [t.id, t.stage, t.href])).toEqual([
      ['dw-7', 'working', '/beads?bead=dw-7'],
    ]);
  });

  it('a stopped task is not in flight even while its run is live', () => {
    const stages = stagesOf(
      [
        task('dw-8', 'Остановлена', 'in_progress'),
        {
          ...task('dw-stop', 'stop card', 'open'),
          metadata: { 'devwork.stopped_card': 'dw-8' },
        },
      ],
      [
        root('R8', 'dw-8', { status: 'in_progress' }),
        step('R8', 'implement', 'Implement', 'working', 'in_progress'),
      ],
    );
    expect(stages.inFlight.map((t) => t.id)).not.toContain('dw-8');
  });

  it('loading while no snapshot', () => {
    const { result } = renderHook(() => useTaskStages(), { wrapper: wrap(undefined) });
    expect(result.current).toEqual({ state: 'loading', inFlight: [], queued: 0, outsideWindow: 0 });
  });

  // Review I-2: a failed board read says so instead of loading forever.
  it('unavailable when the bead list could not be read', () => {
    const snapshot: BeadSnapshot = {
      items: [],
      routeItems: [],
      fetchedAt: '2026-11-15T08:00:00Z',
      status: 'unavailable',
    };
    const { result } = renderHook(() => useTaskStages(), { wrapper: wrap(snapshot) });
    expect(result.current).toEqual({
      state: 'unavailable',
      inFlight: [],
      queued: 0,
      outsideWindow: 0,
    });
  });
});
