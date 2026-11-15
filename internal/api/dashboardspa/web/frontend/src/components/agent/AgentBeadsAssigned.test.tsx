import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { SupervisorBead } from '../../supervisor/beadReads';
import { AgentBeadsAssigned } from './AgentBeadsAssigned';

function bead(id: string, title: string, status: string): SupervisorBead {
  return { id, title, status, issue_type: 'task', created_at: '2026-11-14T00:00:00Z' };
}

const BEADS: SupervisorBead[] = [
  bead('gc-1', 'Wire the board', 'in_progress'),
  bead('gc-2', 'Write the spec', 'open'),
  bead('gc-3', 'Old migration', 'closed'),
  bead('gc-4', 'Retired probe', 'closed'),
];

describe('AgentBeadsAssigned', () => {
  afterEach(() => cleanup());

  it('lists open beads and folds closed ones behind a toggle', () => {
    const onSelect = vi.fn();
    render(<AgentBeadsAssigned beads={BEADS} error={null} loading={false} onSelect={onSelect} />);

    expect(screen.getByText('Wire the board')).toBeTruthy();
    expect(screen.getByText('Write the spec')).toBeTruthy();
    expect(screen.queryByText('Old migration')).toBeNull();
    expect(screen.queryByText('Retired probe')).toBeNull();

    // The header count is every assigned bead, closed included.
    const heading = screen.getByRole('heading', { name: /Beads assigned/ });
    expect(heading.closest('header')?.textContent).toContain('4');

    expect(screen.getByTitle('Open gc-1').textContent).toBe('Wire the board');
    expect(screen.getByTitle('Open gc-2').textContent).toBe('Write the spec');

    fireEvent.click(screen.getByRole('button', { name: 'Show 2 closed' }));
    expect(screen.getByText('Old migration')).toBeTruthy();
    expect(screen.getByText('Retired probe')).toBeTruthy();
    expect(screen.getByTitle('Open gc-3').textContent).toBe('Old migration');
    expect(screen.getByRole('button', { name: 'Hide closed' })).toBeTruthy();

    fireEvent.click(screen.getByTitle('Open gc-1'));
    expect(onSelect).toHaveBeenCalledWith(BEADS[0]);
  });
});
