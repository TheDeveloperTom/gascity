import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ALL_PROJECTS, buildBoardModel } from '../../lib/boardModel';
import type { SupervisorBead } from '../../supervisor/beadReads';
import { epicBeadsOf, useBeadLookup } from './KanbanColumn';

// vk11/card needs a card's epic by id («Один тип» on «Миграция 0425»); the
// lookup held only the column cards, so epics were never found on the live board.

function bead(id: string, extra: Partial<SupervisorBead> = {}): SupervisorBead {
  return { id, title: `bead ${id}`, status: 'open', issue_type: 'task', created_at: '2026-11-15T08:00:00Z', ...extra };
}

const EPIC = bead('dw-ep1', { title: 'Один тип пользователя', issue_type: 'epic' });
const TASK = bead('dw-t1', { title: 'Миграция 0425', parent: 'dw-ep1' } as Partial<SupervisorBead>);

describe('useBeadLookup with the epic beads', () => {
  const model = buildBoardModel(
    { items: [EPIC, TASK], routeItems: [], serviceItems: [], routesComplete: true },
    [{ name: 'devwork', prefix: 'dw' }],
    { project: ALL_PROJECTS, search: '', showTests: false },
  );

  it('epicBeadsOf keeps the epics of BoardData.items only', () => {
    expect(epicBeadsOf([EPIC, TASK]).map((b) => b.id)).toEqual(['dw-ep1']);
  });

  it('finds an epic that is not a card, and still finds the cards', () => {
    const { result } = renderHook(() => useBeadLookup(model, epicBeadsOf([EPIC, TASK])));
    expect(result.current('dw-ep1')?.title).toBe('Один тип пользователя');
    expect(result.current('dw-t1')?.title).toBe('Миграция 0425');
  });

  it('without the epics the epic is not found (the bug)', () => {
    const { result } = renderHook(() => useBeadLookup(model));
    expect(result.current('dw-ep1')).toBeUndefined();
  });
});
