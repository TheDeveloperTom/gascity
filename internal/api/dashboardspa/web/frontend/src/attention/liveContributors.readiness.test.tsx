import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidate } from '../api/cache';
import { setActiveCity } from '../api/cityBase';
import type { OperatorConfig } from '../contexts/OperatorConfigContext';
import type * as SupervisorClient from '../supervisor/client';
import type { RunSummary, SourceState } from 'gas-city-dashboard-shared';
import { composeAttention } from './compose';
import { deriveCityReadiness, useLiveAttentionContributors } from './liveContributors';

function freshRuns(): SourceState<RunSummary> {
  return {
    source: 'runs',
    status: 'fresh',
    fetchedAt: '2026-06-01T00:00:00.000Z',
    staleAt: '2026-06-01T00:01:00.000Z',
    error: { kind: 'none' },
    data: {
      totalActive: 0,
      totalHistorical: 0,
      historicalLanes: [],
      blockedLanes: [],
      runCounts: {
        total: 0,
        visible: 0,
        prReview: 0,
        designReview: 0,
        bugfix: 0,
        blocked: 0,
        other: 0,
      },
      lanes: [],
      recentChanges: [],
      census: { status: 'unavailable', error: 'n/a' },
    },
  } as SourceState<RunSummary>;
}

describe('composeAttention city readiness', () => {
  it('carries the city readiness it is given, ready by default', () => {
    expect(composeAttention([]).cityReadiness).toEqual({ state: 'ready' });
    expect(composeAttention([], { cityReadiness: { state: 'loading' } }).cityReadiness).toEqual({
      state: 'loading',
    });
  });
});

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

  // Dashboard v3: the owner slice is owner questions only, so its readiness
  // waits on the decision queue and never on mail.
  it('loading until decisions resolve; mail does not hold it', async () => {
    const mail = deferred<unknown>();
    mockSupervisorApi.listMail.mockReturnValue(mail.promise);
    const { result } = renderHook(() => useLiveAttentionContributors(operator, undefined));
    expect(result.current.ownerReadiness).toEqual({ state: 'loading' });
    await waitFor(() => expect(result.current.ownerReadiness).toEqual({ state: 'ready' }));
    mail.resolve({ total: 0, items: [] });
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
        reasons: ['Questions from the Mayor could not be read'],
      }),
    );
  });

  it('city readiness is loading until every city source has been read', async () => {
    const agents = deferred<unknown>();
    mockSupervisorApi.listAgents.mockReturnValue(agents.promise);
    const { result } = renderHook(() => useLiveAttentionContributors(operator, freshRuns()));
    expect(result.current.cityReadiness).toEqual({ state: 'loading' });
    await waitFor(() => expect(result.current.ownerReadiness.state).not.toBe('loading'));
    expect(result.current.cityReadiness).toEqual({ state: 'loading' });
    agents.resolve({ total: 0, items: [] });
    // systemHealth and doltTrend reject in beforeEach: health is degraded.
    await waitFor(() =>
      expect(result.current.cityReadiness).toEqual({
        state: 'degraded',
        reasons: ['City health could not be read'],
      }),
    );
  });

  it('city readiness waits for the runs source', async () => {
    const { result } = renderHook(() => useLiveAttentionContributors(operator, undefined));
    await waitFor(() => expect(result.current.beadSnapshot).toBeDefined());
    expect(result.current.cityReadiness).toEqual({ state: 'loading' });
  });

  it('city readiness is ready when every city source was read', () => {
    expect(
      deriveCityReadiness({
        agents: { items: [] },
        beads: { decisionLabel: 'x', items: [] },
        activity: { events: [] },
        health: { supervisor: { status: 'available', data: { status: 'ok' } as never } },
        runs: { provenance: 'fresh' },
      }),
    ).toEqual({ state: 'ready' });
    expect(
      deriveCityReadiness({
        agents: { error: 'x' },
        beads: { decisionLabel: 'x', error: 'y' },
        activity: { eventsError: 'z' },
        health: {},
        runs: { error: 'r' },
      }),
    ).toEqual({
      state: 'degraded',
      reasons: [
        'Agents could not be read',
        'Tasks could not be read',
        'Runs could not be read',
        'Events could not be read',
      ],
    });
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
