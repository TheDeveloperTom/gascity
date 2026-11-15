import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentsPage } from './Agents';
import { invalidate } from '../api/cache';
import { setActiveCity } from '../api/cityBase';
import { NowProvider } from '../contexts/NowContext';
import { resetSupervisorApiForTests } from '../supervisor/client';

// Task 11: the Agents "Needs you" section holds only what waits for the owner
// (an agent awaiting his input, rule O3). Errored, rate-limited and stalled
// agents keep their table rows and tint, and appear on Health.

function json(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  setActiveCity('test-city');
  invalidate('agents');
  invalidate('sessions');
  invalidate('beads:in-flight');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const raw = input instanceof Request ? input.url : String(input);
      const url = new URL(raw, window.location.origin);
      const path = url.pathname;
      if (path === '/v0/city/test-city/agents') {
        return json({
          items: [
            {
              name: 'mayor',
              available: true,
              running: true,
              suspended: false,
              state: 'idle',
              session: { name: 'mayor', attached: true, last_activity: '2026-05-30T00:56:31Z' },
            },
            {
              name: 'broken-worker',
              available: true,
              running: true,
              suspended: false,
              state: 'errored',
              session: {
                name: 'broken-worker',
                attached: true,
                last_activity: '2026-05-30T00:56:31Z',
              },
            },
          ],
          total: 2,
        });
      }
      if (path === '/v0/city/test-city/sessions') {
        return json({
          items: [
            {
              id: 'gc-2568',
              session_name: 'mayor',
              state: 'active',
              template: 'mayor',
              alias: 'mayor',
              running: true,
              attached: true,
              created_at: '2026-05-30T00:00:00Z',
              title: 'mayor',
            },
          ],
          total: 1,
        });
      }
      if (path === '/v0/city/test-city/session/gc-2568/pending') {
        return json({
          supported: true,
          pending: { kind: 'tool_approval', prompt: 'Approve deployment?', request_id: 'req-1' },
        });
      }
      if (path.startsWith('/v0/city/test-city/beads')) return json({ items: [], total: 0 });
      return json({ items: [], total: 0 });
    }),
  );
});

afterEach(() => {
  cleanup();
  resetSupervisorApiForTests();
  vi.unstubAllGlobals();
});

describe('AgentsPage Needs you (owner slice)', () => {
  it('agent awaiting input is in Needs you, errored agent is not', async () => {
    render(
      <MemoryRouter>
        <NowProvider intervalMs={1_000_000}>
          <AgentsPage />
        </NowProvider>
      </MemoryRouter>,
    );
    const section = await screen.findByRole('region', { name: 'Agents needing you' });
    expect(await within(section).findByText('mayor')).toBeTruthy();
    expect(within(section).queryByText('broken-worker')).toBeNull();
    expect(within(section).getByRole('heading').textContent).toContain('(1)');
  });
});
