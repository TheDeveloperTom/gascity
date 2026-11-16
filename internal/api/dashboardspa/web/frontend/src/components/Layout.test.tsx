import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Layout } from './Layout';

vi.mock('./Header', () => ({ Header: () => <nav aria-label="rail" /> }));

afterEach(cleanup);

function measureOf(path: string): string {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Layout>
        <p>page</p>
      </Layout>
    </MemoryRouter>,
  );
  const wrapper = screen.getByText('page').parentElement;
  return wrapper?.className ?? '';
}

describe('Layout', () => {
  // polish2 16.11 (owner, 2000 px): «Нужно от меня» uses the width on wide screens.
  it('/beads is wide, / is centred and up to 1600 px, /runs keeps max-w-dashboard', () => {
    const board = measureOf('/beads');
    expect(board).toContain('max-w-[120rem]');
    expect(board).not.toContain('max-w-dashboard');
    cleanup();
    const home = measureOf('/');
    expect(home).toContain('max-w-[100rem]');
    expect(home).toContain('mx-auto');
    cleanup();
    // Owner 16.11: Health is full width (charts of the Mac's load).
    const health = measureOf('/health');
    expect(health).toContain('max-w-[120rem]');
    expect(health).not.toContain('max-w-dashboard');
    cleanup();
    for (const path of ['/runs', '/agents']) {
      const cls = measureOf(path);
      expect(cls, path).toContain('max-w-dashboard');
      cleanup();
    }
  });
});
