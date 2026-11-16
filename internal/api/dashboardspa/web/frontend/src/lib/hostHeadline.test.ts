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
  sustainedBusy,
} from './hostHeadline';
import { liveFixture } from '../test/fixtures/liveHealth';

const GiB = 2 ** 30;

afterEach(() => setLocale('en'));

describe('host thresholds', () => {
  // Review I-2: on macOS the load average counts I/O and uninterruptible
  // waits, so the CPU verdict reads busy %, sustained over 30 s.
  it('judges the CPU by sustained busy %: calm below 80 %, amber to 95 %, red from 95 %', () => {
    expect(HOST_THRESHOLDS.cpuWarnBusyPct).toBe(80);
    expect(HOST_THRESHOLDS.cpuCriticalBusyPct).toBe(95);
    expect(HOST_THRESHOLDS.cpuSustainMs).toBe(30_000);
    expect(cpuTone(79)).toBe('ok');
    expect(cpuTone(80)).toBe('warn');
    expect(cpuTone(94)).toBe('warn');
    expect(cpuTone(95)).toBe('critical');
  });

  it('averages busy % over the last 30 s, skipping gaps', () => {
    const now = 1_000_000;
    const at = (secAgo: number, busyPct: number | null) => ({ at: now - secAgo * 1000, busyPct });
    expect(sustainedBusy([at(40, 99), at(20, 20), at(10, null), at(0, 40)], now)).toBe(30);
    expect(sustainedBusy([], now)).toBeNull();
    expect(sustainedBusy([at(45, 90)], now)).toBeNull();
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
    expect(h.sentence).toBe('The CPU is 31% busy; memory is fine; 40\u00a0GB free on disk.');
  });

  it('takes the worst clause as the tone', () => {
    const h = buildHeadline(withLoad(3.8, 31, 9.3), 31);
    expect(h.tone).toBe('warn');
    expect(h.clauses.find((c) => c.key === 'disk')?.tone).toBe('warn');
    expect(h.sentence).toBe(
      'The CPU is 31% busy; memory is fine; disk space is low — 9.3\u00a0GB.',
    );
  });

  // Review I-2, measured: load 11–13 on 10 cores while the CPU was 16–23 % busy.
  it('stays calm with a high load average and an idle CPU, and says nothing of a queue', () => {
    const h = buildHeadline(withLoad(12.9, 20), 20);
    expect(h.tone).toBe('ok');
    expect(h.sentence).toBe('The CPU is 20% busy; memory is fine; 40\u00a0GB free on disk.');
    expect(h.sentence).not.toMatch(/queue/);
  });

  it('stays calm through a short spike', () => {
    expect(buildHeadline(withLoad(3, 100), 40).clauses[0]?.tone).toBe('ok');
  });

  it('turns amber when the CPU stays busy, naming a queue only when there is one', () => {
    const h = buildHeadline(withLoad(9, 85), 85);
    expect(h.tone).toBe('warn');
    expect(h.sentence.startsWith('The Mac is busy: the CPU is 85% busy;')).toBe(true);
    const q = buildHeadline(withLoad(13, 85), 85);
    expect(
      q.sentence.startsWith(
        'The Mac is busy: the CPU is 85% busy, work waits in a queue (1.3× the cores);',
      ),
    ).toBe(true);
  });

  it('turns red when the CPU stays at its limit, with the queue as a multiple', () => {
    const h = buildHeadline(withLoad(36, 100), 97);
    expect(h.tone).toBe('critical');
    expect(
      h.sentence.startsWith(
        'The Mac is overloaded: the CPU is 100% busy, work waits in a queue (3.6× the cores)',
      ),
    ).toBe(true);
    expect(
      buildHeadline(withLoad(5, 100), 98).sentence.startsWith(
        'The Mac is overloaded: the CPU is 100% busy;',
      ),
    ).toBe(true);
  });

  it('never prints a CPU figure above 100 %, however deep the queue', () => {
    for (const load of [12, 36, 229]) {
      expect(buildHeadline(withLoad(load, 100), 100).sentence).not.toMatch(OVER_100);
    }
  });

  it('leaves the CPU out when busy % is unreadable: load alone cannot judge it', () => {
    const live = withLoad(30, 0);
    live.cpu.busy_pct = { status: 'unavailable', reason: 'sample_failed' };
    expect(buildHeadline(live).clauses.map((c) => c.key)).toEqual(['memory', 'disk']);
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
    expect(buildHeadline(withLoad(36, 100, 9.9), 100).sentence).toBe(
      'Мак перегружен: процессор занят на 100\u00a0%, задачи ждут в очереди (в 3,6 раза больше ядер); памяти хватает; на диске мало места — 9,9\u00a0ГБ.',
    );
    expect(
      buildHeadline(withLoad(13, 85), 85).sentence.startsWith(
        'Мак загружен: процессор занят на 85\u00a0%, задачи ждут в очереди (в 1,3 раза больше ядер);',
      ),
    ).toBe(true);
    expect(buildHeadline(liveFixture()).sentence).toBe(
      'Процессор занят на 31\u00a0%; памяти хватает; на диске свободно 40\u00a0ГБ.',
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
