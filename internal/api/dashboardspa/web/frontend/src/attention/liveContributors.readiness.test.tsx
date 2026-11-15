import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidate } from '../api/cache';
import { setActiveCity } from '../api/cityBase';
import type { OperatorConfig } from '../contexts/OperatorConfigContext';
import type * as SupervisorClient from '../supervisor/client';
import { useLiveAttentionContributors } from './liveContributors';

const operator: OperatorConfig = {
  operatorAlias: 'stephanie',
  operatorWireAlias: 'human',
  decisionLabel: 'needs/stephanie',
};

const mockApi = vi.hoisted(() => ({
  doltTrend: vi.fn(),
  listBuilds: vi.fn(),
  systemHealth: vi.fn(),
}));

const mockSupervisorApi = vi.hoisted(() => ({
  cityHealth: vi.fn(),
  listAgents: vi.fn(),
  listBeads: vi.fn(),
  listEvents: vi.fn(),
  listMail: vi.fn(),
  listSessions: vi.fn(),
  listRigs: vi.fn(),
  sessionPending: vi.fn(),
}));

vi.mock('../api/client', () => ({
  api: mockApi,
  formatApiError: (err: unknown, fallback = 'request failed') =>
    err instanceof Error ? err.message : fallback,
}));

vi.mock('../supervisor/client', async (importOriginal) => {
  const actual = await importOriginal<typeof SupervisorClient>();
  return {
    ...actual,
    supervisorApi: () => mockSupervisorApi,
    supervisorApiForRequestBudget: () => mockSupervisorApi,
  };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const TASK = {
  created_at: '2026-05-29T20:00:00.000Z',
  id: 'dw-1',
  issue_type: 'task',
  status: 'in_progress',
  title: 'Вход по ссылке',
};
const ROOT = {
  created_at: '2026-05-29T20:00:00.000Z',
  id: 'R-1',
  issue_type: 'molecule',
  status: 'in_progress',
  title: 'devwork-development',
  metadata: { 'gc.kind': 'workflow', 'gc.var.issue': 'dw-1' },
};
const STEP = {
  created_at: '2026-05-29T20:00:00.000Z',
  id: 'R-1.1',
  issue_type: 'task',
  status: 'in_progress',
  title: 'Implement',
  metadata: { 'gc.root_bead_id': 'R-1' },
};

describe('useLiveAttentionContributors owner readiness', () => {
  beforeEach(() => {
    setActiveCity('test-city');
    invalidate('attention:');
    for (const fn of [...Object.values(mockApi), ...Object.values(mockSupervisorApi)]) {
      fn.mockReset();
    }
    mockSupervisorApi.listAgents.mockResolvedValue({ total: 0, items: [] });
    mockSupervisorApi.listSessions.mockResolvedValue({ total: 0, items: [] });
    mockSupervisorApi.listEvents.mockResolvedValue({ total: 0, items: [] });
    mockSupervisorApi.cityHealth.mockResolvedValue({ city: 'c', status: 'ok', version: '1' });
    mockSupervisorApi.listMail.mockResolvedValue({ total: 0, items: [] });
    mockSupervisorApi.listBeads.mockResolvedValue({ total: 0, items: [] });
    mockApi.listBuilds.mockResolvedValue({ failed_marker: false, items: [], source: null });
    mockApi.systemHealth.mockRejectedValue(new Error('no'));
    mockApi.doltTrend.mockRejectedValue(new Error('no'));
  });

  afterEach(() => {
    invalidate('attention:');
  });

  it('loading until decisions and mail resolve', async () => {
    const mail = deferred<unknown>();
    mockSupervisorApi.listMail.mockReturnValue(mail.promise);
    const { result } = renderHook(() => useLiveAttentionContributors(operator, undefined));
    expect(result.current.ownerReadiness).toEqual({ state: 'loading' });
    // Beads resolve first; mail is still pending, so still loading.
    await waitFor(() => expect(result.current.beadSnapshot).toBeDefined());
    expect(result.current.ownerReadiness).toEqual({ state: 'loading' });
    mail.resolve({ total: 0, items: [] });
    await waitFor(() => expect(result.current.ownerReadiness).toEqual({ state: 'ready' }));
  });

  it('decision queue failure is degraded with its reason', async () => {
    mockSupervisorApi.listBeads.mockImplementation((_city, query) =>
      query?.label === 'needs/stephanie'
        ? Promise.reject(new Error('boom'))
        : Promise.resolve({ total: 0, items: [] }),
    );
    mockSupervisorApi.listMail.mockRejectedValue(new Error('mail down'));
    const { result } = renderHook(() => useLiveAttentionContributors(operator, undefined));
    await waitFor(() =>
      expect(result.current.ownerReadiness).toEqual({
        state: 'degraded',
        reasons: ['Questions from the Mayor could not be read', 'Your mail could not be read'],
      }),
    );
  });

  it('beadSnapshot carries tasks and route items', async () => {
    mockSupervisorApi.listBeads.mockImplementation((_city, query) =>
      query?.label !== undefined
        ? Promise.resolve({ total: 0, items: [] })
        : Promise.resolve({ total: 3, items: [TASK, ROOT, STEP] }),
    );
    const { result } = renderHook(() => useLiveAttentionContributors(operator, undefined));
    await waitFor(() => expect(result.current.beadSnapshot).toBeDefined());
    const snapshot = result.current.beadSnapshot!;
    // withRoutes: the route root and step leave the task list.
    expect(snapshot.items.map((bead) => bead.id)).toEqual(['dw-1']);
    expect(snapshot.routeItems.map((bead) => bead.id).sort()).toEqual(['R-1', 'R-1.1']);
    expect(typeof snapshot.fetchedAt).toBe('string');
  });
});
