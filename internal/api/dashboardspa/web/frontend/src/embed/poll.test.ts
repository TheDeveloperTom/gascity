// Discord mode: one shared refresh ticker for every live view (review L3).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMBED_POLL_MS, subscribeEmbedTick } from './poll';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('subscribeEmbedTick', () => {
  it('one timer for all subscribers; each refreshes once per tick', async () => {
    const a = vi.fn();
    const b = vi.fn();
    const c = vi.fn();
    const stops = [subscribeEmbedTick(a), subscribeEmbedTick(b), subscribeEmbedTick(c)];
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(EMBED_POLL_MS);
    expect([a, b, c].map((f) => f.mock.calls.length)).toEqual([1, 1, 1]);
    stops.forEach((s) => s());
    expect(vi.getTimerCount()).toBe(0);
  });

  it('nothing while the page is hidden', async () => {
    let state: DocumentVisibilityState = 'hidden';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => state);
    const a = vi.fn();
    const stop = subscribeEmbedTick(a);
    await vi.advanceTimersByTimeAsync(EMBED_POLL_MS * 3);
    expect(a).not.toHaveBeenCalled();
    state = 'visible';
    await vi.advanceTimersByTimeAsync(EMBED_POLL_MS);
    expect(a).toHaveBeenCalledTimes(1);
    stop();
  });

  it('a subscriber that leaves mid-way is not called again; the timer stays for the rest', async () => {
    const a = vi.fn();
    const b = vi.fn();
    const stopA = subscribeEmbedTick(a);
    const stopB = subscribeEmbedTick(b);
    stopA();
    await vi.advanceTimersByTimeAsync(EMBED_POLL_MS);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
    stopB();
  });
});
