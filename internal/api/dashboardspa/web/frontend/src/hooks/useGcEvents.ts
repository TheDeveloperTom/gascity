import { useEffect, useRef, useState } from 'react';
import { reportClientError } from '../lib/clientErrorReporting';
import { getActiveCity } from '../api/cityBase';
import { watchHiddenPause } from '../lib/hiddenPause';
import { supervisorApi } from '../supervisor/client';
import { isEmbedded } from '../embed/mode';
import { subscribeEmbedTick } from '../embed/poll';

// Owner 16.11: the Discord Activity is gone, so the stream is the one live
// path everywhere; failed opens reconnect with capped backoff and nothing
// polls behind them.

// gascity-dashboard-iew: EventSource against the supervisor's `/v0/...` event
// stream on the current origin. The gc supervisor serves the SPA and the typed
// API same-origin, so the EventSource URL resolves against `location.origin`
// with no transport proxy. The dashboard no longer owns or parses city event
// DTOs.

export type GcEventConnState = 'connecting' | 'open' | 'degraded' | 'closed';
export type GcEventEnvelope = {
  type: string;
  run_id?: string;
  root_bead_id?: string;
  run?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  bead?: Record<string, unknown>;
  root?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
};

export interface GcEventRefreshOptions {
  matches?: (event: GcEventEnvelope) => boolean;
  /**
   * Trailing-throttle window for event-driven refreshes. A burst of matching
   * events yields at most one onMatch per window (leading + trailing). Defaults
   * to {@link DEFAULT_COALESCE_MS}; widen it for consumers whose refresh is an
   * expensive full refetch (e.g. the beads board's ~1.3MB list) so normal city
   * churn and supervisor latency spikes don't trigger a refetch per event.
   */
  coalesceMs?: number;
}

const CONNECTING_GRACE_MS = 2_000;
const DEFAULT_COALESCE_MS = 2_500;

/**
 * Session events that observe a session without changing it: the
 * program-status shadow records a comparison at every decision point, often
 * several a second city-wide. The dashboard BFF skips them when it refreshes
 * sessions too (sessionObservationEvents).
 */
const SESSION_OBSERVATION_EVENT_TYPES: ReadonlySet<string> = new Set([
  'session.program_status_shadow',
]);

/**
 * Reports whether event only observes a session. A view that refetches when
 * its sessions change skips it: refetching would change nothing the view
 * shows.
 */
export function isSessionObservation(event: GcEventEnvelope): boolean {
  return SESSION_OBSERVATION_EVENT_TYPES.has(event.type);
}

/**
 * Subscribe to gc events. When an event whose type starts with any of
 * `prefixes` arrives, `onMatch` is invoked. Designed for "refresh this
 * panel when its underlying data changed" — pass refresh().
 */
export function useGcEventRefresh(
  prefixes: ReadonlyArray<string>,
  onMatch: () => void,
  options: GcEventRefreshOptions = {},
): GcEventConnState {
  const [state, setState] = useState<GcEventConnState>('connecting');
  const onMatchRef = useRef(onMatch);
  onMatchRef.current = onMatch;
  const matchesRef = useRef(options.matches);
  matchesRef.current = options.matches;
  const coalesceMsRef = useRef(options.coalesceMs);
  coalesceMsRef.current = options.coalesceMs;
  // Stable hash of prefixes for the effect dep array.
  const prefixKey = prefixes.join(',');

  // gascity-dashboard-0sh (ported from upstream cd-tle7m): coalesce
  // event-driven refetches. A busy city emits many bead.*/session.*
  // events per second; firing onMatch per-event made consumers (e.g. the
  // Kanban) refetch /beads ungated (~1/sec), which both hammered the
  // supervisor's city-store read AND amplified its partial-read flicker
  // (td- beads vanish/reappear). Throttle to at most one onMatch per
  // coalesce window (leading + trailing): a burst yields one refetch now
  // and one after it settles, never a per-event storm. Consumers with an
  // expensive refresh widen the window via options.coalesceMs.
  const lastFireRef = useRef(0);
  const coalesceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (prefixes.length === 0) {
      setState('closed');
      return;
    }
    if (isEmbedded()) {
      // Discord mode (DESIGN-discord-activity-return §4.3): the Activity
      // gateway serves no event streams to the page, so the consumer's own
      // refresh runs on the page's one shared ticker (embed/poll.ts, 15 s,
      // visible only).
      setState('open');
      return subscribeEmbedTick(() => onMatchRef.current());
    }

    let cancelled = false;
    let connectGraceTimer: ReturnType<typeof setTimeout> | null = null;
    let malformedEventReported = false;

    const clearConnectGraceTimer = () => {
      if (connectGraceTimer === null) return;
      clearTimeout(connectGraceTimer);
      connectGraceTimer = null;
    };
    const reportMalformedEventOnce = (reason: string) => {
      if (malformedEventReported) return;
      malformedEventReported = true;
      reportMalformedEvent(reason);
    };
    const fireMatch = () => {
      lastFireRef.current = Date.now();
      onMatchRef.current();
    };
    // Leading + trailing throttle: fire immediately when outside the
    // window, otherwise schedule a single trailing fire at the window
    // edge. Coalesces a burst of matching events into <=1 onMatch per
    // coalesce window.
    const scheduleMatch = () => {
      const coalesceMs = coalesceMsRef.current ?? DEFAULT_COALESCE_MS;
      const elapsed = Date.now() - lastFireRef.current;
      if (elapsed >= coalesceMs) {
        if (coalesceTimerRef.current) {
          clearTimeout(coalesceTimerRef.current);
          coalesceTimerRef.current = null;
        }
        fireMatch();
      } else if (coalesceTimerRef.current === null) {
        coalesceTimerRef.current = setTimeout(() => {
          coalesceTimerRef.current = null;
          if (!cancelled) fireMatch();
        }, coalesceMs - elapsed);
      }
    };

    const EventSourceCtor = globalThis.EventSource;
    const cityName = getActiveCity();
    if (typeof EventSourceCtor !== 'function' || cityName === null) {
      setState('closed');
      return;
    }

    let currentSource: EventSource | null = null;
    // gc supervisor sends events with `event: event` (the event NAME is
    // literally "event"), not the default "message"; the shared stream routes
    // both to here.
    const handleData = (msg: MessageEvent<string>) => {
      if (cancelled) return;
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(msg.data);
      } catch {
        setState('degraded');
        reportMalformedEventOnce('invalid JSON');
        return;
      }
      if (!isRecord(parsed)) {
        setState('degraded');
        reportMalformedEventOnce('missing string event type');
        return;
      }
      const t = parsed.type;
      if (typeof t !== 'string') {
        setState('degraded');
        reportMalformedEventOnce('missing string event type');
        return;
      }
      setState('open');
      for (const prefix of prefixes) {
        if (t.startsWith(prefix)) {
          const event = parsed as GcEventEnvelope;
          if (matchesRef.current?.(event) ?? true) scheduleMatch();
          break;
        }
      }
    };

    const unsubscribe = subscribeSharedStream(
      EventSourceCtor,
      supervisorApi().cityEventStreamUrl(cityName),
      {
        connecting: (source) => {
          if (cancelled) return;
          currentSource = source;
          clearConnectGraceTimer();
          setState('connecting');
          // A quiet supervisor stream must not show «connecting» forever.
          connectGraceTimer = setTimeout(() => {
            if (
              cancelled ||
              currentSource !== source ||
              source.readyState === EventSourceCtor.CLOSED
            )
              return;
            setState('open');
          }, CONNECTING_GRACE_MS);
        },
        open: () => {
          if (cancelled) return;
          clearConnectGraceTimer();
          setState('open');
        },
        data: handleData,
        // a stream reopened after its tab was hidden missed events: read once
        resync: () => {
          if (!cancelled) scheduleMatch();
        },
        error: () => {
          if (cancelled) return;
          clearConnectGraceTimer();
          currentSource = null;
          setState('closed');
        },
      },
    );

    return () => {
      cancelled = true;
      clearConnectGraceTimer();
      if (coalesceTimerRef.current) {
        clearTimeout(coalesceTimerRef.current);
        coalesceTimerRef.current = null;
      }
      unsubscribe();
    };
    // We re-bind only when the prefix set changes — onMatch is captured in a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefixKey]);

  return state;
}

// H1 16.11: one EventSource per stream URL, shared by every subscriber.
// Each useGcEventRefresh used to open its own, so a board tab held three
// identical /events/stream connections; with Chrome's six HTTP/1.1
// connections per host a second dashboard tab (or the PWA beside a tab)
// could not start a single request. The shared stream reconnects once for
// everyone with capped exponential backoff and closes after the last
// subscriber leaves.
interface StreamSubscriber {
  connecting: (source: EventSource) => void;
  open: () => void;
  data: (msg: MessageEvent<string>) => void;
  error: () => void;
  resync: () => void;
}

interface SharedStream {
  subscribers: Set<StreamSubscriber>;
  source: EventSource | null;
  retryTimer: ReturnType<typeof setTimeout> | null;
  retryDelayMs: number;
  /** HOST cause 5: closed while the tab is hidden; the first open after it resyncs. */
  paused: boolean;
  resyncOnOpen: boolean;
  /**
   * Review of PR #5: the id (event seq) of the last frame seen. A reopen
   * resumes after it (after_seq), so the server replays what was sent while
   * the stream was closed, and every listener's side effects see it.
   */
  lastEventId: string | null;
  stopWatch: () => void;
}

const sharedStreams = new Map<string, SharedStream>();

function subscribeSharedStream(
  EventSourceCtor: typeof EventSource,
  url: string,
  subscriber: StreamSubscriber,
): () => void {
  let stream = sharedStreams.get(url);
  if (stream === undefined) {
    const created: SharedStream = {
      subscribers: new Set(),
      source: null,
      retryTimer: null,
      retryDelayMs: 1_000,
      paused: false,
      resyncOnOpen: false,
      lastEventId: null,
      stopWatch: () => {},
    };
    sharedStreams.set(url, created);
    stream = created;
    stream.subscribers.add(subscriber);
    openSharedStream(EventSourceCtor, url, created);
    created.stopWatch = watchHiddenPause({
      pause: () => {
        created.paused = true;
        if (created.retryTimer !== null) clearTimeout(created.retryTimer);
        created.retryTimer = null;
        const source = created.source;
        created.source = null;
        source?.close();
        for (const sub of [...created.subscribers]) sub.error();
      },
      resume: () => {
        created.paused = false;
        // with no sequence to resume from, the gap cannot be replayed: read once
        created.resyncOnOpen = created.lastEventId === null;
        created.retryDelayMs = 1_000;
        if (created.subscribers.size > 0 && created.source === null) openSharedStream(EventSourceCtor, url, created);
      },
    });
  } else {
    stream.subscribers.add(subscriber);
    const source = stream.source;
    if (source === null) subscriber.error();
    else if (source.readyState === EventSourceCtor.OPEN) subscriber.open();
    else subscriber.connecting(source);
  }
  const joined = stream;
  return () => {
    joined.subscribers.delete(subscriber);
    if (joined.subscribers.size > 0) return;
    joined.stopWatch();
    if (joined.retryTimer !== null) clearTimeout(joined.retryTimer);
    joined.retryTimer = null;
    joined.source?.close();
    joined.source = null;
    if (sharedStreams.get(url) === joined) sharedStreams.delete(url);
  };
}

function openSharedStream(
  EventSourceCtor: typeof EventSource,
  url: string,
  stream: SharedStream,
): void {
  // The browser sends Last-Event-ID automatically on reconnect; the
  // supervisor event stream accepts that header directly.
  const source = new EventSourceCtor(stream.lastEventId === null ? url : resumeUrl(url, stream.lastEventId));
  stream.source = source;
  for (const sub of [...stream.subscribers]) sub.connecting(source);
  source.onopen = () => {
    if (stream.source !== source) return;
    stream.retryDelayMs = 1_000;
    for (const sub of [...stream.subscribers]) sub.open();
    if (stream.resyncOnOpen) {
      stream.resyncOnOpen = false;
      for (const sub of [...stream.subscribers]) sub.resync();
    }
  };
  const dispatch = (msg: MessageEvent<string>) => {
    if (stream.source !== source) return;
    if (msg.lastEventId) stream.lastEventId = msg.lastEventId;
    for (const sub of [...stream.subscribers]) sub.data(msg);
  };
  source.onmessage = dispatch;
  source.addEventListener('event', dispatch as EventListener);
  source.onerror = () => {
    if (stream.source !== source) return;
    source.close();
    stream.source = null;
    for (const sub of [...stream.subscribers]) sub.error();
    if (stream.subscribers.size === 0 || stream.paused) return;
    // Exponential backoff capped at 30s.
    stream.retryTimer = setTimeout(() => {
      stream.retryTimer = null;
      stream.retryDelayMs = Math.min(stream.retryDelayMs * 2, 30_000);
      if (stream.subscribers.size > 0 && !stream.paused) openSharedStream(EventSourceCtor, url, stream);
    }, stream.retryDelayMs);
  };
}

/** The stream URL resuming after seq (the supervisor's `after_seq`, strictly greater). */
function resumeUrl(url: string, seq: string): string {
  const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
  const resumed = new URL(url, base);
  resumed.searchParams.set('after_seq', seq);
  return resumed.toString();
}

function reportMalformedEvent(reason: string): void {
  void reportClientError({
    component: 'gc-events',
    operation: 'parse event',
    message: `Malformed gc event payload: ${reason}.`,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
