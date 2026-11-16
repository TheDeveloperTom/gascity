import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { getActiveCity } from '../api/cityBase';
import { useNowOrNull } from '../contexts/NowContext';
import { peerSourcesOf, type PeerBoardSource } from '../lib/boardOwner';
import { setCityMayorUrl } from '../lib/mayorLink';
import { listPeerBoards, type PeerBoardsResult } from '../supervisor/peerBoardReads';
import { subscribePeerStream } from '../supervisor/peerStream';

// vk-final: the peers' boards as board sources. ONE shared reader for every
// consumer (board, «Нужно от меня», the badge). BOARD-LIVE L7: it follows our
// peer-boards service's change stream (supervisor/peerStream: `changed` →
// one GET after 200 ms; 3 s polling when the stream cannot open), one
// EventSource for the whole page. A write calls refreshPeerBoards() so its
// result shows at once.

const STALE_STEP_MS = 15_000;

// 16.11 (Richard's page): a failed read retries by itself, 5 s → 30 s, until
// one succeeds, so a page opened while the service restarted recovers
// without a reload. A good read resets the backoff.
export const PEER_RETRY_MIN_MS = 5_000;
export const PEER_RETRY_MAX_MS = 30_000;

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
let stream: { city: string; stop: () => void } | null = null;
let inflight: Promise<void> | null = null;
let controller: AbortController | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = PEER_RETRY_MIN_MS;

function clearRetry(): void {
  if (retryTimer !== null) clearTimeout(retryTimer);
  retryTimer = null;
}

function scheduleRetry(): void {
  if (retryTimer !== null || listeners.size === 0) return;
  const wait = retryDelay;
  retryDelay = Math.min(retryDelay * 2, PEER_RETRY_MAX_MS);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (listeners.size > 0) void read();
  }, wait);
}

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
        if (signal.aborted) return;
        // owner 16.11: the city's Mayor channel for every «Обсудить» button
        setCityMayorUrl(result.mayorUrl);
        clearRetry();
        retryDelay = PEER_RETRY_MIN_MS;
        emit({ city, result, error: null });
      },
      (err: unknown) => {
        if (signal.aborted) return;
        const error = err instanceof Error ? err.message : String(err);
        // Keep the last good boards; say the read failed.
        emit({ city, result: snapshot.city === city ? snapshot.result : null, error });
        scheduleRetry();
      },
    )
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** (Re)opens the change stream for the active city; one per page. */
function ensureStream(): void {
  const city = getActiveCity();
  if (stream !== null && stream.city === city) return;
  stopStream();
  if (city === null) return;
  stream = { city, stop: subscribePeerStream(city, () => void read()) };
}

function stopStream(): void {
  stream?.stop();
  stream = null;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  if (listeners.size === 1) {
    void read();
    ensureStream();
  }
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0) {
      stopStream();
      clearRetry();
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
  stopStream();
  clearRetry();
  retryDelay = PEER_RETRY_MIN_MS;
  listeners.clear();
  snapshot = { city: null, result: null, error: null };
}

const NONE: readonly PeerBoardSource[] = [];

export function usePeerBoards(): PeerBoardsState {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const city = getActiveCity();
  // A city switch: drop the other city's boards and read this one's.
  useEffect(() => {
    if (snap.city !== null && snap.city !== city) {
      ensureStream();
      void refreshPeerBoards();
    }
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

/**
 * The active city's raw result only (null until it answers). Unlike
 * usePeerBoards it does not follow the app tick, so many cards can use it.
 */
export function usePeerBoardsResult(): PeerBoardsResult | null {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return snap.city === getActiveCity() ? snap.result : null;
}

/** How long a page waits for the peer boards before drawing what sits under their lines. */
export const PEER_SETTLE_CAP_MS = 3_000;

/**
 * H1 16.11: true once the peer boards have answered (a result or an error)
 * for the active city, or once `capMs` has passed since mount, whichever is
 * first. «Нужно от меня» holds its lower part until then, so the Mayors'
 * questions do not push it down when they land; the cap keeps a hanging
 * peer read (seen live) from holding the page.
 */
export function usePeerBoardsSettled(capMs: number): boolean {
  const { result, error } = usePeerBoards();
  const answered = result !== null || error !== null;
  const [capped, setCapped] = useState(false);
  useEffect(() => {
    if (answered) return;
    const timer = setTimeout(() => setCapped(true), capMs);
    return () => clearTimeout(timer);
  }, [answered, capMs]);
  return answered || capped;
}
