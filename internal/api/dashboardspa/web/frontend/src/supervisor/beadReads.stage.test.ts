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
      { limit: 100, status: 'closed', rig: 'devwork' },
      { limit: 100, status: 'closed', rig: 'east' },
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
    expect(closed).toEqual([{ limit: 100, status: 'closed', rig: 'east' }]);
  });

  it('skips the closed leg when the board already includes closed beads', async () => {
    const api = install(async (_city, query) => openWindow(query));
    await listSupervisorBeads({ includeClosed: true, recentClosed: { limit: 100 } });
    expect(api.listRigs).not.toHaveBeenCalled();
    expect(api.listBeads).toHaveBeenCalledTimes(2);
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
