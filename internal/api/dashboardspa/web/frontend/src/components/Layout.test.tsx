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
  // Owner 16.11 (2000 px: a centred ~1440 px strip, ~300 px empty each side):
  // every main page uses the full available width; the main keeps its padding.
  it('the page wrapper has no max-width cap on any main page', () => {
    for (const path of ['/', '/beads', '/health', '/runs', '/agents', '/mail', '/city/devwork-platform/beads']) {
      const cls = measureOf(path);
      expect(cls, path).not.toMatch(/(^|\s)(\w+:)?max-w-/);
      expect(cls, path).not.toContain('mx-auto');
      expect(cls, path).toContain('w-full');
      cleanup();
    }
  });
});
