import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setActiveCity } from '../api/cityBase';
import { invalidate, setCached } from '../api/cache';
import { AttentionProvider } from '../attention/context';
import type { AttentionContributor } from '../attention/compose';
import { NowProvider } from '../contexts/NowContext';
import { ReadOnlyProvider } from '../contexts/ReadOnlyContext';
import type { SupervisorBead } from '../supervisor/beadReads';
import { BeadsPage } from './Beads';

interface FetchCall {
  method: string;
  path: string;
  query: URLSearchParams;
}

const fetchCalls: FetchCall[] = [];

beforeEach(() => {
  setActiveCity('test-city');
  fetchCalls.length = 0;
  invalidate('beads:board:');
  invalidate('sessions');
  invalidate('agents');
  invalidate('rigs');
  stubFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('BeadsPage supervisor reads', () => {
  it('shows only real current work without requesting the slow closed-history supervisor path', async () => {
    renderPage();

    await screen.findByRole('button', { name: 'direct supervisor bead' });

    expect(screen.queryByText('supervisor noise bead')).toBeNull();
    expect(fetchCalls.some((call) => call.path === '/api/city/test-city/beads')).toBe(false);
    // The windowed read plus the dedicated in-progress leg (gp-6xd F1), plus the
    // stage board's one rig-scoped recent-closed leg — none is the slow
    // closed-history (all=true) path.
    expect(beadFetches()).toHaveLength(3);
    expect(beadFetches().every((call) => call.query.has('all'))).toBe(false);
    expect(beadFetches().every((call) => call.query.has('type'))).toBe(false);
  });

  it('does not seed the board from another city cache entry', async () => {
    setCached('beads:board:', {
      items: [bead({ id: 'legacy-city-bead', title: 'legacy city bead' })],
      total: 1,
      upstream_fetched: 1,
      fetch_limit: 1000,
    });

    renderPage();

    expect(screen.queryByText('legacy city bead')).toBeNull();
    expect(screen.getAllByText('Loading beads.').length).toBeGreaterThan(0);
    expect(await screen.findByRole('button', { name: 'direct supervisor bead' })).toBeTruthy();
  });

  it('resolves a bead query param even when the bead is outside the list window', async () => {
    renderPage('/beads?bead=td-window-miss');

    expect(await screen.findByRole('heading', { name: 'detail-only bead' })).toBeTruthy();
    expect(screen.getAllByText(/td-window-miss/i).length).toBeGreaterThan(0);
    expect(fetchCalls.some((call) => call.path === '/v0/city/test-city/bead/td-window-miss')).toBe(
      true,
    );
  });

  // polish2 item 8: one «Связи» section (no «Dependencies» tree under a
  // «Подробности» block); the live run opens from «Работа агентов».
  it('renders the relations once and live-run access in the bead detail modal', async () => {
    renderPage('/beads?bead=td-bead-abc123');

    const dialog = await screen.findByRole('dialog');

    expect(
      await within(dialog).findByRole('heading', { name: 'direct supervisor bead' }),
    ).toBeTruthy();
    expect(within(dialog).queryByText('Dependencies')).toBeNull();
    expect(within(dialog).queryByText('Details')).toBeNull();
    const relations = within(dialog).getByTestId('task-relationships');
    expect(await within(relations).findByText(/parent bead/)).toBeTruthy();
    expect(within(dialog).getAllByText(/parent bead/)).toHaveLength(1);
    expect(within(dialog).getByRole('button', { name: /watch what it writes/i })).toBeTruthy();
  });

  // vk integration: the header create-and-sling «New bead» button is gone;
  // «New task» is the filter bar's one button and opens the Mayor's channel.
  it('surfaces a read-only affordance in read-only mode', async () => {
    renderPage('/beads', [], { readOnly: true });

    await screen.findByRole('button', { name: 'direct supervisor bead' });

    expect(screen.queryByRole('button', { name: 'New bead' })).toBeNull();
    // The affordance carries words, not just a dimmed control (DESIGN.md §States).
    expect(screen.getByText('Read-only')).toBeTruthy();
  });

  it('disables the per-bead close action in read-only mode', async () => {
    renderPage('/beads?bead=td-bead-abc123', [], { readOnly: true });

    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('heading', { name: 'direct supervisor bead' });
    // Scope to the bead-action group: the modal's own dismiss control also
    // carries aria-label "Close", so locate the action-row Close (its visible
    // text is exactly "Close", unlike the "×" dismiss) and assert the write
    // there is disabled. There is no operator Claim action
    // (gascity-dashboard-2j8e.8) — the human is never a bead assignee.
    const closeButton = within(dialog)
      .getAllByRole('button', { name: /^close bead…$/i })
      .find((button) => button.textContent?.trim() === 'Close bead…') as HTMLButtonElement;
    expect(closeButton).toBeTruthy();
    const actions = closeButton.parentElement;
    expect(actions).not.toBeNull();
    expect(within(actions as HTMLElement).queryByRole('button', { name: 'Claim' })).toBeNull();
    expect(closeButton.disabled).toBe(true);
    // The action row carries the shared glyph+word affordance, not a bare
    // dimmed button (DESIGN.md §States have words).
    expect(within(actions as HTMLElement).getByText('Read-only')).toBeTruthy();
  });

  it('has exactly one New task control, the Mayor-channel one, when writable', async () => {
    renderPage('/beads');

    await screen.findByRole('button', { name: 'direct supervisor bead' });

    expect(screen.queryByRole('button', { name: 'New bead' })).toBeNull();
    // No VITE_MAYOR_DISCORD_URL in tests: the one control is disabled and says why.
    const newTask = screen.getAllByRole('button', { name: 'New task' });
    expect(newTask).toHaveLength(1);
    expect(newTask[0]?.getAttribute('title')).toBe('The Mayor channel is not configured');
    expect(screen.queryByText('Read-only')).toBeNull();
  });

  it('marks attention beads on the board while preserving non-attention rows', async () => {
    renderPage('/beads', [
      contributor('beads', [
        {
          id: 'beads:td-bead-abc123:ready-unclaimed',
          domain: 'beads',
          severity: 'attention',
          title: 'td-bead-abc123 unclaimed',
        },
      ]),
    ]);

    const boardRow = (await screen.findByRole('button', { name: 'direct supervisor bead' })).closest('article');
    expect(boardRow?.getAttribute('data-attention-severity')).toBe('attention');
  });
});

function renderPage(
  path = '/beads',
  contributors: readonly AttentionContributor[] = [],
  options: { readOnly?: boolean } = {},
) {
  return render(
    <MemoryRouter initialEntries={[allProjects(path)]}>
      <NowProvider intervalMs={1_000_000}>
        <ReadOnlyProvider readOnly={options.readOnly ?? false}>
          <AttentionProvider contributors={contributors}>
            <BeadsPage />
          </AttentionProvider>
        </ReadOnlyProvider>
      </NowProvider>
    </MemoryRouter>,
  );
}

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = parsedUrl(input);
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
      fetchCalls.push({ method, path: url.pathname, query: url.searchParams });

      if (url.pathname === '/v0/city/test-city/beads') {
        return jsonResponse(beadListForQuery(url.searchParams.get('type')));
      }
      if (url.pathname === '/v0/city/test-city/bead/td-window-miss') {
        return jsonResponse(
          bead({
            id: 'td-window-miss',
            title: 'detail-only bead',
            description: 'fetched by deep-link id',
          }),
        );
      }
      if (url.pathname === '/v0/city/test-city/bead/td-bead-abc123') {
        return jsonResponse(
          bead({
            id: 'td-bead-abc123',
            title: 'direct supervisor bead',
            assignee: 'mayor',
            needs: ['td-parent-1'],
          }),
        );
      }
      if (url.pathname === '/v0/city/test-city/sessions') {
        return jsonResponse({
          items: [
            {
              id: 'gc-session-1',
              session_name: 'mayor',
              alias: 'mayor',
              template: 'mayor',
              title: 'mayor',
              state: 'active',
              provider: 'claude',
              running: true,
              attached: false,
              created_at: '2026-06-01T00:00:00Z',
            },
          ],
          total: 1,
        });
      }
      if (url.pathname === '/v0/city/test-city/agents') {
        return jsonResponse({
          items: [
            {
              name: 'mayor',
              display_name: 'Mayor',
              rig: '/home/ds/east',
              available: true,
              running: true,
              state: 'active',
              suspended: false,
            },
          ],
          total: 1,
        });
      }
      if (url.pathname === '/v0/city/test-city/rigs') {
        return jsonResponse({
          items: [
            {
              name: 'east',
              path: '/home/ds/east',
              agent_count: 1,
              running_count: 1,
              suspended: false,
            },
          ],
          total: 1,
        });
      }
      throw new Error(`unexpected fetch: ${url.pathname}${url.search}`);
    }),
  );
}

function beadListForQuery(type: string | null): { items: SupervisorBead[]; total: number } {
  if (type === null || type === 'task') {
    return {
      items: [
        bead({
          id: 'td-bead-abc123',
          title: 'direct supervisor bead',
          assignee: 'mayor',
          needs: ['td-parent-1'],
        }),
        bead({
          id: 'td-noise-abc123',
          title: 'supervisor noise bead',
          labels: ['gc:session'],
        }),
        bead({
          id: 'td-parent-1',
          title: 'parent bead',
          status: 'open',
          issue_type: 'bug',
        }),
      ],
      total: 3,
    };
  }
  if (type === 'bug') {
    return {
      items: [
        bead({
          id: 'td-parent-1',
          title: 'parent bead',
          status: 'open',
          issue_type: 'bug',
        }),
      ],
      total: 1,
    };
  }
  return { items: [], total: 0 };
}

function bead(overrides: Partial<SupervisorBead>): SupervisorBead {
  return {
    id: 'td-bead',
    title: 'bead',
    status: 'open',
    issue_type: 'task',
    priority: 0,
    labels: [],
    created_at: '2026-06-01T00:00:00Z',
    ...overrides,
  };
}

function beadFetches(): FetchCall[] {
  return fetchCalls.filter((call) => call.path === '/v0/city/test-city/beads');
}

function jsonResponse(payload: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(payload), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}

function parsedUrl(input: RequestInfo | URL): URL {
  const value =
    input instanceof Request ? input.url : input instanceof URL ? input.toString() : String(input);
  return new URL(value, window.location.origin);
}

function contributor(
  domain: 'beads',
  items: ReturnType<AttentionContributor['getItems']>,
): AttentionContributor {
  return {
    id: `${domain}:test`,
    domain,
    getItems: () => items,
  };
}

// VK 1:1 (16.11): the board opens on the devwork product; these tests read the
// whole board, so they ask for every project unless the entry names one.
function allProjects(entry: string): string {
  if (/[?&]project=/.test(entry)) return entry;
  return `${entry}${entry.includes('?') ? '&' : '?'}project=all`;
}
