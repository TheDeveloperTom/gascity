import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BeadsPage } from './Beads';
import { invalidate } from '../api/cache';
import { setActiveCity } from '../api/cityBase';
import { AttentionProvider } from '../attention/context';
import type { AttentionContributor, AttentionItem } from '../attention/compose';
import { NowProvider } from '../contexts/NowContext';
import { OperatorConfigProvider } from '../contexts/OperatorConfigContext';

// Task 11 + vk-final: owner items live in «Нужно от меня» (top bar badge),
// so the board shows no Needs-you plate. City items (a stalled step, an
// unclaimed ready task) are counted in one line that links to Health.

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
    <MemoryRouter initialEntries={[allProjects('/beads')]}>
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

describe('BeadsPage owner slice (vk-final: no Needs-you plate on the board)', () => {
  it('an owner decision does not render the old «Вас ждёт» plate on the board', async () => {
    renderPage([DECISION, STALLED]);
    await screen.findByRole('link', { name: '1 task issue is on Health' });
    expect(screen.queryByRole('region', { name: /Needs you/ })).toBeNull();
    expect(screen.queryByText('Choose the mailbox window')).toBeNull();
  });

  it('city items still count in one line that links to Health', async () => {
    renderPage([DECISION, STALLED]);
    const link = await screen.findByRole('link', { name: '1 task issue is on Health' });
    expect(link.getAttribute('href')).toBe('/health');
  });
});

// VK 1:1 (16.11): the board opens on the devwork product; these tests read the
// whole board, so they ask for every project unless the entry names one.
function allProjects(entry: string): string {
  if (/[?&]project=/.test(entry)) return entry;
  return `${entry}${entry.includes('?') ? '&' : '?'}project=all`;
}
