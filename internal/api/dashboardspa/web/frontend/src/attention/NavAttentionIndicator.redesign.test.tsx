import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { AttentionDomainSummary } from './compose';
import { NavAttentionIndicator } from './NavAttentionIndicator';

// Final review I-2: a red pill counts only what needs the owner; watch items
// get their own amber pill, so the red numbers add up to the Home board.

afterEach(() => cleanup());

function summary(attention: number, watch: number): AttentionDomainSummary {
  return {
    domain: 'runs',
    attention,
    watch,
    unavailable: 0,
    severity: attention > 0 ? 'attention' : watch > 0 ? 'watch' : null,
    items: [],
  };
}

describe('NavAttentionIndicator', () => {
  it('shows attention and watch as two numbers', () => {
    render(<NavAttentionIndicator label="Runs" summary={summary(2, 1)} />);
    const red = screen.getByLabelText('Runs: 2 attention items');
    expect(red.textContent).toBe('2');
    expect(red.className).toContain('bg-accent');
    const amber = screen.getByLabelText('Runs: 1 watch item');
    expect(amber.textContent).toBe('1');
    expect(amber.className).toContain('bg-warn');
  });

  it('watch only: one amber pill', () => {
    render(<NavAttentionIndicator label="Mail" summary={summary(0, 3)} />);
    expect(screen.getByLabelText('Mail: 3 watch items').className).toContain('bg-warn');
    expect(screen.queryByLabelText(/attention/)).toBeNull();
  });

  it('nothing: no pill', () => {
    const { container } = render(<NavAttentionIndicator label="Mail" summary={summary(0, 0)} />);
    expect(container.textContent).toBe('');
  });
});
