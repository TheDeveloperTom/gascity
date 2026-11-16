import type { LiveHealth, MemoryPressure } from 'gas-city-dashboard-shared';

// The Health page's realtime history (owner 16.11): every poll of
// GET /api/health/live becomes one LiveSample, kept in a fixed-size ring so
// the page can draw the last 15–30 minutes without the history growing.

/** Poll cadence and history length. 600 samples × 3 s = 30 minutes. */
export const LIVE_POLL_MS = 3_000;
export const LIVE_HISTORY_SAMPLES = 600;
/** A pause longer than this between samples breaks the drawn line. */
export const LIVE_GAP_MS = LIVE_POLL_MS * 5;

export interface LiveSample {
  at: number;
  /** Share of all cores busy since the previous sample, 0–100. */
  busyPct: number | null;
  /** 1-minute load as a percent of the cores (can pass 100). */
  loadPct: number | null;
  memUsedBytes: number | null;
  memTotalBytes: number | null;
  swapUsedBytes: number | null;
  pressure: MemoryPressure | null;
  diskFreeBytes: number | null;
  diskTotalBytes: number | null;
}

/** Fixed-capacity FIFO: pushing past capacity drops the oldest value. */
export class RingBuffer<T> {
  private readonly slots: (T | undefined)[];
  private start = 0;
  private count = 0;

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error(`RingBuffer capacity must be a positive integer, got ${capacity}`);
    }
    this.slots = new Array<T | undefined>(capacity);
  }

  get size(): number {
    return this.count;
  }

  push(value: T): void {
    const end = (this.start + this.count) % this.capacity;
    this.slots[end] = value;
    if (this.count < this.capacity) {
      this.count += 1;
    } else {
      this.start = (this.start + 1) % this.capacity;
    }
  }

  /** Oldest first. */
  toArray(): T[] {
    const out: T[] = [];
    for (let i = 0; i < this.count; i += 1) {
      out.push(this.slots[(this.start + i) % this.capacity] as T);
    }
    return out;
  }

  clear(): void {
    this.start = 0;
    this.count = 0;
  }
}

export function loadPctOf(live: LiveHealth): number | null {
  if (live.cpu.load.status !== 'available' || !(live.cpu.cores > 0)) return null;
  const v = (100 * live.cpu.load.value.load_avg_1) / live.cpu.cores;
  return Number.isFinite(v) && v >= 0 ? v : null;
}

export function sampleFromLive(live: LiveHealth): LiveSample {
  const at = Date.parse(live.sampled_at);
  const mem = live.memory.status === 'available' ? live.memory.value : null;
  const disk = live.disk.status === 'available' ? live.disk.value : null;
  return {
    at: Number.isFinite(at) ? at : Date.now(),
    busyPct: live.cpu.busy_pct.status === 'available' ? live.cpu.busy_pct.value : null,
    loadPct: loadPctOf(live),
    memUsedBytes: mem?.used_bytes ?? null,
    memTotalBytes: mem?.total_bytes ?? null,
    swapUsedBytes: mem?.swap_used_bytes ?? null,
    pressure: mem?.pressure ?? null,
    diskFreeBytes: disk?.free_bytes ?? null,
    diskTotalBytes: disk?.total_bytes ?? null,
  };
}

/** The samples inside the last windowMs before now. */
export function windowSamples<S extends { at: number }>(
  samples: readonly S[],
  now: number,
  windowMs: number,
): S[] {
  const from = now - windowMs;
  return samples.filter((s) => s.at >= from && s.at <= now);
}

/** Splits a series into runs wherever two neighbours are more than gapMs apart. */
export function splitAtGaps<S extends { at: number }>(samples: readonly S[], gapMs: number): S[][] {
  const runs: S[][] = [];
  let run: S[] = [];
  for (const s of samples) {
    const last = run.at(-1);
    if (last !== undefined && s.at - last.at > gapMs) {
      runs.push(run);
      run = [];
    }
    run.push(s);
  }
  if (run.length > 0) runs.push(run);
  return runs;
}

// One history per browser tab, outliving the Health route so leaving and
// coming back keeps the last half hour.
const history = new RingBuffer<LiveSample>(LIVE_HISTORY_SAMPLES);
const listeners = new Set<() => void>();
let version = 0;

export function recordLiveSample(sample: LiveSample): void {
  const last = history.toArray().at(-1);
  if (last !== undefined && last.at === sample.at) return;
  history.push(sample);
  version += 1;
  for (const listener of listeners) listener();
}

export function liveHistory(): LiveSample[] {
  return history.toArray();
}

export function liveHistoryVersion(): number {
  return version;
}

export function subscribeLiveHistory(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tests only: start from an empty history. */
export function resetLiveHistory(): void {
  history.clear();
  version += 1;
}
