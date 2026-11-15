import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BeadStatus } from 'gas-city-dashboard-shared';
import type { SupervisorBead } from '../../supervisor/beadReads';
import { renderBoard as renderSharedBoard } from '../../test/renderBoard';
import { assertAtMostOneMark } from '../../test/assertions/oneMarkRule';

const scrollIntoView = vi.fn();

beforeEach(() => {
  scrollIntoView.mockClear();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: scrollIntoView,
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

function renderBoard(
  beads: SupervisorBead[],
  selectedId: string | null = null,
  onSelect = vi.fn(),
) {
  // B5: one helper builds the board model (B4) the way the page does.
  return renderSharedBoard(beads, { selectedId, onSelect });
}

describe('BeadBoard', () => {
  it('renders every stage column as a labelled section', () => {
    renderBoard([bead('A', 'open')]);
    for (const label of ['Waiting', 'Working', 'Review', 'PR', 'Merged']) {
      expect(screen.getByRole('region', { name: label })).toBeTruthy();
    }
  });

  it('places a routeless bead under the stage its status maps to', () => {
    renderBoard([
      bead('A', 'in_progress', { title: 'live one' }),
      bead('Z', 'closed', { title: 'finished one' }),
    ]);
    const working = screen.getByRole('region', { name: 'Working' });
    expect(within(working).getByText('live one')).toBeTruthy();
    const merged = screen.getByRole('region', { name: 'Merged' });
    expect(within(merged).getByText('finished one')).toBeTruthy();
  });

  it('calls onSelect when a bead is clicked', () => {
    const { onSelect } = renderBoard([bead('A', 'open', { title: 'pick me' })]);
    fireEvent.click(screen.getByText('pick me'));
    expect(onSelect).toHaveBeenCalledWith('A');
  });

  // B6 supersedes the graph counts (BE-12): plain words, never `needs N` or `blocks M`.
  it('a card says plain words, not graph counts', () => {
    renderBoard([bead('A', 'closed'), bead('B', 'open', { needs: ['A'] })]);
    expect(screen.getByText('ready to take')).toBeTruthy();
    expect(screen.queryByText(/needs \d|blocks \d/)).toBeNull();
  });

  it('scrolls the selected bead row into view on initial deep-link selection', () => {
    renderBoard([bead('A', 'open', { title: 'deep linked bead' })], 'A');

    expect(screen.getByTitle('Select A').getAttribute('aria-pressed')).toBe('true');
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: 'center',
      inline: 'nearest',
    });
  });

  it('keeps dependency neighbourhoods row-scoped while the selected row remains clickable', () => {
    const onSelect = vi.fn();
    // A is closed (Merged); B needs A so B is ready and waits (Waiting, with a
    // `ready` mark). The board row carries only the compact neighbourhood
    // summary; the full navigable dependency tree lives in the bead detail modal.
    renderBoard([bead('A', 'closed'), bead('B', 'open', { needs: ['A'] })], 'B', onSelect);
    const waiting = screen.getByRole('region', { name: 'Waiting' });
    expect(within(waiting).getByText('ready to take')).toBeTruthy();
    expect(within(waiting).queryByTitle('Select A')).toBeNull();
    fireEvent.click(within(waiting).getByTitle('Select B'));
    expect(onSelect).toHaveBeenCalledWith('B');
  });

  it('keeps the board to at most one maroon mark', () => {
    const { container } = renderBoard([
      bead('A', 'blocked'),
      bead('B', 'in_progress'),
      bead('C', 'open'),
    ]);
    assertAtMostOneMark(container);
  });

  it('does not carry status in colour alone — stage is the heading, blocked is a word', () => {
    // Greyscale Test: the stage of a bead is readable from the column heading
    // it sits under; a blocked bead also says so in words.
    renderBoard([bead('A', 'blocked', { title: 'stuck one' })]);
    const waiting = screen.getByRole('region', { name: 'Waiting' });
    expect(within(waiting).getByText('stuck one')).toBeTruthy();
    expect(within(waiting).getByText('blocked')).toBeTruthy();
  });
});
