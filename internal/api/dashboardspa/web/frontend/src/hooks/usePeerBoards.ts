import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { getActiveCity } from '../api/cityBase';
import { useNowOrNull } from '../contexts/NowContext';
import { peerSourcesOf, type PeerBoardSource } from '../lib/boardOwner';
import { listPeerBoards, type PeerBoardsResult } from '../supervisor/peerBoardReads';

// vk-final: the peers' boards as board sources. ONE shared poller for every
// consumer (board, «Нужно от меня», the badge): a plain GET every 30 s while
// the page is visible (the city syncs in ~30–60 s). No event stream, so it
// never takes one of the browser's six connections. A write calls
// refreshPeerBoards() so its result shows at once.

export const PEER_BOARDS_POLL_MS = 30_000;
const STALE_STEP_MS = 15_000;

export interface PeerBoardsState {
  sources: readonly PeerBoardSource[];
  /** The service answered with something that is not its contract. */
  error: string | null;
  /** The raw result (threads and topics for the comments UI). */
  result: PeerBoardsResult | null;
}

interface Snapshot {
  city: string | null;
  result: PeerBoardsResult | null;
  error: string | null;
}

let snapshot: Snapshot = { city: null, result: null, error: null };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let inflight: Promise<void> | null = null;
let controller: AbortController | null = null;

function emit(next: Snapshot): void {
  snapshot = next;
  listeners.forEach((fn) => fn());
}

function read(): Promise<void> {
  if (inflight !== null) return inflight;
  const city = getActiveCity();
  controller = new AbortController();
  const signal = controller.signal;
  inflight = listPeerBoards(signal)
    .then(
      (result) => {
        if (!signal.aborted) emit({ city, result, error: null });
      },
      (err: unknown) => {
        if (signal.aborted) return;
        const error = err instanceof Error ? err.message : String(err);
        // Keep the last good boards; say the read failed.
        emit({ city, result: snapshot.city === city ? snapshot.result : null, error });
      },
    )
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  if (listeners.size === 1) {
    void read();
    timer = setInterval(() => {
      if (typeof document === 'undefined' || !document.hidden) void read();
    }, PEER_BOARDS_POLL_MS);
  }
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const getSnapshot = () => snapshot;

/** Reads the peer boards now (after a comment or topic write). */
export function refreshPeerBoards(): Promise<void> {
  if (inflight !== null) {
    // A read that started before the write may miss it: read once more after it.
    return inflight.then(() => read());
  }
  return read();
}

/** Test-only: forget the shared state and stop the poller. */
export function resetPeerBoardsForTests(): void {
  controller?.abort();
  controller = null;
  inflight = null;
  if (timer !== null) clearInterval(timer);
  timer = null;
  listeners.clear();
  snapshot = { city: null, result: null, error: null };
}

const NONE: readonly PeerBoardSource[] = [];

export function usePeerBoards(): PeerBoardsState {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const city = getActiveCity();
  // A city switch: drop the other city's boards and read this one's.
  useEffect(() => {
    if (snap.city !== null && snap.city !== city) void refreshPeerBoards();
  }, [snap.city, city]);
  // Staleness moves in 15 s steps, so the 1 s app tick never rebuilds the
  // board model; the sources keep their identity between steps.
  const tick = useNowOrNull() ?? Date.now();
  const bucket = Math.floor(tick / STALE_STEP_MS);
  const result = snap.city === city ? snap.result : null;
  const sources = useMemo(
    () => (result === null ? NONE : peerSourcesOf(result, bucket * STALE_STEP_MS)),
    [result, bucket],
  );
  return { sources, error: snap.city === city ? snap.error : null, result };
}
