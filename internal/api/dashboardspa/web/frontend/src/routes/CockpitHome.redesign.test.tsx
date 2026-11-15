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
