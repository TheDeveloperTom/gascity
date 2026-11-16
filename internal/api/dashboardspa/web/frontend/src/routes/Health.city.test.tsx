import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HealthOutputBody } from 'gas-city-dashboard-shared/gc-supervisor';
import type { SystemHealth } from 'gas-city-dashboard-shared';
import { invalidate } from '../api/cache';
import type { AttentionContributor, AttentionItem, CityReadiness } from '../attention/compose';
import { AttentionProvider } from '../attention/context';
import { createAttentionContributors } from '../attention/registry';
import { HealthPage } from './Health';

// HE-12 (OWNER-HOME-PLAN Task 10): city trouble is listed first on Health,
// in its own top-level section, and the existing sections keep their
// attention highlight.

const mockCityHealth = vi.fn<(cityName: string) => Promise<HealthOutputBody>>();

vi.mock('../supervisor/client', () => ({
  supervisorApiForRequestBudget: vi.fn(() => ({ cityHealth: mockCityHealth })),
}));

beforeEach(() => {
  invalidate('health');
  mockCityHealth.mockReset();
  mockCityHealth.mockResolvedValue({ status: 'ok', city: 'demo', version: '1', uptime_sec: 60 });
  // Every dashboard-backend read fails; the supervisor read alone gives data.
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'offline' }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        }),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function lowMemoryHealth(): SystemHealth {
  return {
    admin: {
      pid: 1,
      uptime_sec: 1,
      rss: { status: 'available', value: 1 },
      heap_used_bytes: 1,
      node_version: 'v20',
    },
    host: {
      load: { status: 'available', value: { load_avg_1: 0.1, load_avg_5: 0.1, load_avg_15: 0.1 } },
      memory: {
        status: 'available',
        value: { total_mem_bytes: 16_000_000_000, free_mem_bytes: 400_000_000 },
      },
      cpu_count: 8,
      uptime: { status: 'available', value: 1 },
    },
  };
}

function cityItem(id: string, title: string): AttentionItem {
  return { id, domain: 'runs', severity: 'watch', title, href: '/runs' };
}

function renderPage(
  extra: readonly AttentionContributor[] = [],
  options: { cityReadiness?: CityReadiness; withHealthFacts?: boolean } = {},
) {
  const contributors = [
    ...(options.withHealthFacts === false
      ? []
      : createAttentionContributors({ health: { system: lowMemoryHealth() } })),
    ...extra,
  ];
  return render(
    <MemoryRouter initialEntries={['/health']}>
      <AttentionProvider
        contributors={contributors}
        {...(options.cityReadiness ? { cityReadiness: options.cityReadiness } : {})}
      >
        <HealthPage />
      </AttentionProvider>
    </MemoryRouter>,
  );
}

describe('Health city issues', () => {
  // Owner 16.11: the page opens with the Mac's load; city trouble follows,
  // still before the city's own facts and in its own section.
  it('lists city issues before the city facts, in their own section', async () => {
    renderPage([
      { id: 'runs-test', domain: 'runs', getItems: () => [cityItem('runs:x', 'Step stalled')] },
    ]);
    const facts = await screen.findByRole('heading', { level: 2, name: 'City' });
    const city = screen.getByRole('heading', { level: 2, name: 'City issues' });
    expect(city.compareDocumentPosition(facts) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('Step stalled')).toBeTruthy();
    expect(city.closest('section')!.contains(facts)).toBe(false);
  });

  it('host pressure from the attention model still reads in City issues', async () => {
    renderPage();
    await screen.findByRole('heading', { level: 2, name: 'City' });
    const city = screen.getByRole('heading', { level: 2, name: 'City issues' }).closest('section')!;
    expect(city.textContent).toContain('Host memory critical');
  });

  // Review I-1: a cold load of /health is not an all-clear.
  it('while the city reads load, City issues is not an all-clear', async () => {
    renderPage([], { cityReadiness: { state: 'loading' }, withHealthFacts: false });
    await screen.findByRole('heading', { level: 2, name: 'City' });
    expect(screen.queryByText('No city issues')).toBeNull();
    expect(screen.getByText('Reading the state of the city…')).toBeTruthy();
  });
});
