import { describe, expect, it } from 'vitest';
import { RingBuffer, sampleFromLive, splitAtGaps, windowSamples } from './hostLive';
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
  it('turns load into a percent of the cores', () => {
    const s = sampleFromLive(liveFixture());
    expect(s.loadPct).toBeCloseTo(38);
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
