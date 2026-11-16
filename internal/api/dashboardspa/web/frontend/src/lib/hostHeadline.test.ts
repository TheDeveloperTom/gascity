import { afterEach, describe, expect, it } from 'vitest';
import { collectMissing, resetMissing, setLocale } from '../i18n';
import {
  buildHeadline,
  cpuQueueLine,
  formatBytes,
  cpuTone,
  diskTone,
  HOST_THRESHOLDS,
  memoryTone,
} from './hostHeadline';
import { liveFixture } from '../test/fixtures/liveHealth';

const GiB = 2 ** 30;

afterEach(() => setLocale('en'));

describe('host thresholds', () => {
  it('reads CPU load against the cores: calm below 80 %, amber to 120 %, red above', () => {
    expect(HOST_THRESHOLDS.cpuWarnPct).toBe(80);
    expect(HOST_THRESHOLDS.cpuCriticalPct).toBe(120);
    expect(cpuTone(79)).toBe('ok');
    expect(cpuTone(80)).toBe('warn');
    expect(cpuTone(119)).toBe('warn');
    expect(cpuTone(120)).toBe('critical');
  });

  it('trusts the kernel memory pressure when it reports one', () => {
    const mem = {
      total_bytes: 24 * GiB,
      used_bytes: 23.5 * GiB,
      available_bytes: 0.5 * GiB,
      swap_total_bytes: 0,
      swap_used_bytes: 0,
    };
    expect(memoryTone({ ...mem, pressure: 'normal' })).toBe('ok');
    expect(memoryTone({ ...mem, pressure: 'warn' })).toBe('warn');
    expect(memoryTone({ ...mem, pressure: 'critical' })).toBe('critical');
  });

  it('falls back to the free share when pressure is unknown', () => {
    const base = {
      total_bytes: 100,
      used_bytes: 0,
      swap_total_bytes: 0,
      swap_used_bytes: 0,
      pressure: 'unknown' as const,
    };
    expect(memoryTone({ ...base, available_bytes: 20 })).toBe('ok');
    expect(memoryTone({ ...base, available_bytes: 9 })).toBe('warn');
    expect(memoryTone({ ...base, available_bytes: 4 })).toBe('critical');
  });

  it('judges the disk by free gigabytes: amber under 20 GB, red under 5 GB', () => {
    expect(diskTone({ total_bytes: 460 * GiB, free_bytes: 40 * GiB })).toBe('ok');
    expect(diskTone({ total_bytes: 460 * GiB, free_bytes: 9.3 * GiB })).toBe('warn');
    expect(diskTone({ total_bytes: 460 * GiB, free_bytes: 4 * GiB })).toBe('critical');
  });
});

function withLoad(load: number, busy: number, freeGiB = 40) {
  const live = liveFixture({
    disk: { status: 'available', value: { total_bytes: 460 * GiB, free_bytes: freeGiB * GiB } },
  });
  live.cpu.load = {
    status: 'available',
    value: { load_avg_1: load, load_avg_5: load, load_avg_15: load },
  };
  live.cpu.busy_pct = { status: 'available', value: busy };
  return live;
}

// Coordinator 16.11: a CPU figure above 100 % reads as a bug. The CPU is
// «busy %» (0–100); the run queue is said as a multiple of the cores.
const OVER_100 = /(1(0[1-9]|[1-9][0-9])|[2-9][0-9]{2}|[0-9]{4,})\s?%/;

describe('buildHeadline', () => {
  it('says what is happening in one calm sentence, CPU as busy %', () => {
    const h = buildHeadline(liveFixture());
    expect(h.tone).toBe('ok');
    expect(h.sentence).toBe('The CPU is 31% busy; memory is fine; 40 GB free on disk.');
  });

  it('takes the worst clause as the tone', () => {
    const h = buildHeadline(withLoad(3.8, 31, 9.3));
    expect(h.tone).toBe('warn');
    expect(h.clauses.find((c) => c.key === 'disk')?.tone).toBe('warn');
    expect(h.sentence).toBe('The CPU is 31% busy; memory is fine; disk space is low — 9.3 GB.');
  });

  it('turns amber when the queue nears the cores, still without a figure over 100 %', () => {
    const h = buildHeadline(withLoad(9, 85));
    expect(h.tone).toBe('warn');
    expect(
      h.sentence.startsWith('The Mac is busy: the CPU is 85% busy, work is close to queueing'),
    ).toBe(true);
  });

  it('turns red when the queue passes the cores and says it as a multiple', () => {
    const h = buildHeadline(withLoad(36, 100));
    expect(h.tone).toBe('critical');
    expect(
      h.sentence.startsWith(
        'The Mac is overloaded: the CPU is 100% busy, work waits in a queue (3.6× the cores)',
      ),
    ).toBe(true);
  });

  it('never prints a CPU figure above 100 %, however deep the queue', () => {
    for (const load of [12, 36, 229]) {
      expect(buildHeadline(withLoad(load, 100)).sentence).not.toMatch(OVER_100);
    }
  });

  it('judges the CPU by busy % when load is unavailable', () => {
    const live = liveFixture();
    live.cpu.load = { status: 'unavailable', reason: 'sample_failed' };
    expect(buildHeadline(live).sentence.startsWith('The CPU is 31% busy')).toBe(true);
  });

  it('skips a clause it cannot read instead of inventing it', () => {
    const h = buildHeadline(
      liveFixture({ memory: { status: 'unavailable', reason: 'sample_failed' } }),
    );
    expect(h.clauses.map((c) => c.key)).toEqual(['cpu', 'disk']);
  });

  it('reads Russian the way the coordinator wrote it', () => {
    setLocale('ru');
    resetMissing();
    expect(buildHeadline(withLoad(36, 100, 9.9)).sentence).toBe(
      'Мак перегружен: процессор занят на 100 %, задачи ждут в очереди (в 3,6 раза больше ядер); памяти хватает; на диске мало места — 9,9 ГБ.',
    );
    expect(buildHeadline(liveFixture()).sentence).toBe(
      'Процессор занят на 31 %; памяти хватает; на диске свободно 40 ГБ.',
    );
    expect(collectMissing()).toEqual([]);
  });
});

describe('cpuQueueLine', () => {
  it('says a deep queue as a multiple of the cores, in Russian plurals', () => {
    setLocale('ru');
    resetMissing();
    expect(cpuQueueLine(withLoad(36, 100))).toBe(
      'очередь задач: в 3,6 раза больше, чем ядер (36 на 10)',
    );
    expect(cpuQueueLine(withLoad(20, 100))).toBe(
      'очередь задач: в 2 раза больше, чем ядер (20 на 10)',
    );
    expect(cpuQueueLine(withLoad(50, 100))).toBe(
      'очередь задач: в 5 раз больше, чем ядер (50 на 10)',
    );
    expect(collectMissing()).toEqual([]);
  });

  it('says a short queue as the count against the cores', () => {
    setLocale('ru');
    expect(cpuQueueLine(withLoad(3.8, 31))).toBe('очередь задач: 3,8 на 10 ядер');
  });

  it('is null when load is unavailable', () => {
    const live = liveFixture();
    live.cpu.load = { status: 'unavailable', reason: 'sample_failed' };
    expect(cpuQueueLine(live)).toBeNull();
  });
});

describe('formatBytes', () => {
  it('moves up a unit before printing four digits', () => {
    setLocale('ru');
    expect(formatBytes(1009 * 2 ** 20)).toBe('1\u00a0ГБ');
    expect(formatBytes(896 * 2 ** 20)).toBe('896\u00a0МБ');
    expect(formatBytes(9.3 * GiB)).toBe('9,3\u00a0ГБ');
  });
});
