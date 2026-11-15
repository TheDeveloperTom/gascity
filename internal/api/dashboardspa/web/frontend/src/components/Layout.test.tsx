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
  it('/beads is wide, / keeps a centred reading measure, /runs keeps max-w-dashboard', () => {
    const board = measureOf('/beads');
    expect(board).toContain('max-w-[120rem]');
    expect(board).not.toContain('max-w-dashboard');
    cleanup();
    const home = measureOf('/');
    expect(home).toContain('max-w-[64rem]');
    expect(home).toContain('mx-auto');
    cleanup();
    for (const path of ['/runs', '/health', '/agents']) {
      const cls = measureOf(path);
      expect(cls, path).toContain('max-w-dashboard');
      cleanup();
    }
  });
});
