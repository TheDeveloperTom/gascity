import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FoldList } from './FoldList';

function items(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `item-${i + 1}`);
}

function renderFold(list: string[], limit: number, showLabel?: (total: number) => string) {
  return render(
    <FoldList
      items={list}
      limit={limit}
      itemKey={(item) => item}
      renderItem={(item) => <li>{item}</li>}
      {...(showLabel === undefined ? {} : { showLabel })}
    />,
  );
}

describe('FoldList', () => {
  afterEach(() => cleanup());

  it('shows the first `limit` items and unfolds the rest on demand', () => {
    renderFold(items(7), 5);
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    const toggle = screen.getByRole('button', { name: 'Show all 7' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(toggle);
    expect(screen.getAllByRole('listitem')).toHaveLength(7);
    const fewer = screen.getByRole('button', { name: 'Show fewer' });
    expect(fewer.getAttribute('aria-expanded')).toBe('true');
  });

  it('has no toggle when everything fits', () => {
    renderFold(items(3), 5);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('limit 0 folds everything behind a custom label', () => {
    renderFold(items(3), 0, (n) => `Show ${n} closed`);
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Show 3 closed' })).toBeTruthy();
  });

  it('renders nothing for an empty list', () => {
    const { container } = renderFold([], 5);
    expect(container.firstChild).toBeNull();
  });
});
