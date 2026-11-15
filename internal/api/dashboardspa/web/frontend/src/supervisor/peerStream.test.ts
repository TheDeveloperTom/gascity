import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetPeerBoardsForTests, usePeerBoards } from '../hooks/usePeerBoards';
import { peerBody } from '../test/fixtures/peerBoards';
import { peerStreamUrl, subscribePeerStream } from './peerStream';

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
    const boards = () => fetchSpy.mock.calls.filter(([u]) => String(u).endsWith('/svc/peer-boards/v1/boards'));
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
