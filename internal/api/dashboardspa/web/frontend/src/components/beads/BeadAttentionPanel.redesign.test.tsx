import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AttentionItem } from '../../attention/compose';
import { BeadAttentionPanel } from './BeadAttentionPanel';

// Redesign (Signal & Pavement, Task 7): the Needs-you list folds after five
// rows ("Show all N"), so 57 escalations no longer push the board off the page.

afterEach(() => cleanup());

function items(n: number): AttentionItem[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `beads:B-${i}:stalled`,
    domain: 'beads',
    severity: i === 0 ? 'attention' : 'watch',
    title: `B-${i} stalled`,
    href: `/beads?bead=B-${i}`,
  }));
}

describe('BeadAttentionPanel redesign', () => {
  it('shows the first five rows and a Show all toggle', () => {
    render(<BeadAttentionPanel items={items(7)} onOpen={vi.fn()} />);
    expect(screen.getByText('Needs you').textContent).toContain('(7)');
    expect(screen.getAllByRole('button', { name: 'Open' })).toHaveLength(5);
    const toggle = screen.getByRole('button', { name: 'Show all 7' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(toggle);
    expect(screen.getAllByRole('button', { name: 'Open' })).toHaveLength(7);
    const fewer = screen.getByRole('button', { name: 'Show fewer' });
    expect(fewer.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(fewer);
    expect(screen.getAllByRole('button', { name: 'Open' })).toHaveLength(5);
  });

  it('offers no toggle at five rows or fewer', () => {
    render(<BeadAttentionPanel items={items(5)} onOpen={vi.fn()} />);
    expect(screen.getAllByRole('button', { name: 'Open' })).toHaveLength(5);
    expect(screen.queryByRole('button', { name: /^Show/ })).toBeNull();
  });

  it('opens a folded row once revealed', () => {
    const onOpen = vi.fn();
    render(<BeadAttentionPanel items={items(6)} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show all 6' }));
    const open = screen.getAllByRole('button', { name: 'Open' });
    fireEvent.click(open[5] as HTMLElement);
    expect(onOpen).toHaveBeenCalledWith('B-5');
  });
});
