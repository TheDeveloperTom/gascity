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

function stagesOf(items: SupervisorBead[], routeItems: SupervisorBead[]) {
  const snapshot = { items, routeItems, fetchedAt: '2026-11-15T08:00:00Z' };
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
      [
        root('R3', 'dw-3'),
        step('R3', 'task-review', 'Review round 1', 'review', 'open'),
      ],
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
        root('Rc', 'dw-c', { status: 'in_progress' }),
        step('Rc', 'task-review', 'Review', 'review', 'in_progress'),
      ],
    );
    expect(stages.inFlight.map((t) => t.id)).toEqual(['dw-c', 'dw-b', 'dw-a']);
    expect(stages.inFlight[1]?.href).toBe('/beads?bead=dw-b');
  });

  it('loading while no snapshot', () => {
    const { result } = renderHook(() => useTaskStages(), { wrapper: wrap(undefined) });
    expect(result.current).toEqual({ state: 'loading', inFlight: [], queued: 0, outsideWindow: 0 });
  });
});
