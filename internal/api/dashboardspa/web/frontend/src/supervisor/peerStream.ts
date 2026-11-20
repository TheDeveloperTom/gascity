import { withApiBase } from '../lib/apiBase';
import { watchHiddenPause } from '../lib/hiddenPause';

// BOARD-LIVE L7 (contract C5, L12): our own peer-boards service streams
// `GET /v1/stream` — `event: changed` with `{v, at}` whenever any of its
// inputs change, and a `: hb` comment every 15 s (invisible here). The
// dashboard debounces a burst of `changed` by 200 ms and then reads
// `/v1/boards` once. Reconnects back off 1 s → 30 s. After 3 failed opens in
// a row, or when the stream is switched off (PEER_STREAM, the P12 fallback),
// it polls every 3 s instead; a later successful open stops the poll.
// 16.11: a REopen (after a drop) reads once, since a change made while the
// stream was down (e.g. the service restarting) sends no `changed` later.
// BOARD-CHAT D3 19.11 (HOST cause 5): a tab hidden for HIDDEN_PAUSE_MS closes
// the stream (HTTP/1.1 allows six connections per host across tabs) and
// reopens it when shown; that reopen reads once like any other.

export const PEER_STREAM_DEBOUNCE_MS = 200;
export const PEER_POLL_MS = 3_000;
export const FAILED_OPENS_BEFORE_POLL = 3;
const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

function streamFlag(): boolean {
  const v: unknown = (import.meta.env as unknown as Record<string, unknown>).VITE_PEER_STREAM;
  if (typeof v !== 'string') return true;
  const s = v.trim().toLowerCase();
  return !(s === '0' || s === 'false' || s === 'off');
}

/** The stream is on unless the build sets `VITE_PEER_STREAM=0` (P12 fallback). */
export const PEER_STREAM: boolean = streamFlag();

export function peerStreamUrl(city: string): string {
  return `/v0/city/${encodeURIComponent(city)}/svc/peer-boards/v1/stream`;
}

export interface PeerStreamOptions {
  /** Defaults to PEER_STREAM. */
  enabled?: boolean;
}

/** Follows the city's peer-boards stream; returns the unsubscribe. */
export function subscribePeerStream(
  city: string,
  onChanged: () => void,
  opts: PeerStreamOptions = {},
): () => void {
  let stopped = false;
  let source: EventSource | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let poll: ReturnType<typeof setInterval> | null = null;
  let delay = BACKOFF_MIN_MS;
  let failedOpens = 0;
  let everOpened = false;
  // review of PR #5: the first open after a resume reads, even if none opened before
  let readOnOpen = false;

  const startPoll = () => {
    if (poll !== null) return;
    poll = setInterval(() => {
      if (typeof document === 'undefined' || !document.hidden) onChanged();
    }, PEER_POLL_MS);
  };
  const stopPoll = () => {
    if (poll === null) return;
    clearInterval(poll);
    poll = null;
  };
  const changed = () => {
    if (debounce !== null) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      if (!stopped) onChanged();
    }, PEER_STREAM_DEBOUNCE_MS);
  };

  const connect = () => {
    if (stopped) return;
    const Ctor = globalThis.EventSource;
    if (typeof Ctor !== 'function') {
      startPoll();
      return;
    }
    const es = new Ctor(withApiBase(peerStreamUrl(city)));
    source = es;
    let opened = false;
    es.onopen = () => {
      if (stopped || source !== es) return;
      opened = true;
      failedOpens = 0;
      delay = BACKOFF_MIN_MS;
      stopPoll();
      if (everOpened || readOnOpen) changed();
      everOpened = true;
      readOnOpen = false;
    };
    es.addEventListener('changed', changed as EventListener);
    es.onerror = () => {
      if (stopped || source !== es) return;
      es.close();
      source = null;
      if (!opened) {
        failedOpens += 1;
        if (failedOpens >= FAILED_OPENS_BEFORE_POLL) startPoll();
      }
      const wait = delay;
      delay = Math.min(delay * 2, BACKOFF_MAX_MS);
      retry = setTimeout(() => {
        retry = null;
        connect();
      }, wait);
    };
  };

  const enabled = opts.enabled ?? PEER_STREAM;
  if (enabled) connect();
  else startPoll();

  const stopWatch = enabled
    ? watchHiddenPause({
        pause: () => {
          if (stopped) return;
          const es = source;
          source = null;
          es?.close();
          if (retry !== null) clearTimeout(retry);
          retry = null;
          if (debounce !== null) clearTimeout(debounce);
          debounce = null;
          stopPoll();
        },
        resume: () => {
          if (stopped || source !== null) return;
          delay = BACKOFF_MIN_MS;
          failedOpens = 0;
          readOnOpen = true;
          connect();
        },
      })
    : () => {};

  return () => {
    stopped = true;
    stopWatch();
    source?.close();
    source = null;
    if (debounce !== null) clearTimeout(debounce);
    if (retry !== null) clearTimeout(retry);
    stopPoll();
  };
}
