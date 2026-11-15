import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLocale } from '../i18n';
import { cityVerdict, type CityInputs } from './cityVerdict';

// V9: one sentence about the city, three rows, and the problems that drive
// the menu badge and the Главная line.

beforeEach(() => setLocale('ru'));
afterEach(() => setLocale('en'));

// Local wall-clock times, so «с 14:05» is what the owner's clock reads.
const NOW = new Date(2026, 10, 15, 14, 10, 0).getTime();
const AT_1405 = new Date(2026, 10, 15, 14, 5, 0).getTime();

function inputs(extra: Partial<CityInputs> = {}): CityInputs {
  return {
    nowMs: NOW,
    lastStatusOkMs: NOW - 5_000,
    lastStatusTimeoutMs: null,
    lastHealthProbeOkMs: NOW - 5_000,
    startedAtMs: NOW - 3_600_000,
    host: { cpuCount: 10, load1: 3, memFreeBytes: 8e9, memTotalBytes: 32e9 },
    store: 'ok',
    quarantined: 0,
    mayorRunningSinceMs: NOW - 7_200_000,
    mayorDownSinceMs: null,
    ...extra,
  };
}

describe('cityVerdict', () => {
  it('healthy: «Город работает.»', () => {
    const v = cityVerdict(inputs());
    expect(v.sentence).toBe('Город работает.');
    expect(v.supervisor).toBe('ok');
    expect(v.problems).toEqual([]);
    expect(v.rows).toEqual({ city: 'работает', mac: 'в норме', store: 'в порядке' });
  });

  it('a timeout from hours ago does not make a live supervisor slow', () => {
    const v = cityVerdict(
      inputs({
        lastStatusOkMs: NOW - 90_000,
        lastStatusTimeoutMs: NOW - 3 * 3_600_000,
        lastHealthProbeOkMs: NOW - 30_000,
      }),
    );
    expect(v.supervisor).toBe('ok');
  });

  it('a timed-out read on a live supervisor is slow, not down', () => {
    const v = cityVerdict(
      inputs({
        lastStatusOkMs: NOW - 90_000,
        lastStatusTimeoutMs: NOW - 10_000,
        lastHealthProbeOkMs: NOW - 30_000,
      }),
    );
    expect(v.supervisor).toBe('slow');
    expect(v.rows.city).toBe('отвечает медленно');
    expect(v.sentence).toBe('Город работает, но отвечает медленно.');
  });

  it('load 60 on 10 cores', () => {
    const v = cityVerdict(
      inputs({
        lastStatusOkMs: NOW - 90_000,
        lastStatusTimeoutMs: NOW - 10_000,
        lastHealthProbeOkMs: NOW - 30_000,
        host: { cpuCount: 10, load1: 60, memFreeBytes: 8e9, memTotalBytes: 32e9 },
      }),
    );
    expect(v.sentence).toBe(
      'Город работает. Mac перегружен: нагрузка 60 при 10 ядрах, часть данных не успевает прочитаться.',
    );
    expect(v.rows.mac).toBe('перегружен: нагрузка 60 при 10 ядрах');
    expect(v.problems.map((p) => p.key)).toEqual(['mac-overloaded']);
  });

  it('no answer for 60 s is down', () => {
    const v = cityVerdict(
      inputs({
        lastStatusOkMs: AT_1405,
        lastStatusTimeoutMs: NOW - 5_000,
        lastHealthProbeOkMs: AT_1405,
      }),
    );
    expect(v.supervisor).toBe('down');
    expect(v.sentence).toBe('Город не отвечает с 14:05.');
    expect(v.rows.city).toBe('не отвечает с 14:05');
    expect(v.problems).toContainEqual(
      expect.objectContaining({ key: 'down', line: 'Город не отвечает с 14:05' }),
    );
  });

  it('slow alone is not a problem', () => {
    const v = cityVerdict(
      inputs({
        lastStatusOkMs: NOW - 90_000,
        lastStatusTimeoutMs: NOW - 10_000,
        lastHealthProbeOkMs: NOW - 30_000,
      }),
    );
    expect(v.problems).toEqual([]);
  });

  it('low memory is named', () => {
    const v = cityVerdict(
      inputs({ host: { cpuCount: 10, load1: 3, memFreeBytes: 2e9, memTotalBytes: 32e9 } }),
    );
    expect(v.rows.mac).toBe('мало памяти: свободно 6%');
    expect(v.sentence).toBe('Город работает. На Mac мало памяти: свободно 6%.');
  });

  it('store failed, quarantined, mayor down are problems; stale cards never are', () => {
    const v = cityVerdict(
      inputs({
        store: 'failed',
        quarantined: 2,
        mayorRunningSinceMs: null,
        mayorDownSinceMs: AT_1405,
      }),
    );
    expect(v.problems.map((p) => p.key)).toEqual(['store-failed', 'quarantined', 'mayor-down']);
    expect(v.rows.store).toBe('обслуживание не удалось');
    expect(v.problems.every((p) => p.href.startsWith('/'))).toBe(true);
    // CityInputs has no card field at all: board staleness cannot reach here.
    expect(Object.keys(inputs())).not.toContain('cards');
  });

  it('a mayor down for under 5 min is not a problem yet', () => {
    const v = cityVerdict(inputs({ mayorRunningSinceMs: null, mayorDownSinceMs: NOW - 120_000 }));
    expect(v.problems).toEqual([]);
  });

  it('a just-started dashboard with no reads yet is not down', () => {
    const v = cityVerdict(
      inputs({
        lastStatusOkMs: null,
        lastHealthProbeOkMs: null,
        startedAtMs: NOW - 10_000,
      }),
    );
    expect(v.supervisor).not.toBe('down');
  });
});
