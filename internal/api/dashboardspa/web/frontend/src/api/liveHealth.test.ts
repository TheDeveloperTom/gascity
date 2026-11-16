import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './client';
import { liveFixture } from '../test/fixtures/liveHealth';

function stubJson(body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('api.liveHealth', () => {
  it('reads GET /api/health/live', async () => {
    stubJson(liveFixture());
    await expect(api.liveHealth()).resolves.toEqual(liveFixture());
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe('/api/health/live');
  });

  it('accepts a process list refused to a non-loopback caller', async () => {
    const body = liveFixture({
      processes: {
        status: 'unavailable',
        reason: 'not_loopback',
        total: 0,
        items: [],
        rest: { count: 0, cpu_pct: 0, rss_bytes: 0 },
      },
    });
    stubJson(body);
    await expect(api.liveHealth()).resolves.toEqual(body);
  });

  it('rejects a process row without a numeric cpu_pct', async () => {
    const body = liveFixture();
    (body.processes.items as unknown[]).push({ name: 'claude', count: 1, rss_bytes: 1 });
    stubJson(body);
    await expect(api.liveHealth()).rejects.toThrow(/cpu_pct/);
  });

  it('rejects a body without the cpu block', async () => {
    const { cpu: _cpu, ...rest } = liveFixture();
    stubJson(rest);
    await expect(api.liveHealth()).rejects.toThrow(/cpu/);
  });
});
