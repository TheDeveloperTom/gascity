import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { setLocale } from '../i18n';
import { NavAttentionIndicator } from './NavAttentionIndicator';

// Task 9 (supersedes final review I-2's attention/watch split): a red pill
// counts what waits for the owner; the city's trouble is one amber count.

afterEach(() => {
  cleanup();
  setLocale('en');
});

describe('NavAttentionIndicator', () => {
  it('shows owner and city as two numbers', () => {
    render(<NavAttentionIndicator label="Health" ownerCount={2} cityCount={1} />);
    const red = screen.getByLabelText('Health: 2 attention items');
    expect(red.textContent).toBe('2');
    expect(red.className).toContain('bg-accent');
    const amber = screen.getByLabelText('Health: 1 city issue');
    expect(amber.textContent).toBe('1');
    expect(amber.className).toContain('bg-warn');
  });

  it('city only: one amber pill', () => {
    render(<NavAttentionIndicator label="Health" ownerCount={0} cityCount={3} />);
    expect(screen.getByLabelText('Health: 3 city issues').className).toContain('bg-warn');
    expect(screen.queryByLabelText(/attention/)).toBeNull();
  });

  it('nothing: no pill', () => {
    const { container } = render(<NavAttentionIndicator label="Mail" ownerCount={0} />);
    expect(container.textContent).toBe('');
  });

  it('Russian aria', () => {
    setLocale('ru');
    render(<NavAttentionIndicator label="Mail" ownerCount={5} />);
    expect(screen.getByLabelText('Почта: 5 дел ждут вас').textContent).toBe('5');
  });
});
