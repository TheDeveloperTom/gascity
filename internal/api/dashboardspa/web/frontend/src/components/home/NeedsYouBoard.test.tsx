import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { AttentionItem, AttentionOverflowGroup } from '../../attention/compose';
import { NeedsYouBoard } from './NeedsYouBoard';

function renderBoard(
  items: readonly AttentionItem[],
  overflow: readonly AttentionOverflowGroup[] = [],
) {
  return render(
    <MemoryRouter>
      <NeedsYouBoard items={items} overflow={overflow} />
    </MemoryRouter>,
  );
}

const itemA: AttentionItem = {
  id: 'a',
  domain: 'beads',
  severity: 'attention',
  title: 'dw-0ia4 stalled',
  summary: 'stalled 1h, no assignee',
  href: '/beads?bead=x',
};

const itemB: AttentionItem = {
  id: 'b',
  domain: 'health',
  severity: 'watch',
  title: 'Host load high',
};

describe('NeedsYouBoard', () => {
  afterEach(() => cleanup());

  it('empty: clear signal', () => {
    const { container } = renderBoard([]);
    expect(screen.getByRole('heading', { name: 'Nothing needs you right now.' })).toBeTruthy();
    expect(container.querySelector('section[data-signal="clear"]')).not.toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('headline counts only attention; watch gets its own quiet count', () => {
    const { container } = renderBoard([itemA, itemB]);
    expect(screen.getByRole('heading', { name: '1 thing needs you' })).toBeTruthy();
    expect(screen.getByText('1 to watch')).toBeTruthy();
    expect(container.querySelector('section')?.getAttribute('data-signal')).toBe('attention');
    const links = screen.getAllByRole('link', { name: 'Open' });
    expect(links).toHaveLength(1);
    const open = links[0]!;
    expect(open.getAttribute('href')).toBe('/beads?bead=x');
    expect(open).toHaveProperty('textContent', 'Open');
    const describedBy = open.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy ?? '')?.textContent).toBe('dw-0ia4 stalled');
    const rowB = screen.getByText('Host load high').closest('li');
    expect(rowB).not.toBeNull();
    expect(within(rowB as HTMLElement).queryAllByRole('link')).toHaveLength(0);
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('singular', () => {
    renderBoard([itemA]);
    expect(screen.getByRole('heading', { name: '1 thing needs you' })).toBeTruthy();
    expect(screen.queryByText(/to watch$/)).toBeNull();
  });

  it('watch only: nothing needs you, amber band, quiet watch count', () => {
    const { container } = renderBoard(
      [itemB],
      [{ domain: 'mail', total: 2, attention: 0, watch: 2, unavailable: 0 }],
    );
    expect(screen.getByRole('heading', { name: 'Nothing needs you right now.' })).toBeTruthy();
    expect(container.querySelector('section')?.getAttribute('data-signal')).toBe('watch');
    expect(screen.getByText('3 to watch')).toBeTruthy();
  });

  it('overflow attention counts in the headline', () => {
    renderBoard([itemA], [{ domain: 'beads', total: 52, attention: 52, watch: 0, unavailable: 0 }]);
    expect(screen.getByRole('heading', { name: '53 things need you' })).toBeTruthy();
  });

  it('unavailable never counts', () => {
    const { container } = renderBoard([
      { id: 'u', domain: 'runs', severity: 'unavailable', title: 'Run states unavailable' },
    ]);
    expect(screen.getByRole('heading', { name: 'Nothing needs you right now.' })).toBeTruthy();
    expect(container.querySelector('section')?.getAttribute('data-signal')).toBe('clear');
    const row = screen.getByText('Run states unavailable').closest('li') as HTMLElement;
    expect(row).not.toBeNull();
    const pill = row.querySelector('.rounded-full');
    expect(pill).not.toBeNull();
    expect(pill?.className).toContain('text-fg-muted');
    expect(pill?.className).not.toMatch(/text-(accent|warn|ok)\b/);
  });

  it('overflow', () => {
    renderBoard([itemA], [{ domain: 'beads', total: 52, attention: 52, watch: 0, unavailable: 0 }]);
    const link = screen.getByRole('link', { name: '52 in Beads' });
    expect(link.getAttribute('href')).toBe('/beads');
    expect(link.closest('p')?.textContent?.startsWith('More:')).toBe(true);
  });
});
