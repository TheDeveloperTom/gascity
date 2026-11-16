import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LIVE_GAP_MS,
  LIVE_HISTORY_SAMPLES,
  RingBuffer,
  liveHistory,
  liveHistoryVersion,
  recordLiveSample,
  resetLiveHistory,
  sampleFromLive,
  seedLiveHistory,
  splitAtGaps,
  subscribeLiveHistory,
  windowSamples,
  type LiveSample,
} from './hostLive';
import { liveFixture } from '../test/fixtures/liveHealth';

describe('RingBuffer', () => {
  it('keeps the newest values in arrival order once full', () => {
    const ring = new RingBuffer<number>(3);
    for (const v of [1, 2, 3, 4, 5]) ring.push(v);
    expect(ring.toArray()).toEqual([3, 4, 5]);
    expect(ring.size).toBe(3);
  });

  it('reads oldest first before it wraps', () => {
    const ring = new RingBuffer<number>(4);
    ring.push(1);
    ring.push(2);
    expect(ring.toArray()).toEqual([1, 2]);
  });

  it('refuses a capacity below one', () => {
    expect(() => new RingBuffer<number>(0)).toThrow();
  });

  it('holds 30 minutes at a 3 s poll without growing past capacity', () => {
    const ring = new RingBuffer<number>(600);
    for (let i = 0; i < 2000; i += 1) ring.push(i);
    const all = ring.toArray();
    expect(all).toHaveLength(600);
    expect(all[0]).toBe(1400);
    expect(all.at(-1)).toBe(1999);
  });
});

describe('sampleFromLive', () => {
  it('keeps the CPU as busy %, never load as a percent', () => {
    const s = sampleFromLive(liveFixture());
    expect(s).not.toHaveProperty('loadPct');
    expect(s.busyPct).toBe(31);
    expect(s.memUsedBytes).toBe(19 * 2 ** 30);
    expect(s.diskFreeBytes).toBe(40 * 2 ** 30);
    expect(s.at).toBe(Date.parse('2026-11-16T10:00:00Z'));
  });

  it('keeps an unavailable metric as null, never zero', () => {
    const s = sampleFromLive(
      liveFixture({
        memory: { status: 'unavailable', reason: 'sample_failed' },
        disk: { status: 'unavailable', reason: 'sample_failed' },
      }),
    );
    expect(s.memUsedBytes).toBeNull();
    expect(s.diskFreeBytes).toBeNull();
  });
});

describe('windowSamples and splitAtGaps', () => {
  const at = (sec: number) => ({ at: sec * 1000 });

  it('keeps only the samples inside the window', () => {
    const samples = [at(0), at(100), at(1000), at(1800)];
    expect(windowSamples(samples, 1800_000, 900_000)).toEqual([at(1000), at(1800)]);
  });

  it('breaks the line where polling stopped for longer than the gap', () => {
    const runs = splitAtGaps([at(0), at(3), at(6), at(60), at(63)], 15_000);
    expect(runs).toEqual([
      [at(0), at(3), at(6)],
      [at(60), at(63)],
    ]);
  });
});

describe('seedLiveHistory', () => {
  const sample = (sec: number, busyPct = 10): LiveSample => ({
    at: sec * 1000,
    busyPct,
    memUsedBytes: 1,
    memTotalBytes: 2,
    swapUsedBytes: 0,
    pressure: 'normal',
    diskFreeBytes: 1,
    diskTotalBytes: 2,
  });

  beforeEach(() => {
    resetLiveHistory();
  });

  it('fills an empty store with the server history, oldest first', () => {
    seedLiveHistory([sample(10), sample(5), sample(15)]);
    expect(liveHistory().map((s) => s.at)).toEqual([5_000, 10_000, 15_000]);
  });

  it('fills only the gaps the tab did not poll, never doubling a stretch it has', () => {
    recordLiveSample(sample(1000, 77));
    recordLiveSample(sample(1003, 78));
    const gapSec = LIVE_GAP_MS / 1000;
    seedLiveHistory([
      sample(900),
      sample(1000 - gapSec - 1),
      sample(995),
      sample(1003),
      sample(1010),
      sample(1003 + gapSec + 1),
    ]);
    expect(liveHistory().map((s) => s.at / 1000)).toEqual([
      900,
      1000 - gapSec - 1,
      1000,
      1003,
      1003 + gapSec + 1,
    ]);
    expect(liveHistory().find((s) => s.at === 1_000_000)?.busyPct).toBe(77);
  });

  it('keeps the newest samples when the merge exceeds the capacity', () => {
    seedLiveHistory(Array.from({ length: LIVE_HISTORY_SAMPLES + 50 }, (_, i) => sample(i * 5)));
    const all = liveHistory();
    expect(all).toHaveLength(LIVE_HISTORY_SAMPLES);
    expect(all.at(-1)?.at).toBe((LIVE_HISTORY_SAMPLES + 49) * 5 * 1000);
  });

  it('tells the subscribers once', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeLiveHistory(listener);
    const before = liveHistoryVersion();
    seedLiveHistory([sample(1), sample(2)]);
    unsubscribe();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(liveHistoryVersion()).toBe(before + 1);
  });
});
