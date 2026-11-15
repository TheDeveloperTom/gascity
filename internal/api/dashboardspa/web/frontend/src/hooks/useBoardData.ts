import { useCallback, useMemo } from 'react';
import { GC_EVENT_PREFIX } from 'gas-city-dashboard-shared';
import { getActiveCity } from '../api/cityBase';
import type { BeadAttentionSession } from '../attention/beadsNeedingAttention';
import type { BoardData, RigPrefix } from '../lib/boardModel';
import { listSupervisorBeads, type SupervisorBeadList } from '../supervisor/beadReads';
import { listSupervisorRigs } from '../supervisor/rigReads';
import { listSupervisorSessions } from '../supervisor/sessionReads';
import { useCachedData } from './useCachedData';
import { useGcEventRefresh } from './useGcEvents';

// One board read for every owner page (dashboard v3, «one source per count»):
// Главная, «Задачи» and the debug pages read the same open-board window, the
// same rigs and the same sessions. Concurrent consumers share one request per
// source, and the cache key is the one /beads has always used, so a page swap
// seeds from the last read.

/** The board's closed window: the most recently closed tasks per rig. */
export const BOARD_RECENT_CLOSED_LIMIT = 100;
/** A busy city emits bead events every few seconds; one refetch per window. */
export const BOARD_REFRESH_COALESCE_MS = 10_000;

export interface BoardRead {
  data: BoardData | undefined;
  rigs: readonly RigPrefix[];
  sessions: readonly BeadAttentionSession[];
  loading: boolean;
  error: string | null;
  fetchedAt: string | undefined;
  refresh: () => Promise<void>;
}

const inflight = new Map<string, Promise<unknown>>();

/**
 * One request per key while it is in flight: a second consumer joins the
 * first's promise instead of starting its own. The caller's abort signal is
 * not passed on, so one consumer unmounting never cancels another's read.
 */
export function sharedRead<T>(key: string, fetch: () => Promise<T>): Promise<T> {
  const running = inflight.get(key);
  if (running !== undefined) return running as Promise<T>;
  const started = fetch().finally(() => {
    if (inflight.get(key) === started) inflight.delete(key);
  });
  inflight.set(key, started);
  return started;
}

export function boardCacheKey(city: string | null): string {
  return `beads:board:${city ?? 'no-city'}:open`;
}

export function sessionsCacheKey(city: string | null): string {
  return `sessions:${city ?? 'no-city'}`;
}

export function rigsCacheKey(city: string | null): string {
  return `rigs:${city ?? 'no-city'}`;
}

const EMPTY_RIGS: readonly RigPrefix[] = [];
const EMPTY_SESSIONS: readonly BeadAttentionSession[] = [];

/** A bead list read in the board's shape; null/undefined stays undefined. */
export function boardDataOf(list: SupervisorBeadList | null | undefined): BoardData | undefined {
  if (list === undefined || list === null) return undefined;
  return {
    items: list.items,
    routeItems: list.route_items ?? [],
    serviceItems: list.service_items ?? [],
    routesComplete: list.routes_complete ?? false,
    ...(list.upstream_total === undefined ? {} : { upstreamTotal: list.upstream_total }),
    upstreamFetched: list.upstream_fetched,
  };
}

export function useBoardData(): BoardRead {
  const city = getActiveCity();
  const boardKey = boardCacheKey(city);
  const sessionsKey = sessionsCacheKey(city);
  const rigsKey = rigsCacheKey(city);

  const board = useCachedData(boardKey, () =>
    sharedRead(boardKey, () =>
      listSupervisorBeads({
        withRoutes: true,
        recentClosed: { limit: BOARD_RECENT_CLOSED_LIMIT },
      }),
    ),
  );
  const sessions = useCachedData(sessionsKey, () =>
    sharedRead(sessionsKey, listSupervisorSessions),
  );
  const rigs = useCachedData(rigsKey, () => sharedRead(rigsKey, listSupervisorRigs));

  const refreshBoard = board.refresh;
  useGcEventRefresh([GC_EVENT_PREFIX.bead], () => void refreshBoard(), {
    coalesceMs: BOARD_REFRESH_COALESCE_MS,
  });

  const data = useMemo(() => boardDataOf(board.data), [board.data]);
  const rigItems = useMemo<readonly RigPrefix[]>(() => rigs.data?.items ?? EMPTY_RIGS, [rigs.data]);
  const sessionItems = useMemo<readonly BeadAttentionSession[]>(
    () => sessions.data?.items ?? EMPTY_SESSIONS,
    [sessions.data],
  );
  const refreshSessions = sessions.refresh;
  const refreshRigs = rigs.refresh;
  const refresh = useCallback(async () => {
    await Promise.all([refreshBoard(), refreshSessions(), refreshRigs()]);
  }, [refreshBoard, refreshSessions, refreshRigs]);

  return {
    data,
    rigs: rigItems,
    sessions: sessionItems,
    loading: board.loading,
    error: board.error,
    fetchedAt: board.fetchedAt,
    refresh,
  };
}
