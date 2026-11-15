import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BeadsPage } from './Beads';
import { invalidate } from '../api/cache';
import { setActiveCity } from '../api/cityBase';
import { AttentionProvider } from '../attention/context';
import type { AttentionContributor, AttentionItem } from '../attention/compose';
import { NowProvider } from '../contexts/NowContext';
import { OperatorConfigProvider } from '../contexts/OperatorConfigContext';

// Task 11: the Beads "Needs you" panel reads the owner slice. City items (a
// stalled step, an unclaimed ready task) are counted in one line that links
// to Health, where they are listed.

const DECISION: AttentionItem = {
  id: 'beads:decision:dw-d1',
  audience: 'owner',
  domain: 'beads',
  severity: 'attention',
  title: 'Choose the mailbox window',
  href: '/beads?bead=dw-d1',
};
const STALLED: AttentionItem = {
  id: 'beads:stalled:gcg-9',
  domain: 'beads',
  severity: 'attention',
  title: 'Stalled step under Ship the board',
  href: '/beads?bead=gcg-9',
};

function contributor(items: AttentionItem[]): AttentionContributor {
  return { id: 'beads:test', domain: 'beads', getItems: () => items };
}

function json(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  setActiveCity('test-city');
  invalidate('beads:board:');
  invalidate('rigs');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(
        input instanceof Request ? input.url : String(input),
        window.location.origin,
      );
      if (url.pathname === '/v0/city/test-city/rigs') return json({ items: [], total: 0 });
      return json({ items: [], total: 0 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPage(items: AttentionItem[]) {
  return render(
    <MemoryRouter initialEntries={['/beads']}>
      <NowProvider intervalMs={1_000_000}>
        <OperatorConfigProvider
          operator={{ operatorAlias: 'owner', operatorWireAlias: 'human', decisionLabel: 'x' }}
        >
          <AttentionProvider contributors={[contributor(items)]}>
            <BeadsPage />
          </AttentionProvider>
        </OperatorConfigProvider>
      </NowProvider>
    </MemoryRouter>,
  );
}

describe('BeadsPage Needs you (owner slice)', () => {
  it('stalled steps are not in the Beads Needs-you panel', async () => {
    renderPage([DECISION, STALLED]);
    const panel = await screen.findByRole('region', { name: /Needs you/ });
    expect(within(panel).queryByText('Stalled step under Ship the board')).toBeNull();
    const link = screen.getByRole('link', { name: '1 task issue is on Health' });
    expect(link.getAttribute('href')).toBe('/health');
  });

  it('decision bead is', async () => {
    renderPage([DECISION, STALLED]);
    const panel = await screen.findByRole('region', { name: /Needs you/ });
    expect(within(panel).getByText('Choose the mailbox window')).toBeTruthy();
  });

  it('no panel when only city items exist', async () => {
    renderPage([STALLED]);
    await screen.findByRole('link', { name: '1 task issue is on Health' });
    expect(screen.queryByRole('region', { name: /Needs you/ })).toBeNull();
  });
});
