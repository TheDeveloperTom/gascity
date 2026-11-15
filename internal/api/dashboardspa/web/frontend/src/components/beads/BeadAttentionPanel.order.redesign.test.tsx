import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AttentionItem } from '../../attention/compose';
import { BeadAttentionPanel } from './BeadAttentionPanel';

// Final review I-1 and I-2: the fold must lead with the red rows (the
// per-domain list arrives in contributor order, not severity order), and
// "Needs you (N)" counts only what needs the owner; watch items get their
// own quiet count, as on the Home board (ruling C1).

afterEach(() => cleanup());

function row(i: number, severity: AttentionItem['severity']): AttentionItem {
  return {
    id: `beads:B-${i}:${severity}`,
    domain: 'beads',
    severity,
    title: `B-${i} ${severity}`,
    href: `/beads?bead=B-${i}`,
  };
}

describe('BeadAttentionPanel order and counts', () => {
  it('attention rows lead the fold', () => {
    const items = [
      row(0, 'watch'),
      row(1, 'watch'),
      row(2, 'watch'),
      row(3, 'watch'),
      row(4, 'attention'),
      row(5, 'watch'),
      row(6, 'attention'),
    ];
    render(<BeadAttentionPanel items={items} onOpen={vi.fn()} />);
    const titles = screen.getAllByRole('listitem').map((li) => li.textContent ?? '');
    expect(titles).toHaveLength(5);
    expect(titles[0]).toContain('B-4 attention');
    expect(titles[1]).toContain('B-6 attention');
    // Stable within a tier: the watch rows keep their incoming order.
    expect(titles[2]).toContain('B-0 watch');
    expect(titles[4]).toContain('B-2 watch');
  });

  it('counts attention in the heading and watch quietly beside it', () => {
    render(
      <BeadAttentionPanel
        items={[row(0, 'watch'), row(1, 'attention'), row(2, 'watch')]}
        onOpen={vi.fn()}
      />,
    );
    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading.textContent).toBe('Needs you (1)');
    expect(screen.getByText('2 to watch')).toBeTruthy();
  });
});
