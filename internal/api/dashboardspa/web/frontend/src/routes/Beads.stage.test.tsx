import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BeadsPage } from './Beads';
import { setActiveCity } from '../api/cityBase';
import { invalidate } from '../api/cache';
import { NowProvider } from '../contexts/NowContext';
import { OperatorConfigProvider } from '../contexts/OperatorConfigContext';
import type { SupervisorBead } from '../supervisor/beadReads';

// Stage board page wiring (STAGE-BOARD-PLAN Task 4): route beads fold into
// their task, recent merges show by default, runs without a task on the board
// are counted, and a step bead's deep link still opens the bead dialog.

function bead(id: string, extra: Partial<SupervisorBead> = {}): SupervisorBead {
  return {
    id,
    title: `bead ${id}`,
    status: 'open',
    issue_type: 'task',
    created_at: '2026-11-15T08:00:00Z',
    ...extra,
  };
}

const TASK = bead('dw-1', { title: 'Ship the stage board', status: 'in_progress' });
const ROOT = bead('gcg-1', {
  title: 'devwork-development',
  status: 'in_progress',
  metadata: { 'gc.kind': 'workflow', 'gc.var.issue': 'dw-1', 'gc.root_store_ref': 'rig:east' },
});
const STEP = bead('gcg-2', {
  title: 'Verify Superpowers task tests pass',
  status: 'in_progress',
  metadata: { 'gc.root_bead_id': 'gcg-1', 'dashboard.stage': 'working' },
});
const NEXT = bead('gcg-3', {
  title: 'Task review',
  is_blocked: true,
  metadata: { 'gc.root_bead_id': 'gcg-1', 'dashboard.stage': 'review' },
});
const ORPHAN = bead('gcg-50', {
  title: 'devwork-implementation',
  status: 'in_progress',
  metadata: { 'gc.kind': 'workflow', 'gc.formula_name': 'devwork-implementation' },
});
const MERGED = bead('dw-9', {
  title: 'Merged last night',
  status: 'closed',
  updated_at: '2026-11-15T07:00:00Z',
  close_reason: 'merged into main at abc (PR #7)',
});

const CLOSED_STEP = bead('gcg-777', {
  title: 'Old closed step',
  status: 'closed',
  metadata: { 'gc.root_bead_id': 'gcg-776', 'dashboard.stage': 'working' },
});

const beadQueries: URLSearchParams[] = [];
/** Extra beads the unscoped open window returns in one test. */
let windowExtra: SupervisorBead[] = [];
/** Store total the open window reports; above the item count = truncated. */
let windowTotal: number | null = null;

beforeEach(() => {
  setActiveCity('test-city');
  beadQueries.length = 0;
  windowExtra = [];
  windowTotal = null;
  invalidate('beads:board:');
  invalidate('sessions');
  invalidate('agents');
  invalidate('rigs');
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(
        input instanceof Request ? input.url : String(input),
        window.location.origin,
      );
      if (url.pathname === '/v0/city/test-city/beads') {
        beadQueries.push(url.searchParams);
        const status = url.searchParams.get('status');
        if (status === 'closed') return json({ items: [MERGED], total: 1 });
        // Like the engine: a rig-scoped read hits the rig's work store alone,
        // which holds tasks but no run roots or steps.
        if (url.searchParams.has('rig')) return json({ items: [TASK], total: 1 });
        // Like live: the unscoped all=true window is all closed route steps.
        if (url.searchParams.get('all') === 'true') {
          return json({ items: [CLOSED_STEP], total: 17962 });
        }
        if (status === 'in_progress') return json({ items: [TASK, ROOT, STEP, ORPHAN], total: 4 });
        const items = [TASK, ROOT, STEP, NEXT, ORPHAN, ...windowExtra];
        return json({ items, total: windowTotal ?? items.length });
      }
      if (url.pathname === '/v0/city/test-city/bead/gcg-2') return json(STEP);
      if (url.pathname === '/v0/city/test-city/sessions') return json({ items: [], total: 0 });
      if (url.pathname === '/v0/city/test-city/agents') return json({ items: [], total: 0 });
      if (url.pathname === '/v0/city/test-city/rigs') {
        return json({
          items: [
            { name: 'east', path: '/r/east', agent_count: 0, running_count: 0, suspended: false },
            { name: 'west', path: '/r/west', agent_count: 0, running_count: 0, suspended: false },
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

describe('BeadsPage stopped runs (review I6)', () => {
  const STRANDED = bead('dw-5', { title: 'Run ended under me', status: 'in_progress' });

  it('marks an in-progress task with no live run as route stopped', async () => {
    windowExtra = [STRANDED];
    renderPage();
    await screen.findByText('Run ended under me');
    const card = screen.getByTitle('Select dw-5').closest('li');
    expect(card?.getAttribute('data-route-attention')).toBe('route-stopped');
    expect(within(card as HTMLElement).getByText('route stopped')).toBeTruthy();
  });

  it('does not guess a stop when the fetch window was truncated', async () => {
    windowExtra = [STRANDED];
    windowTotal = 5000;
    renderPage();
    await screen.findByText('Run ended under me');
    const card = screen.getByTitle('Select dw-5').closest('li');
    expect(card?.getAttribute('data-route-attention')).toBeNull();
  });
});

describe('BeadsPage Show all history (review I3)', () => {
  it('keeps merged tasks and live work instead of emptying the board', async () => {
    renderPage();
    await screen.findByText('Merged last night');
    fireEvent.click(screen.getByRole('button', { name: 'Show all history' }));
    await waitFor(() => expect(beadQueries.some((q) => q.get('all') === 'true')).toBe(true));
    const merged = await screen.findByRole('region', { name: 'Merged' });
    await waitFor(() => expect(within(merged).getByText('Merged last night')).toBeTruthy());
    expect(screen.queryByText('No tasks match the search or filter.')).toBeNull();
    expect(screen.queryByTitle('Select gcg-777')).toBeNull();
  });
});

describe('BeadsPage stage board', () => {
  it('folds route beads into their task card', async () => {
    renderPage();
    const working = await screen.findByRole('region', { name: 'Working' });
    await waitFor(() => expect(within(working).getByText('Ship the stage board')).toBeTruthy());
    const step = within(working).getByTitle('Open step gcg-2 in its run');
    expect(step.textContent).toBe('Verify Superpowers task tests pass');
    expect(screen.queryByTitle('Select gcg-1')).toBeNull();
    expect(screen.queryByTitle('Select gcg-2')).toBeNull();
    expect(screen.queryByTitle('Select gcg-3')).toBeNull();
    expect(screen.queryByTitle('Select gcg-50')).toBeNull();
  });

  it('shows recent merges by default from a rig-scoped closed leg', async () => {
    renderPage();
    const merged = await screen.findByRole('region', { name: 'Merged' });
    await waitFor(() => expect(within(merged).getByText('Merged last night')).toBeTruthy());
    const closedLeg = beadQueries.find((q) => q.get('status') === 'closed');
    expect(closedLeg?.get('rig')).toBe('east');
    expect(closedLeg?.has('all')).toBe(false);
  });

  // B7 / RB12: the synopsis is gone; the route line carries the counts.
  it('the route line counts tasks only', async () => {
    renderPage();
    await screen.findByText('Ship the stage board');
    expect(screen.getByRole('link', { name: 'Working: 1' })).toBeTruthy();
  });

  it('counts runs that have no task on the board instead of showing them', async () => {
    renderPage();
    await screen.findByText('Ship the stage board');
    const note = screen.getByText(/1 run is not tied to a task on this board\./);
    expect(within(note).getByRole('link', { name: 'Runs' }).getAttribute('href')).toBe('/runs');
  });

  it('still opens a route step from its deep link', async () => {
    renderPage('/beads?bead=gcg-2');
    const dialog = await screen.findByRole('dialog');
    expect(
      await within(dialog).findByRole('heading', { name: 'Verify Superpowers task tests pass' }),
    ).toBeTruthy();
  });
});

function renderPage(path = '/beads') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <NowProvider intervalMs={1_000_000}>
        <OperatorConfigProvider
          operator={{
            operatorAlias: 'owner',
            operatorWireAlias: 'human',
            decisionLabel: 'needs/owner',
          }}
        >
          <BeadsPage />
        </OperatorConfigProvider>
      </NowProvider>
    </MemoryRouter>,
  );
}

function json(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
