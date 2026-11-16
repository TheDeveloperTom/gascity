import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Bead } from 'gas-city-dashboard-shared/gc-supervisor';
import { collectMissing, resetMissing, setLocale } from '../i18n';
import { composeAttention } from './compose';
import { createAttentionContributors } from './registry';

// Review I5: attention row summaries go through t()/tn(), so Russian reads
// Russian and Task 12's coverage test can see every key.

const NOW = Date.parse('2026-06-05T12:00:00.000Z');
const FOUR_DAYS_AGO = '2026-06-01T12:00:00.000Z';
const FIVE_HOURS_AGO = '2026-06-05T07:00:00.000Z';

function bead(overrides: Partial<Bead>): Bead {
  return {
    created_at: FOUR_DAYS_AGO,
    id: 'B-0',
    issue_type: 'task',
    status: 'open',
    title: 'Задача',
    ...overrides,
  };
}

function summaries() {
  const m = composeAttention(
    createAttentionContributors({
      beads: {
        decisionLabel: 'needs/x',
        nowMs: NOW,
        sessions: [{ id: 's', session_name: 'gone', state: 'drained' }],
        items: [
          bead({ id: 'B-u' }),
          bead({ id: 'B-s', status: 'in_progress', updated_at: FIVE_HOURS_AGO }),
          bead({ id: 'B-d', status: 'in_progress', assignee: 'gone', updated_at: FIVE_HOURS_AGO }),
          bead({ id: 'B-h', status: 'open', labels: ['hold:plan'], updated_at: FIVE_HOURS_AGO }),
          bead({
            id: 'B-m',
            status: 'in_progress',
            assignee: 'w',
            labels: ['hold:mayor'],
            updated_at: FIVE_HOURS_AGO,
          }),
        ],
        escalations: [bead({ id: 'B-e', labels: ['gc:escalation'] })],
      },
    }),
  );
  return new Map(m.items.map((item) => [item.ref ?? item.id, item.summary]));
}

describe('attention row copy', () => {
  beforeEach(() => resetMissing());
  afterEach(() => setLocale('en'));

  it('reads Russian in ru, with every key translated', () => {
    setLocale('ru');
    const s = summaries();
    // Dashboard v3: ready, unclaimed work lives on «Задачи», not in attention.
    expect(s.has('B-u')).toBe(false);
    expect(s.get('B-s')).toBe('Застряла 5 часов: никто не взялся');
    expect(s.get('B-d')).toBe('Застряла 5 часов: сессия в состоянии drained');
    expect(s.get('B-h')).toBe('На паузе уже 5 часов');
    expect(s.get('B-m')).toBe('Ждёт: Мэр, уже 5 часов');
    expect(s.get('B-e')).toBe('Просит помощи');
    expect(collectMissing()).toEqual([]);
  });

  it('reads English in en', () => {
    const s = summaries();
    expect(s.has('B-u')).toBe(false);
    expect(s.get('B-s')).toBe('Stalled for 5 hours: nobody is on it');
    expect(s.get('B-h')).toBe('On hold for 5 hours');
    expect(s.get('B-m')).toBe('Waiting on Mayor for 5 hours');
  });
});

// H1 16.11 (live «Нужно от меня» → «Город · Неполадки»): health rows read
// «Dolt-noms trend unavailable» with the raw code «store_health_absent».
describe('health rows in Russian', () => {
  beforeEach(() => {
    setLocale('ru');
    resetMissing();
  });
  afterEach(() => setLocale('en'));

  it('titles and the trend reason read Russian', () => {
    const m = composeAttention(
      createAttentionContributors({
        health: {
          supervisor: { status: 'unavailable', error: 'down' },
          trend: { available: false, samples: [], reason: 'sample_failed' },
        },
      }),
    );
    const byId = new Map(m.items.map((item) => [item.id, item]));
    expect(byId.get('health:dolt-noms-unavailable')?.title).toBe(
      'Нет тренда хранилища (dolt-noms)',
    );
    expect(byId.get('health:dolt-noms-unavailable')?.summary).toBe(
      'последнее чтение состояния супервизора не удалось',
    );
    expect(byId.get('health:supervisor-unreachable')?.title).toBe('Супервизор недоступен');
    expect(collectMissing()).toEqual([]);
  });
});
