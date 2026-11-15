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

// B2: orders, gates and engine-labelled beads never become cards; with
// withRoutes they travel aside as service_items so blockers can be named.

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
const ORDER = bead('gcg-o', {
  title: 'order:archyl-drift-stage',
  labels: ['order-run:archyl-drift-stage', 'order-tracking'],
});
const GATE = bead('dw-ssmbcp', { issue_type: 'gate', title: 'когда окно?' });

type Query = Record<string, unknown>;

function install(listBeads: (city: string, query: Query) => Promise<unknown>) {
  const api = {
    baseUrl: '/gc-supervisor',
    listBeads: vi.fn(listBeads),
    listRigs: vi.fn(async () => ({ items: [], total: 0 })),
    mutationHeaders: () => ({ ...GC_MUTATION_HEADERS }),
  } as unknown as SupervisorApi;
  setSupervisorApiForTests(api);
}

describe('listSupervisorBeads service items', () => {
  beforeEach(() => setActiveCity('test-city'));
  afterEach(() => resetSupervisorApiForTests());

  it('service beads leave items for service_items', async () => {
    install(async (_c, q) =>
      q['status'] === 'in_progress'
        ? { items: [], total: 0 }
        : { items: [TASK, ORDER, GATE], total: 3 },
    );
    const list = await listSupervisorBeads({ withRoutes: true });
    expect(list.items.map((b) => b.id)).toEqual(['dw-1']);
    expect(list.service_items?.map((b) => b.id)).toEqual(['gcg-o', 'dw-ssmbcp']);
  });

  it('without withRoutes the order bead is dropped', async () => {
    install(async (_c, q) =>
      q['status'] === 'in_progress'
        ? { items: [], total: 0 }
        : { items: [TASK, ORDER, GATE], total: 3 },
    );
    const list = await listSupervisorBeads();
    expect(list.items.map((b) => b.id)).not.toContain('gcg-o');
    expect(list.service_items).toBeUndefined();
  });

  it('service_items are deduped across legs', async () => {
    install(async (_c, q) =>
      q['status'] === 'in_progress'
        ? { items: [GATE], total: 1 }
        : { items: [TASK, GATE], total: 2 },
    );
    const list = await listSupervisorBeads({ withRoutes: true });
    expect(list.service_items?.map((b) => b.id)).toEqual(['dw-ssmbcp']);
  });
});
