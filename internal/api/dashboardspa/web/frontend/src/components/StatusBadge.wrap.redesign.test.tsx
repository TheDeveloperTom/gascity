import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { StatusBadge } from './StatusBadge';

// Sentence-length notices (the mail prompt-injection notice, compose warnings)
// must wrap instead of truncating. `wrap` is the badge's own option, so call
// sites no longer reach into its children with arbitrary selectors.

afterEach(() => cleanup());

describe('StatusBadge wrap', () => {
  it('truncates its label by default', () => {
    const { container } = render(<StatusBadge tone="warn" label="Short" />);
    const label = container.querySelector('span > span:last-child') as HTMLElement;
    expect(label.className).toContain('truncate');
  });

  it('wraps the label and top-aligns the shape when wrap is set', () => {
    const { container } = render(
      <StatusBadge tone="warn" variant="inline" wrap label="A sentence that must wrap" />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('items-start');
    expect(root.className).not.toMatch(/\bitems-center\b/);
    const label = root.querySelector(':scope > span:last-child') as HTMLElement;
    expect(label.textContent).toBe('A sentence that must wrap');
    expect(label.className).not.toContain('truncate');
    expect(label.className).toContain('whitespace-normal');
    expect(root.querySelector(':scope > svg')?.getAttribute('class') ?? '').toContain('mt-');
  });
});
