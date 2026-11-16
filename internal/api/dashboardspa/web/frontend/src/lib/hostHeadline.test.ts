import { afterEach, describe, expect, it } from 'vitest';
import { collectMissing, resetMissing, setLocale } from '../i18n';
import { buildHeadline, cpuTone, diskTone, HOST_THRESHOLDS, memoryTone } from './hostHeadline';
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

describe('buildHeadline', () => {
  it('says what is happening in one calm sentence', () => {
    const h = buildHeadline(liveFixture());
    expect(h.tone).toBe('ok');
    expect(h.sentence).toBe('The Mac is 38% loaded, memory is fine, 40\u00a0GB free on disk.');
  });

  it('takes the worst clause as the tone', () => {
    const h = buildHeadline(
      liveFixture({
        disk: { status: 'available', value: { total_bytes: 460 * GiB, free_bytes: 9.3 * GiB } },
      }),
    );
    expect(h.tone).toBe('warn');
    expect(h.clauses.find((c) => c.key === 'disk')?.tone).toBe('warn');
    expect(h.sentence).toBe(
      'The Mac is 38% loaded, memory is fine, disk space is low: 9.3\u00a0GB free.',
    );
  });

  it('turns red when the Mac is overloaded', () => {
    const live = liveFixture();
    live.cpu.load = {
      status: 'available',
      value: { load_avg_1: 14, load_avg_5: 10, load_avg_15: 8 },
    };
    const h = buildHeadline(live);
    expect(h.tone).toBe('critical');
    expect(h.sentence.startsWith('The Mac is overloaded: 140%')).toBe(true);
  });

  it('falls back to busy % when load is unavailable', () => {
    const live = liveFixture();
    live.cpu.load = { status: 'unavailable', reason: 'sample_failed' };
    expect(buildHeadline(live).sentence.startsWith('The Mac is 31% loaded')).toBe(true);
  });

  it('skips a clause it cannot read instead of inventing it', () => {
    const h = buildHeadline(
      liveFixture({ memory: { status: 'unavailable', reason: 'sample_failed' } }),
    );
    expect(h.clauses.map((c) => c.key)).toEqual(['cpu', 'disk']);
  });

  it('reads Russian with a decimal comma and no missing keys', () => {
    setLocale('ru');
    resetMissing();
    const h = buildHeadline(
      liveFixture({
        disk: { status: 'available', value: { total_bytes: 460 * GiB, free_bytes: 9.3 * GiB } },
      }),
    );
    expect(h.sentence).toBe(
      'Мак загружен на 38\u00a0%, памяти хватает, на диске мало места: 9,3\u00a0ГБ свободно.',
    );
    expect(collectMissing()).toEqual([]);
  });
});
