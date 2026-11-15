import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { collectMissing, resetMissing, setLocale } from '../i18n';
import { PageHeader } from './PageHeader';

// Task 9: every page title is in the owner's words. PageHeader translates a
// title that has a Russian entry and leaves names (an agent, a run id) alone
// without recording them as missing.
describe('PageHeader title locale', () => {
  afterEach(() => {
    cleanup();
    setLocale('en');
    resetMissing();
  });

  it('English stays English', () => {
    render(<PageHeader title="Runs" />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Runs');
  });

  it('a known title reads Russian', () => {
    setLocale('ru');
    render(<PageHeader title="Beads" />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Задачи');
  });

  it('a name is left alone and not recorded missing', () => {
    setLocale('ru');
    resetMissing();
    render(<PageHeader title="mayor-7" />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('mayor-7');
    expect(collectMissing()).not.toContain('mayor-7');
  });
});
