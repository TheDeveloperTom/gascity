import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BeadsPage } from './Beads';
import { setActiveCity } from '../api/cityBase';
import { invalidate } from '../api/cache';
import { NowProvider } from '../contexts/NowContext';
import { OperatorConfigProvider } from '../contexts/OperatorConfigContext';
import type { SupervisorBead } from '../supervisor/beadReads';

const PROJECT = 'gascity';
const beadQueries: URLSearchParams[] = [];
let extraBeads: SupervisorBead[] = [];
const supervisorWrites: Array<{
  method: string;
  path: string;
  body?: unknown;
}> = [];

beforeEach(() => {
  setActiveCity('test-city');
  beadQueries.length = 0;
  supervisorWrites.length = 0;
  extraBeads = [];
  invalidate('beads:board:');
  invalidate('sessions');
  invalidate('agents');
  invalidate('rigs');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = parsedUrl(input);
      const method = requestMethod(input, init);
      if (url.pathname === '/v0/city/test-city/beads' && method === 'GET') {
        beadQueries.push(url.searchParams);
        return jsonResponse(
          beadListPayload(url.searchParams.has('type') ? [] : [sampleBead(), ...extraBeads]),
        );
      }
      if (url.pathname === '/v0/city/test-city/beads' && method === 'POST') {
        supervisorWrites.push({
          method,
          path: url.pathname,
          body: await requestJson(input, init),
        });
        return jsonResponse(
          {
            id: `${PROJECT}-0002`,
            title: 'Route failing work',
            status: 'open',
            priority: 0,
            issue_type: 'task',
            labels: [],
            created_at: '2026-01-01T01:00:00Z',
          },
          { status: 201 },
        );
      }
      if (url.pathname === '/v0/city/test-city/sling' && method === 'POST') {
        supervisorWrites.push({
          method,
          path: url.pathname,
          body: await requestJson(input, init),
        });
        return jsonResponse({ status: 'ok', bead: `${PROJECT}-0002`, target: 'mayor' });
      }
      if (url.pathname === '/v0/city/test-city/bead/gascity-0001' && method === 'GET') {
        // The detail modal fetches the bead by id when it opens before the
        // board's full row is in state. Serve the full bead so the modal
        // renders deterministically regardless of load ordering.
        return jsonResponse(sampleBead());
      }
      if (url.pathname === '/v0/city/test-city/bead/gascity-0001' && method === 'PATCH') {
        supervisorWrites.push({
          method,
          path: url.pathname,
          body: await requestJson(input, init),
        });
        return jsonResponse({ status: 'ok' });
      }
      if (url.pathname === '/v0/city/test-city/bead/gascity-0001/close' && method === 'POST') {
        supervisorWrites.push({ method, path: url.pathname });
        return jsonResponse({ status: 'closed' });
      }
      if (url.pathname === '/v0/city/test-city/sessions') {
        return jsonResponse({ items: [], total: 0 });
      }
      if (url.pathname === '/v0/city/test-city/agents') {
        // Agents report `rig` as filesystem PATHS (not names), and one runs in
        // a directory (gascity-main) that is not a registered rig — exactly the
        // shapes the dropdown must canonicalize away.
        return jsonResponse({
          items: [
            agent('mayor', '/home/ds/east'),
            agent('west/mechanic', '/home/ds/west'),
            agent('janitor', '/home/ds/gascity-main'),
          ],
          total: 3,
        });
      }
      if (url.pathname === '/v0/city/test-city/rigs') {
        return jsonResponse({
          items: [
            {
              name: 'east',
              prefix: 'ea',
              path: '/home/ds/east',
              agent_count: 1,
              running_count: 1,
              suspended: false,
            },
            {
              name: 'west',
              prefix: 'we',
              path: '/home/ds/west',
              agent_count: 1,
              running_count: 1,
              suspended: false,
            },
          ],
          total: 2,
        });
      }
      throw new Error(`unexpected fetch: ${url.pathname}${url.search}`);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('BeadsPage', () => {
  it('renders the kanban board by default with no board/list compatibility switch', async () => {
    renderPage();

    await screen.findByRole('heading', { name: /^beads$/i });
    // B5 supersedes BE-11: one board region, never a section per id prefix.
    const board = await screen.findByRole('region', { name: 'Board' });

    expect(board).not.toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: /view/i })).toBeNull();
    // vk integration: «New task» is the filter bar's Mayor-channel button; the
    // header create-and-sling «New bead» button is gone.
    expect(screen.getAllByRole('button', { name: 'New task' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /new bead/i })).toBeNull();
  });

  it('requests direct supervisor current engineering beads without type fan-out or closed history', async () => {
    renderPage();

    await screen.findByText('Sample bead');

    // One windowed read plus the dedicated in-progress leg (gp-6xd F1) —
    // never a per-type fan-out or a closed-history (all=true) scan. The stage
    // board (2026-11-15) adds one small rig-scoped `status=closed` leg per rig
    // so Merged shows recent merges by default.
    expect(beadQueries.length).toBe(4);
    const [query, inProgressLeg, ...closedLegs] = beadQueries;
    expect(
      closedLegs.map((q) => [q.get('status'), q.get('rig'), q.get('limit'), q.has('all')]),
    ).toEqual([
      // A wide window; the board keeps the 100 closed most recently (review I2).
      ['closed', 'east', '1000', false],
      ['closed', 'west', '1000', false],
    ]);
    expect(query?.get('limit')).toBe('1000');
    expect(query?.has('all')).toBe(false);
    expect(query?.has('type')).toBe(false);
    expect(query?.has('showAll')).toBe(false);
    expect(inProgressLeg?.get('status')).toBe('in_progress');
    expect(inProgressLeg?.has('all')).toBe(false);
    expect(inProgressLeg?.has('type')).toBe(false);
  });

  it('refetches with all=true when the operator asks for all history', async () => {
    renderPage();

    await screen.findByText('Sample bead');
    // Window, in-progress leg, and one recent-closed leg per rig (stage board).
    expect(beadQueries.length).toBe(4);
    for (const query of beadQueries) {
      expect(query.has('all')).toBe(false);
    }

    fireEvent.click(screen.getByRole('button', { name: 'Show older' }));

    // Activating `closed` flips the data scope, forcing exactly one fresh read
    // whose window now carries all=true (closed beads included). The
    // in-progress leg never carries all — in-progress work is never closed.
    // Stage board (review I3): the rig closed legs still run (uncapped) and an
    // unscoped open leg keeps live work and its runs, so the chip is a
    // superset of the default view instead of an all-route-steps window.
    await waitFor(() => expect(beadQueries.length).toBe(9));
    const chipRead = beadQueries.slice(4);
    const allWindow = chipRead.filter((q) => q.get('all') === 'true');
    expect(allWindow).toHaveLength(1);
    expect(allWindow[0]?.has('type')).toBe(false);
    expect(chipRead.filter((q) => q.get('status') === 'in_progress')).toHaveLength(1);
    expect(chipRead.filter((q) => q.get('status') === 'closed').map((q) => q.get('rig'))).toEqual([
      'east',
      'west',
    ]);
    const openLeg = chipRead.filter((q) => !q.has('status') && !q.has('all') && !q.has('rig'));
    expect(openLeg).toHaveLength(1);

    // Deactivating `closed` must revert to an open-only fetch — otherwise the
    // chip would read inactive while the board silently keeps scanning closed
    // history (the showClosed/chip desync this dual-state wiring must avoid).
    fireEvent.click(screen.getByRole('button', { name: 'Hide older' }));
    await waitFor(() => expect(beadQueries.length).toBe(13));
    const reopened = beadQueries.slice(9);
    expect(reopened.some((q) => q.has('all'))).toBe(false);
    expect(reopened.filter((q) => !q.has('status'))).toHaveLength(1);
    expect(reopened.every((q) => !q.has('type'))).toBe(true);
  });

  // B7 supersedes the rig select (BE-09): the project control is client-side
  // and names rigs by their API name, never by their path.
  it('the project control lists the real rigs and the city', async () => {
    extraBeads = [
      { ...sampleBead(), id: 'ea-1', title: 'East work' },
      { ...sampleBead(), id: 'we-1', title: 'West work' },
    ];
    renderPage();

    await screen.findByText('East work');
    // vk-final: the project chips became the «Project:» menu.
    fireEvent.click(screen.getByRole('button', { name: /Project:/ }));
    const names = within(screen.getByRole('listbox', { name: 'Choose a project' }))
      .getAllByRole('option')
      .map((option) => option.textContent ?? '');
    expect(names).toEqual(['All3', 'east1', 'west1', 'City1']);
    for (const name of names) {
      expect(name).not.toContain('/home/ds');
      expect(name).not.toContain('gascity-main');
    }
  });

  // vk integration: the create-and-sling form left the page with its header
  // button (lane 4: «Новая задача» goes to the Mayor's channel). Its two page
  // tests (sling agent labels, create and sling) were removed with it; the
  // write itself stays covered in supervisor/beadWrites.test.ts.

  it('preselects the epic from ?epic= (⌘K epic rows link here)', async () => {
    extraBeads = [
      { ...sampleBead(), id: 'ea-1', title: 'M04 work', labels: ['milestone:M04'] },
      { ...sampleBead(), id: 'ea-2', title: 'Other work', labels: [] },
    ];
    renderPage('/beads?epic=M04');

    await screen.findByText('M04 work');
    expect(screen.queryByText('Other work')).toBeNull();
    expect(screen.queryByText('Sample bead')).toBeNull();
  });

  it('deep-links to and selects a bead from the bead query param', async () => {
    renderPage('/beads?bead=gascity-0001');

    const selected = await screen.findByTitle('Select gascity-0001');
    expect(selected.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('heading', { name: 'Sample bead' })).toBeTruthy();
    expect(within(screen.getByRole('dialog')).getByText('gascity-0001')).toBeTruthy();
  });

  it('closes beads directly through the supervisor API', async () => {
    renderPage('/beads?bead=gascity-0001');

    const detailDialog = await screen.findByRole('dialog');
    // No operator Claim affordance: the human is never a bead assignee
    // (gascity-dashboard-2j8e.8).
    expect(within(detailDialog).queryByRole('button', { name: /^claim$/i })).toBeNull();

    const closeButton = within(detailDialog)
      .getAllByRole('button', { name: /^close bead…$/i })
      .find((button) => button.textContent?.trim() === 'Close bead…');
    expect(closeButton).toBeTruthy();
    fireEvent.click(closeButton as HTMLButtonElement);

    const closeDialog = await screen.findByRole('heading', { name: /close gascity-0001/i });
    const modal = closeDialog.closest('[role="dialog"]');
    expect(modal).toBeTruthy();
    fireEvent.click(within(modal as HTMLElement).getByRole('button', { name: /close bead/i }));

    await screen.findByText(/closed gascity-0001/i);
    await waitFor(() => {
      expect(supervisorWrites).toEqual([
        {
          method: 'POST',
          path: '/v0/city/test-city/bead/gascity-0001/close',
        },
      ]);
    });
  });
});

function renderPage(path = '/beads') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <NowProvider intervalMs={1_000_000}>
        <OperatorConfigProvider
          operator={{
            operatorAlias: 'stephanie',
            operatorWireAlias: 'human',
            decisionLabel: 'needs/stephanie',
          }}
        >
          <BeadsPage />
        </OperatorConfigProvider>
      </NowProvider>
    </MemoryRouter>,
  );
}

function jsonResponse(payload: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(payload), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}

function beadListPayload(items: ReadonlyArray<SupervisorBead>): {
  items: ReadonlyArray<SupervisorBead>;
  total: number;
} {
  return { items, total: items.length };
}

function sampleBead(): SupervisorBead {
  return {
    id: `${PROJECT}-0001`,
    title: 'Sample bead',
    // The board fetch returns full beads (description included). Carrying it
    // here lets the detail modal render from the pre-loaded row and skip the
    // by-id detail fetch (useBeadDetail's `description` freshness signal),
    // matching the production path.
    description: 'Sample bead description.',
    status: 'open',
    priority: 0,
    issue_type: 'task',
    assignee: 'mayor',
    labels: [],
    created_at: '2026-01-01T00:00:00Z',
  };
}

function agent(name: string, rig: string): unknown {
  return {
    name,
    // The supervisor fills display_name from the agent's provider.
    display_name: 'Claude Code',
    rig,
    available: true,
    running: true,
    state: 'active',
    suspended: false,
  };
}

function parsedUrl(input: RequestInfo | URL): URL {
  const value =
    input instanceof Request ? input.url : input instanceof URL ? input.toString() : String(input);
  return new URL(value, window.location.origin);
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (input instanceof Request) return input.method;
  return init?.method ?? 'GET';
}

async function requestJson(input: RequestInfo | URL, init?: RequestInit): Promise<unknown> {
  if (input instanceof Request) {
    return input.clone().json() as Promise<unknown>;
  }
  const body = init?.body;
  if (typeof body !== 'string') return undefined;
  return JSON.parse(body) as unknown;
}
