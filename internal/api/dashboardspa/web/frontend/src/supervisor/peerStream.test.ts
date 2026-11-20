import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { PEER_RETRY_MAX_MS, PEER_RETRY_MIN_MS, resetPeerBoardsForTests, usePeerBoards } from '../hooks/usePeerBoards';
import { boardSourcesOf, ownerChoicesEnabled } from '../lib/boardOwner';
import { peerBody } from '../test/fixtures/peerBoards';
import { HIDDEN_PAUSE_MS } from '../lib/hiddenPause';
import { PEER_STREAM_DEBOUNCE_MS, peerStreamUrl, subscribePeerStream } from './peerStream';

// BOARD-LIVE L7 (contract C5): the dashboard follows `GET /v1/stream` on our
// own peer-boards service. `event: changed` → one `/v1/boards` GET after a
// 200 ms debounce; `: hb` comments are invisible to EventSource. Three
// failed opens (or PEER_STREAM off) fall back to polling every 3 s.

class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readonly url: string;
  readyState = FakeEventSource.CONNECTING;
  onopen: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent<string>) => void) | null = null;
  private listeners = new Map<string, Array<(ev: MessageEvent<string>) => void>>();
  constructor(url: string | URL) {
    this.url = String(url);
    FakeEventSource.instances.push(this);
  }
  addEventListener(name: string, fn: (ev: MessageEvent<string>) => void) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn]);
  }
  removeEventListener() {}
  close() {
    this.readyState = FakeEventSource.CLOSED;
  }
  open() {
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.(new Event('open'));
  }
  fail() {
    this.readyState = FakeEventSource.CLOSED;
    this.onerror?.(new Event('error'));
  }
  changed(v = 'abcdef0123456789') {
    const ev = new MessageEvent('changed', { data: JSON.stringify({ v, at: '2026-11-15T19:00:00Z' }) });
    for (const fn of this.listeners.get('changed') ?? []) fn(ev);
  }
}

const latest = () => FakeEventSource.instances.at(-1)!;

beforeEach(() => {
  vi.useFakeTimers();
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
});
afterEach(() => {
  cleanup();
  resetPeerBoardsForTests();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('subscribePeerStream', () => {
  it('opens /v0/city/<city>/svc/peer-boards/v1/stream', () => {
    const stop = subscribePeerStream('test-city', vi.fn());
    expect(latest().url).toBe(peerStreamUrl('test-city'));
    expect(peerStreamUrl('test-city')).toBe('/v0/city/test-city/svc/peer-boards/v1/stream');
    stop();
    expect(latest().readyState).toBe(FakeEventSource.CLOSED);
  });

  it('a burst of changed events gives one call after 200 ms', () => {
    const onChanged = vi.fn();
    const stop = subscribePeerStream('test-city', onChanged);
    latest().open();
    latest().changed('a');
    vi.advanceTimersByTime(100);
    latest().changed('b');
    vi.advanceTimersByTime(199);
    expect(onChanged).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onChanged).toHaveBeenCalledTimes(1);
    stop();
  });

  it('three failed opens fall back to 3 s polling; a later open stops it', () => {
    const onChanged = vi.fn();
    const stop = subscribePeerStream('test-city', onChanged);
    latest().fail();
    vi.advanceTimersByTime(1_000); // reconnect after 1 s
    latest().fail();
    vi.advanceTimersByTime(2_000); // then 2 s
    expect(FakeEventSource.instances).toHaveLength(3);
    latest().fail();
    expect(onChanged).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3_000);
    expect(onChanged).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1_000); // the 4 s reconnect
    latest().open();
    onChanged.mockClear();
    vi.advanceTimersByTime(9_000);
    expect(onChanged).not.toHaveBeenCalled();
    stop();
  });

  // 16.11 (Richard's page): the service restarted under an open page; the
  // stream came back but nothing read the boards again until a change.
  it('a reopen after a drop reads once (resync); the first open does not', () => {
    const onChanged = vi.fn();
    const stop = subscribePeerStream('test-city', onChanged);
    latest().open();
    vi.advanceTimersByTime(1_000);
    expect(onChanged).not.toHaveBeenCalled();
    latest().fail();
    vi.advanceTimersByTime(1_000);
    latest().open();
    vi.advanceTimersByTime(PEER_STREAM_DEBOUNCE_MS);
    expect(onChanged).toHaveBeenCalledTimes(1);
    stop();
  });

  it('reconnect backoff is capped at 30 s', () => {
    const stop = subscribePeerStream('test-city', vi.fn());
    for (let i = 0; i < 8; i += 1) {
      latest().fail();
      vi.advanceTimersByTime(30_000);
    }
    const before = FakeEventSource.instances.length;
    latest().fail();
    vi.advanceTimersByTime(29_999);
    expect(FakeEventSource.instances).toHaveLength(before);
    vi.advanceTimersByTime(1);
    expect(FakeEventSource.instances).toHaveLength(before + 1);
    stop();
  });

  // BOARD-CHAT D3 live check 19.11 (HOST cause 5): a hidden tab gives its
  // connection back, so a second tab's chat POST can start.
  it('a tab hidden past the grace time closes the stream; shown again it reopens and reads once', () => {
    const setHidden = (hidden: boolean) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    const onChanged = vi.fn();
    const stop = subscribePeerStream('test-city', onChanged);
    onTestFinished(() => setHidden(false));
    latest().open();
    setHidden(true);
    vi.advanceTimersByTime(HIDDEN_PAUSE_MS);
    expect(latest().readyState).toBe(FakeEventSource.CLOSED);
    vi.advanceTimersByTime(60_000);
    expect(FakeEventSource.instances).toHaveLength(1); // no reconnect, no poll while hidden
    expect(onChanged).not.toHaveBeenCalled();
    setHidden(false);
    expect(FakeEventSource.instances).toHaveLength(2);
    latest().open();
    vi.advanceTimersByTime(PEER_STREAM_DEBOUNCE_MS);
    expect(onChanged).toHaveBeenCalledTimes(1);
    stop();
  });

  // Review of PR #5: a stream that never opened before the pause (service down
  // at mount) also missed whatever changed; its first open after resume reads.
  it('the first open after a resume reads once even if the stream never opened before', () => {
    const setHidden = (hidden: boolean) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    const onChanged = vi.fn();
    const stop = subscribePeerStream('test-city', onChanged);
    onTestFinished(() => setHidden(false));
    setHidden(true);
    vi.advanceTimersByTime(HIDDEN_PAUSE_MS);
    setHidden(false);
    latest().open();
    vi.advanceTimersByTime(PEER_STREAM_DEBOUNCE_MS);
    expect(onChanged).toHaveBeenCalledTimes(1);
    stop();
  });

  it('PEER_STREAM off: no EventSource, a 3 s poll', () => {
    const onChanged = vi.fn();
    const stop = subscribePeerStream('test-city', onChanged, { enabled: false });
    expect(FakeEventSource.instances).toHaveLength(0);
    vi.advanceTimersByTime(9_000);
    expect(onChanged).toHaveBeenCalledTimes(3);
    stop();
    vi.advanceTimersByTime(9_000);
    expect(onChanged).toHaveBeenCalledTimes(3);
  });
});

describe('usePeerBoards follows the stream', () => {
  it('changed event triggers one boards GET after 200 ms debounce', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify(peerBody()), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    renderHook(() => usePeerBoards());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const boards = () =>
      fetchSpy.mock.calls.filter((call: unknown[]) => String(call[0]).endsWith('/svc/peer-boards/v1/boards'));
    const initial = boards().length;
    expect(initial).toBe(1);
    await act(async () => {
      latest().open();
      latest().changed('a');
      latest().changed('b');
      await vi.advanceTimersByTimeAsync(199);
    });
    expect(boards()).toHaveLength(initial);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(boards()).toHaveLength(initial + 1);
    // no 30 s poller any more: nothing else reads while the stream is quiet
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(boards()).toHaveLength(initial + 1);
  });
});

describe('usePeerBoards recovers from a failed read', () => {
  const ok = () => new Response(JSON.stringify(peerBody()), { status: 200 });
  const boardsCalls = (spy: ReturnType<typeof vi.fn>) =>
    spy.mock.calls.filter((call: unknown[]) => String(call[0]).endsWith('/svc/peer-boards/v1/boards')).length;

  it('a failed read then a good one ends with the peer chip enabled, no reload', async () => {
    let fail = true;
    const fetchSpy = vi.fn(async () => (fail ? new Response('bad gateway', { status: 502 }) : ok()));
    vi.stubGlobal('fetch', fetchSpy);
    const { result } = renderHook(() => usePeerBoards());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.error).not.toBeNull();
    expect(ownerChoicesEnabled(boardSourcesOf(result.current.sources))).toBe(false);
    fail = false; // the service is back; the stream stays quiet (never opens)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PEER_RETRY_MIN_MS);
    });
    expect(result.current.error).toBeNull();
    expect(result.current.sources).toHaveLength(1);
    expect(ownerChoicesEnabled(boardSourcesOf(result.current.sources))).toBe(true);
    // recovered: no more retries
    const after = boardsCalls(fetchSpy);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PEER_RETRY_MAX_MS * 2);
    });
    expect(boardsCalls(fetchSpy)).toBe(after);
  });

  it('retries back off 5 s → 30 s while the read keeps failing', async () => {
    const fetchSpy = vi.fn(async () => new Response('down', { status: 502 }));
    vi.stubGlobal('fetch', fetchSpy);
    renderHook(() => usePeerBoards());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(PEER_RETRY_MIN_MS).toBe(5_000);
    expect(PEER_RETRY_MAX_MS).toBe(30_000);
    const at = [boardsCalls(fetchSpy)];
    for (const step of [5_000, 10_000, 20_000, 30_000, 30_000]) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(step - 1);
      });
      expect(boardsCalls(fetchSpy)).toBe(at.at(-1));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      at.push(boardsCalls(fetchSpy));
      expect(at.at(-1)).toBe(at.at(-2)! + 1);
    }
  });
});
