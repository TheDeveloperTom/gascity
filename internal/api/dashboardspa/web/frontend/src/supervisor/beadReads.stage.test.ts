import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bead } from 'gas-city-dashboard-shared/gc-supervisor';
import { setActiveCity } from '../api/cityBase';
import {
  GC_MUTATION_HEADERS,
  resetSupervisorApiForTests,
  setSupervisorApiForTests,
  type SupervisorApi,
} from './client';
import { listSupervisorBeads } from './beadReads';

// Stage board reads (STAGE-BOARD-PLAN Task 2): route beads (workflow roots and
// their members, any type) leave the board rows and travel as `route_items`;
// a rig-scoped closed leg brings recent merges onto the default board.

function bead(id: string, extra: Partial<Bead> = {}): Bead {
  return {
    id,
    title: id,
    status: 'open',
    issue_type: 'task',
    created_at: '2026-11-15T08:00:00Z',
    ...extra,
  };
}

const TASK = bead('dw-1');
const ROOT = bead('gcg-1', { metadata: { 'gc.kind': 'workflow', 'gc.var.issue': 'dw-1' } });
const STEP = bead('gcg-2', {
  metadata: { 'gc.root_bead_id': 'gcg-1', 'dashboard.stage': 'working' },
});
const GATE = bead('gcg-3', {
  issue_type: 'gate',
  metadata: { 'gc.root_bead_id': 'gcg-1', 'devwork.pr_number': '7' },
});
const MERGED = bead('dw-9', { status: 'closed', updated_at: '2026-11-15T09:00:00Z' });

type Query = Record<string, unknown>;

function install(listBeads: (city: string, query: Query) => Promise<unknown>, rigs = ['devwork']) {
  const api = {
    baseUrl: '/gc-supervisor',
    listBeads: vi.fn(listBeads),
    listRigs: vi.fn(async () => ({
      items: rigs.map((name) => ({ name, path: `/r/${name}` })),
      total: rigs.length,
    })),
    mutationHeaders: () => ({ ...GC_MUTATION_HEADERS }),
  } as unknown as SupervisorApi;
  setSupervisorApiForTests(api);
  return api as unknown as {
    listBeads: ReturnType<typeof vi.fn>;
    listRigs: ReturnType<typeof vi.fn>;
  };
}

function openWindow(query: Query) {
  if (query['status'] === 'closed') return { items: [MERGED], total: 1 };
  if (query['status'] === 'in_progress') return { items: [], total: 0 };
  return { items: [TASK, ROOT, STEP, GATE], total: 4 };
}

describe('listSupervisorBeads stage-board options', () => {
  beforeEach(() => setActiveCity('test-city'));
  afterEach(() => resetSupervisorApiForTests());

  it('moves route beads of any type into route_items when withRoutes is set', async () => {
    install(async (_city, query) => openWindow(query));
    const list = await listSupervisorBeads({ withRoutes: true });
    expect(list.items.map((b) => b.id)).toEqual(['dw-1']);
    expect(list.route_items?.map((b) => b.id)).toEqual(['gcg-1', 'gcg-2', 'gcg-3']);
    expect(list.upstream_fetched).toBe(4);
  });

  it('leaves the default read unchanged without withRoutes', async () => {
    install(async (_city, query) => openWindow(query));
    const list = await listSupervisorBeads();
    expect(list.items.map((b) => b.id)).toEqual(['dw-1', 'gcg-1', 'gcg-2']);
    expect(list.route_items).toBeUndefined();
  });

  it('adds one rig-scoped closed leg per rig after the window and in-progress legs', async () => {
    const api = install(async (_city, query) => openWindow(query), ['devwork', 'east']);
    const list = await listSupervisorBeads({ withRoutes: true, recentClosed: { limit: 100 } });
    const queries = api.listBeads.mock.calls.map((call) => call[1] as Query);
    expect(queries).toHaveLength(4);
    expect(queries[0]?.['status']).toBeUndefined();
    expect(queries[1]?.['status']).toBe('in_progress');
    expect(queries.slice(2)).toEqual([
      { limit: 1000, status: 'closed', rig: 'devwork' },
      { limit: 1000, status: 'closed', rig: 'east' },
    ]);
    expect(list.items.map((b) => b.id)).toEqual(['dw-1', 'dw-9']);
    expect(list.recent_closed_fetched).toBe(1);
    // The truncation notice still compares the window leg alone.
    expect(list.upstream_fetched).toBe(4);
  });

  it('scopes the closed leg to the rig filter without listing rigs', async () => {
    const api = install(async (_city, query) => openWindow(query));
    await listSupervisorBeads({ rigFilter: 'east', recentClosed: { limit: 100 } });
    expect(api.listRigs).not.toHaveBeenCalled();
    const closed = api.listBeads.mock.calls
      .map((c) => c[1] as Query)
      .filter((q) => q['status'] === 'closed');
    expect(closed).toEqual([{ limit: 1000, status: 'closed', rig: 'east' }]);
  });

  // BOARD-LOAD 16.11: the board's own rigs read (useBoardData) and the closed
  // legs' rig list were two parallel /rigs requests; the caller now hands the
  // closed legs its shared rigs read.
  it('takes the closed legs rig names from the caller instead of listing rigs again', async () => {
    const api = install(async (_city, query) => openWindow(query), ['ignored']);
    const rigNames = vi.fn(async () => ['devwork', 'east']);
    await listSupervisorBeads({ withRoutes: true, recentClosed: { limit: 100, rigNames } });
    expect(api.listRigs).not.toHaveBeenCalled();
    expect(rigNames).toHaveBeenCalledTimes(1);
    const closed = api.listBeads.mock.calls
      .map((c) => c[1] as Query)
      .filter((q) => q['status'] === 'closed');
    expect(closed).toEqual([
      { limit: 1000, status: 'closed', rig: 'devwork' },
      { limit: 1000, status: 'closed', rig: 'east' },
    ]);
  });

  // Review I3: under the `closed` chip the unscoped all=true window is all
  // closed route steps from the city store (live: 1000/1000 gcg), so after
  // the fold it held no task at all. The chip must be a superset of the
  // default view: the rig closed legs still run (uncapped), and an unscoped
  // open leg keeps the live runs' stages.
  it('keeps closed tasks and live runs under the closed chip', async () => {
    const OLD_CLOSED = Array.from({ length: 3 }, (_, i) =>
      bead(`dw-c${i}`, { status: 'closed', updated_at: `2026-11-1${i}T08:00:00Z` }),
    );
    const CLOSED_STEP = bead('gcg-9', {
      status: 'closed',
      metadata: { 'gc.root_bead_id': 'gcg-8' },
    });
    const api = install(async (_city, query) => {
      if (query['all'] === true) return { items: [CLOSED_STEP], total: 17962 };
      if (query['status'] === 'closed') return { items: OLD_CLOSED, total: 3 };
      if (query['status'] === 'in_progress') return { items: [], total: 0 };
      return { items: [TASK, ROOT, STEP, GATE], total: 4 };
    });
    const list = await listSupervisorBeads({
      includeClosed: true,
      withRoutes: true,
      recentClosed: { limit: 1 },
    });
    const queries = api.listBeads.mock.calls.map((c) => c[1] as Query);
    expect(queries).toContainEqual({ limit: 1000, status: 'closed', rig: 'devwork' });
    expect(queries).toContainEqual({ limit: 1000 });
    // Every closed task, not just the newest one, plus the open task.
    expect(list.items.map((b) => b.id).sort()).toEqual(['dw-1', 'dw-c0', 'dw-c1', 'dw-c2']);
    expect(list.route_items?.map((b) => b.id)).toEqual(
      expect.arrayContaining(['gcg-1', 'gcg-2', 'gcg-3', 'gcg-9']),
    );
  });

  // Review I1: a rig-scoped read hits the rig's work store alone, which holds
  // no run roots or steps (they live in the city graph store). The routes
  // must come from an unscoped open leg, used for route_items only.
  it('keeps route beads under a rig filter from an unscoped open leg', async () => {
    const HQ_TASK = bead('dp-1');
    const api = install(async (_city, query) => {
      if (query['rig'] === 'devwork') {
        if (query['status'] === 'closed') return { items: [], total: 0 };
        return { items: [TASK], total: 1 };
      }
      return { items: [HQ_TASK, ROOT, STEP, GATE], total: 4 };
    });
    const list = await listSupervisorBeads({ rigFilter: 'devwork', withRoutes: true });
    const queries = api.listBeads.mock.calls.map((call) => call[1] as Query);
    expect(queries).toContainEqual({ limit: 1000 });
    expect(list.route_items?.map((b) => b.id)).toEqual(['gcg-1', 'gcg-2', 'gcg-3']);
    // The unscoped leg feeds routes only: another store's task stays out.
    expect(list.items.map((b) => b.id)).toEqual(['dw-1']);
    expect(list.routes_complete).toBe(true);
  });

  it('reports routes as incomplete when the leg that supplied them was truncated', async () => {
    install(async (_city, query) => {
      if (query['rig'] === 'devwork') return { items: [TASK], total: 1 };
      return { items: [ROOT, STEP], total: 5000 };
    });
    const list = await listSupervisorBeads({ rigFilter: 'devwork', withRoutes: true });
    expect(list.routes_complete).toBe(false);
  });

  // Review I2: the engine lists newest-created first and has no sort, so the
  // closed leg fetches a wide window and the board keeps the N tasks closed
  // most recently (updated_at; the API exposes no closed_at). Convoys and
  // route beads must not take slots.
  it('keeps the most recently closed tasks, not the most recently created', async () => {
    const closed = (id: string, created: string, closedAt: string, extra: Partial<Bead> = {}) =>
      bead(id, { status: 'closed', created_at: created, updated_at: closedAt, ...extra });
    const legItems = [
      closed('dw-convoy', '2026-11-15T09:00:00Z', '2026-11-15T09:59:00Z', {
        issue_type: 'convoy',
      }),
      closed('dw-new1', '2026-11-15T08:00:00Z', '2026-11-15T08:10:00Z'),
      closed('dw-new2', '2026-11-15T07:00:00Z', '2026-11-15T07:10:00Z'),
      closed('gcg-step', '2026-11-15T06:00:00Z', '2026-11-15T09:58:00Z', {
        metadata: { 'gc.root_bead_id': 'gcg-1' },
      }),
      closed('dw-old', '2026-11-08T08:00:00Z', '2026-11-15T09:30:00Z'),
    ];
    const api = install(async (_city, query) => {
      if (query['status'] === 'closed') return { items: legItems, total: legItems.length };
      return { items: [], total: 0 };
    });
    const list = await listSupervisorBeads({ withRoutes: true, recentClosed: { limit: 2 } });
    const closedLeg = api.listBeads.mock.calls
      .map((c) => c[1] as Query)
      .find((q) => q['status'] === 'closed');
    expect(closedLeg).toEqual({ limit: 1000, status: 'closed', rig: 'devwork' });
    expect(list.items.map((b) => b.id)).toEqual(['dw-old', 'dw-new1']);
    expect(list.recent_closed_fetched).toBe(2);
  });

  it('treats a failed route leg as incomplete routes, not as an error', async () => {
    install(async (_city, query) => {
      if (query['rig'] === 'devwork') return { items: [TASK], total: 1 };
      throw new Error('503');
    });
    const list = await listSupervisorBeads({ rigFilter: 'devwork', withRoutes: true });
    expect(list.items.map((b) => b.id)).toEqual(['dw-1']);
    expect(list.route_items).toEqual([]);
    expect(list.routes_complete).toBe(false);
  });

  it('treats the recent closed leg as best-effort', async () => {
    install(async (_city, query) => {
      if (query['status'] === 'closed') throw new Error('503 invalid issue type');
      return openWindow(query);
    });
    const list = await listSupervisorBeads({ withRoutes: true, recentClosed: { limit: 100 } });
    expect(list.items.map((b) => b.id)).toEqual(['dw-1']);
    expect(list.recent_closed_fetched).toBe(0);
  });
});
