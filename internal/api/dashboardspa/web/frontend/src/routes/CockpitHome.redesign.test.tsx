import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { RunSummarySubscription } from '../runs/runSummarySubscription';
import { invalidate } from '../api/cache';
import { CockpitHomePage } from './CockpitHome';

// DESIGN-PLAN §6.2 and ruling C2: the "Some readings are unavailable" line is
// a live status line, so assistive tech hears it when readings drop out.

const mocks = vi.hoisted(() => ({
  cityUsage: vi.fn(),
  cityStatus: vi.fn(),
  runCensus: vi.fn(),
  listSessions: vi.fn(),
}));

vi.mock('../supervisor/client', () => ({
  SUPERVISOR_REQUEST_TIMEOUT_MS: 60_000,
  supervisorApi: () => ({
    cityUsage: mocks.cityUsage,
    cityStatus: mocks.cityStatus,
    runCensus: mocks.runCensus,
    listSessions: mocks.listSessions,
  }),
}));

vi.mock('../runs/runSummarySubscription', () => ({
  useRunSummary: () =>
    ({
      loading: false,
      error: null,
      refresh: vi.fn(),
      sseState: 'open',
      source: { source: 'runs', status: 'error', error: 'down' },
    }) as unknown as RunSummarySubscription,
}));

// vk lane 3: the needs shelves read the board; this test covers the readings
// line, so the board read stays out (CockpitHome.owner covers needs).
vi.mock('../lib/needsFromMe', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/needsFromMe')>()),
  useNeedsModel: () => ({ state: 'ready', needs: [], stalls: [], quiet: [], count: 0 }),
}));

describe('<CockpitHomePage> readings line', () => {
  beforeEach(() => {
    invalidate('cockpit:');
    const down = new Error('down');
    mocks.cityUsage.mockReset().mockRejectedValue(down);
    mocks.cityStatus.mockReset().mockRejectedValue(down);
    mocks.runCensus.mockReset().mockRejectedValue(down);
    mocks.listSessions.mockReset().mockRejectedValue(down);
  });

  afterEach(() => cleanup());

  // Final review Minor 1: one usage note was repeated five times on Home. It
  // now shows once under Right now (the odometer, pinned) and once under
  // Usage; the rate dials carry only their window basis.
  it('shows the usage note at most twice', async () => {
    const totals = {
      invocations: 4,
      compute_facts: 0,
      input_tokens: 100,
      output_tokens: 50,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
      wall_seconds: 0,
      cost_usd_estimate: 1,
      unpriced: 0,
    };
    mocks.cityUsage.mockReset().mockResolvedValue({
      available: true,
      recording: true,
      source: 'local_estimate',
      today: totals,
      last_24h: { ...totals, unpriced: 3 },
      recent: totals,
      recent_by_session: [],
      recent_window_secs: 300,
      updated_at: '2026-07-14T12:00:00Z',
    });
    render(
      <MemoryRouter>
        <CockpitHomePage />
      </MemoryRouter>,
    );
    await screen.findByRole('status', { name: 'model calls today: 4' });
    const hits = screen.getAllByText(/cost excludes unpriced model calls/);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits.length).toBeLessThanOrEqual(2);
  });

  it('announces unavailable readings as a status line', async () => {
    render(
      <MemoryRouter>
        <CockpitHomePage />
      </MemoryRouter>,
    );
    const line = await screen.findByText(/^Some readings are unavailable: /);
    expect(line.closest('[role="status"]')).not.toBeNull();
  });
});
