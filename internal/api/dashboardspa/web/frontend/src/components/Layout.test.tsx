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
  it('/ and /beads are wide, /runs keeps max-w-dashboard', () => {
    for (const path of ['/', '/beads']) {
      const cls = measureOf(path);
      expect(cls, path).toContain('max-w-[120rem]');
      expect(cls, path).not.toContain('max-w-dashboard');
      cleanup();
    }
    for (const path of ['/runs', '/health', '/agents']) {
      const cls = measureOf(path);
      expect(cls, path).toContain('max-w-dashboard');
      cleanup();
    }
  });
});
