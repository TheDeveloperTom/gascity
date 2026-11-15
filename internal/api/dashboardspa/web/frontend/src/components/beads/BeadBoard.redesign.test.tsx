import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BeadStatus } from 'gas-city-dashboard-shared';
import type { SupervisorBead } from '../../supervisor/beadReads';
import { buildBeadGraph } from '../../lib/beadGraph';
import { buildRouteIndex, buildStageColumns } from '../../lib/stageBoard';
import { assertAtMostOneMark } from '../../test/assertions/oneMarkRule';
import { BeadBoard } from './BeadBoard';

// Redesign (Signal & Pavement, Task 7): board columns are panels whose body
// scrolls inside a fixed height, so a 1,000-bead column no longer makes the
// page 75,000 px tall. An empty column says "None" instead of a lone dot.

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => cleanup());

function bead(id: string, status: BeadStatus, extra: Partial<SupervisorBead> = {}): SupervisorBead {
  return {
    id,
    title: `bead ${id}`,
    status,
    issue_type: 'task',
    created_at: '2026-05-01T00:00:00Z',
    ...extra,
  };
}

function renderBoard(beads: SupervisorBead[]) {
  const graph = buildBeadGraph(beads);
  const columns = buildStageColumns(graph.nodes.values(), buildRouteIndex([]), new Map());
  return render(
    <MemoryRouter>
      <BeadBoard columns={columns} selectedId={null} onSelect={vi.fn()} />
    </MemoryRouter>,
  );
}

describe('BeadBoard redesign', () => {
  it('empty columns say None', () => {
    // Open beads with no route wait, so "Review" is empty.
    const { container } = renderBoard([
      bead('A', 'open', { needs: ['GHOST'] }),
      bead('B', 'open', { needs: ['GHOST'] }),
    ]);
    const review = screen.getByRole('region', { name: 'Review' });
    expect(within(review).getByText('None')).toBeTruthy();
    const loneDots = Array.from(container.querySelectorAll('*')).filter(
      (el) => el.children.length === 0 && el.textContent?.trim() === '·',
    );
    expect(loneDots).toHaveLength(0);
  });

  // Final review Minor 4: twelve "None" boxes were empty structure. An empty
  // column is its header strip at every width; screen readers still hear None.
  it('an empty column collapses to its header at every width', () => {
    renderBoard([bead('A', 'open')]);
    const merged = screen.getByRole('region', { name: 'Merged' });
    const none = within(merged).getByText('None');
    expect(none.classList.contains('sr-only')).toBe(true);
    expect(none.className).not.toMatch(/\bsm:block\b/);
    expect(merged.querySelector('header')?.className).not.toMatch(/border-b/);
  });

  it('columns scroll inside', () => {
    const { container } = renderBoard([
      bead('A', 'open', { needs: ['B'] }),
      bead('B', 'in_progress'),
      bead('C', 'blocked'),
      bead('D', 'closed'),
      bead('E', 'open'),
    ]);
    // Stage board: A, C, E wait; B works; D merged → three non-empty columns.
    const lists = container.querySelectorAll('section ul');
    expect(lists.length).toBe(3);
    for (const list of lists) {
      expect(list.classList.contains('max-h-[28rem]')).toBe(true);
      expect(list.classList.contains('overflow-y-auto')).toBe(true);
    }
  });

  // Stage board (2026-11-15) supersedes the red blocked count: there is no
  // blocked column any more. Blocked is an amber word on the card; the board
  // paints no red text at all, so it stays within the One Mark Rule.
  it('one red mark at most; blocked is an amber word', () => {
    const { container } = renderBoard([bead('A', 'blocked'), bead('B', 'open')]);
    assertAtMostOneMark(container);
    const waiting = screen.getByRole('region', { name: 'Waiting' });
    expect(waiting.querySelectorAll('.text-accent')).toHaveLength(0);
    expect(within(waiting).getByText('blocked').closest('.text-warn')).not.toBeNull();
  });

  it('shows the bead id as a copyable id tag', () => {
    renderBoard([bead('work-1', 'open')]);
    const id = screen.getByText('work-1', { exact: true });
    expect(id.classList.contains('font-mono')).toBe(true);
    expect(screen.getByTitle('Select work-1').getAttribute('aria-pressed')).toBe('false');
  });
});
