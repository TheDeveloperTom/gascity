import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostHistory } from 'gas-city-dashboard-shared';
import { useLiveHealth } from './useLiveHealth';
import { resetLiveHistory } from '../lib/hostLive';
import { liveFixture } from '../test/fixtures/liveHealth';

// Owner 16.11: the charts show the last 30 minutes the moment the page opens,
// seeded from the engine's background history (GET /api/health/history).

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function historyPoint(iso: string, busy: number): HostHistory['points'][number] {
  const { processes: _processes, ...host } = liveFixture({ sampled_at: iso });
  return { ...host, cpu: { ...host.cpu, busy_pct: { status: 'available', value: busy } } };
}

let historyResponse: () => Response;

beforeEach(() => {
  resetLiveHistory();
  historyResponse = () =>
    json({
      interval_ms: 5000,
      window_ms: 1_800_000,
      points: [historyPoint('2026-11-16T09:40:00Z', 12), historyPoint('2026-11-16T09:50:00Z', 64)],
    } satisfies HostHistory);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/health/history') return historyResponse();
      if (url === '/api/health/live') return json(liveFixture());
      return new Response(JSON.stringify({ error: `unexpected ${url}` }), { status: 404 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('useLiveHealth', () => {
  it('seeds the history from the server on first load, then keeps the live polls', async () => {
    const { result } = renderHook(() => useLiveHealth());
    await waitFor(() => expect(result.current.history).toHaveLength(3));
    expect(result.current.history.map((s) => s.busyPct)).toEqual([12, 64, 31]);
    expect(result.current.history[0]?.at).toBe(Date.parse('2026-11-16T09:40:00Z'));
  });

  it('still draws the live polls when the server history is unavailable', async () => {
    historyResponse = () => new Response(JSON.stringify({ error: 'down' }), { status: 503 });
    const { result } = renderHook(() => useLiveHealth());
    await waitFor(() => expect(result.current.latest).not.toBeNull());
    expect(result.current.history.map((s) => s.busyPct)).toEqual([31]);
    expect(result.current.error).toBeNull();
  });
});
