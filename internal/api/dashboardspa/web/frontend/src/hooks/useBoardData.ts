import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { GC_EVENT_PREFIX } from 'gas-city-dashboard-shared';
import { getActiveCity } from '../api/cityBase';
import type { BeadAttentionSession } from '../attention/beadsNeedingAttention';
import type { BoardData, RigPrefix } from '../lib/boardModel';
import { ownerAskedOf, ownerBeadsOf, type OwnerAsked } from '../lib/ownerAsked';
import { listSupervisorBeads, type SupervisorBead, type SupervisorBeadList } from '../supervisor/beadReads';
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
  /** The open board, with each rig's open work store in `rigStoreItems` once it is in. */
  data: BoardData | undefined;
  /**
   * The one owner model (lib/ownerAsked), computed once from the raw read
   * (ownerBeadsOf(data)) before any view filters it: the shelf, the badge and
   * both graphs read it (REVIEW 16.11).
   */
  owner?: OwnerAsked | undefined;
  /** Every rig store has been read (the graphs are partial until then). */
  rigStoresIn?: boolean;
  rigs: readonly RigPrefix[];
  sessions: readonly BeadAttentionSession[];
  loading: boolean;
  error: string | null;
  fetchedAt: string | undefined;
  refresh: () => Promise<void>;
}

const inflight = new Map<string, { promise: Promise<unknown>; startedAt: number }>();
/** Fresh reads asked within this window of a read's start still join it. */
const FRESH_JOIN_MS = 250;

/**
 * One request per key while it is in flight: a second consumer joins the
 * first's promise instead of starting its own. A `fresh` read (an explicit
 * refresh, e.g. after a write) joins only a read that started within
 * FRESH_JOIN_MS, so it never lands on a read begun before the write (review
 * M4). The caller's abort signal is not passed on, so one consumer unmounting
 * never cancels another's read; an orphaned read simply finishes.
 */
export function sharedRead<T>(
  key: string,
  fetch: () => Promise<T>,
  options: { fresh?: boolean } = {},
): Promise<T> {
  const now = Date.now();
  const running = inflight.get(key);
  if (
    running !== undefined &&
    (options.fresh !== true || now - running.startedAt <= FRESH_JOIN_MS)
  ) {
    return running.promise as Promise<T>;
  }
  const promise: Promise<T> = fetch().finally(() => {
    if (inflight.get(key)?.promise === promise) inflight.delete(key);
  });
  inflight.set(key, { promise, startedAt: now });
  return promise;
}

export function boardCacheKey(city: string | null): string {
  return `beads:board:${city ?? 'no-city'}:open`;
}

export function sessionsCacheKey(city: string | null): string {
  return `sessions:${city ?? 'no-city'}`;
}

export function rigStoresCacheKey(city: string | null, rigs: readonly string[]): string {
  return `beads:board:${city ?? 'no-city'}:rig-stores:${rigs.join(',')}`;
}

/**
 * One rig's open work store, one request while it is in flight: the board
 * read's rig stores (owner model, graphs) and the Beads page's fast first
 * paint read the same store (BOARD-LOAD × REVIEW 16.11). Its own Live
 * in-progress leg runs only when the rig window may be incomplete: the board
 * read's city-wide leg covers every rig, and ownerBeadsOf puts the board's
 * rows first.
 */
export function readRigStore(
  rig: string,
  options: { fresh?: boolean } = {},
): Promise<SupervisorBeadList> {
  return sharedRead(
    `beads:rig-store:${getActiveCity() ?? 'no-city'}:${rig}`,
    () => listSupervisorBeads({ rigFilter: rig, inProgressLeg: 'when-truncated' }),
    options,
  );
}

/** Each rig's own open work store, merged (a failed leg reads as empty). */
export function readRigStores(
  rigs: readonly string[],
  options: { fresh?: boolean } = {},
): Promise<SupervisorBead[]> {
  return Promise.all(
    rigs.map((rig) =>
      readRigStore(rig, options)
        .then((list) => list.items)
        .catch(() => [] as SupervisorBead[]),
    ),
  ).then((legs) => legs.flat());
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

// One bead-event stream for every board consumer (vk integration). The page,
// TopNav and BottomTabs («Нужно от меня» badge), the drawer and ⌘K each read
// the board; one EventSource apiece used up Chrome's six HTTP/1.1 connections
// per host and stalled every other request. The first mounted consumer leads:
// only it subscribes, and a matching event refreshes every consumer (the
// shared read dedupes their fetches into one request). When the leader
// unmounts, the next consumer takes the stream.
const boardRefreshers = new Map<symbol, () => void>();
let boardLeader: symbol | null = null;
const leaderListeners = new Set<() => void>();
function setBoardLeader(next: symbol | null): void {
  boardLeader = next;
  leaderListeners.forEach((fn) => fn());
}
function subscribeLeader(fn: () => void): () => void {
  leaderListeners.add(fn);
  return () => leaderListeners.delete(fn);
}
const getBoardLeader = () => boardLeader;
function refreshAllBoardConsumers(): void {
  boardRefreshers.forEach((refresh) => refresh());
}

export function useBoardData(): BoardRead {
  const city = getActiveCity();
  const boardKey = boardCacheKey(city);
  const sessionsKey = sessionsCacheKey(city);
  const rigsKey = rigsCacheKey(city);

  // The closed legs need the rig names; they join this hook's own /rigs read
  // in flight rather than sending a second /rigs beside it (BOARD-LOAD 16.11).
  const readRigNames = () =>
    sharedRead(rigsKey, listSupervisorRigs).then((list) => list.items.map((rig) => rig.name));
  const readBoard = () =>
    listSupervisorBeads({
      withRoutes: true,
      recentClosed: { limit: BOARD_RECENT_CLOSED_LIMIT, rigNames: readRigNames },
    });
  const board = useCachedData(boardKey, () => sharedRead(boardKey, readBoard), {
    refreshFetcher: () => sharedRead(boardKey, readBoard, { fresh: true }),
  });
  const sessions = useCachedData(
    sessionsKey,
    () => sharedRead(sessionsKey, listSupervisorSessions),
    {
      refreshFetcher: () => sharedRead(sessionsKey, listSupervisorSessions, { fresh: true }),
    },
  );
  const rigs = useCachedData(rigsKey, () => sharedRead(rigsKey, listSupervisorRigs), {
    refreshFetcher: () => sharedRead(rigsKey, listSupervisorRigs, { fresh: true }),
  });

  // REVIEW 16.11: the unscoped window can miss a rig's tasks, so the board
  // read also takes each rig's own open work store (the graph read them on
  // its own before; now every page counts from the same set).
  const rigNames = useMemo(
    () => [...new Set((rigs.data?.items ?? []).map((rig) => rig.name).filter((name) => name.length > 0))].sort(),
    [rigs.data],
  );
  // Until the rig list is in, the stores wait (a pending key that never
  // resolves): data from an empty rig list must not read as «every store in».
  const rigsKnown = rigs.data !== undefined;
  const rigStoresKey = rigsKnown ? rigStoresCacheKey(city, rigNames) : `${rigStoresCacheKey(city, [])}pending`;
  const readStores = (fresh: boolean): Promise<SupervisorBead[]> =>
    !rigsKnown
      ? new Promise<SupervisorBead[]>(() => undefined)
      : rigNames.length === 0
        ? Promise.resolve([] as SupervisorBead[])
        : sharedRead(rigStoresKey, () => readRigStores(rigNames, { fresh }), { fresh });
  const rigStores = useCachedData(rigStoresKey, () => readStores(false), {
    refreshFetcher: () => readStores(true),
  });
  const refreshRigStores = rigStores.refresh;
  const refreshBoardOnly = board.refresh;
  const refreshBoard = useCallback(async () => {
    await Promise.all([refreshBoardOnly(), refreshRigStores()]);
  }, [refreshBoardOnly, refreshRigStores]);
  const [token] = useState(() => Symbol('board-consumer'));
  const refreshRef = useRef(refreshBoard);
  refreshRef.current = refreshBoard;
  useEffect(() => {
    boardRefreshers.set(token, () => void refreshRef.current());
    if (boardLeader === null) setBoardLeader(token);
    return () => {
      boardRefreshers.delete(token);
      if (boardLeader === token) {
        const next = boardRefreshers.keys().next();
        setBoardLeader(next.done === true ? null : next.value);
      }
    };
  }, [token]);
  const leads = useSyncExternalStore(subscribeLeader, getBoardLeader, getBoardLeader) === token;
  useGcEventRefresh(leads ? [GC_EVENT_PREFIX.bead] : [], refreshAllBoardConsumers, {
    coalesceMs: BOARD_REFRESH_COALESCE_MS,
  });

  const data = useMemo(() => {
    const base = boardDataOf(board.data);
    return base === undefined || rigStores.data === undefined ? base : { ...base, rigStoreItems: rigStores.data };
  }, [board.data, rigStores.data]);
  const owner = useMemo(() => (data === undefined ? undefined : ownerAskedOf(ownerBeadsOf(data))), [data]);
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
    owner,
    // In only once the rig list is known and its stores are read for it.
    rigStoresIn: rigs.data !== undefined && rigStores.data !== undefined && !rigStores.loading,
    rigs: rigItems,
    sessions: sessionItems,
    loading: board.loading,
    error: board.error,
    fetchedAt: board.fetchedAt,
    refresh,
  };
}
