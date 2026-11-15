import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLocale } from '../i18n';
import type { BeadAttentionSession } from '../attention/beadsNeedingAttention';
import type { SupervisorBead } from '../supervisor/beadReads';
import { m04Idle } from '../test/fixtures/m04Idle';
import { ALL_PROJECTS, buildBoardModel, type BoardData, type BoardModel } from './boardModel';
import {
  currentMilestones,
  isServiceAgent,
  lastProgressMs,
  mayorMentionsFrom,
  mergedToday,
  oldUntaken,
  projectLabel,
  STUCK_AFTER_MS,
  OLD_UNTAKEN_MS,
  stuckItems,
  type FactsContext,
} from './boardFacts';

// V1 «Застряло», V2 «Мэр знает», V4 current milestones; one model, one
// predicate each.

beforeEach(() => setLocale('ru'));
afterEach(() => setLocale('en'));

const NOW = Date.parse('2026-11-15T12:00:00Z');
const MIN = 60_000;
const RIGS = [{ name: 'devwork', prefix: 'dw' }];

function bead(id: string, extra: Partial<SupervisorBead> = {}): SupervisorBead {
  return {
    id,
    title: `bead ${id}`,
    status: 'open',
    issue_type: 'task',
    created_at: '2026-11-15T08:00:00Z',
    ...extra,
  };
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function modelOf(data: Partial<BoardData> & { items: readonly SupervisorBead[] }): BoardModel {
  return buildBoardModel(
    { routeItems: [], serviceItems: [], routesComplete: false, ...data },
    RIGS,
    { project: ALL_PROJECTS, search: '', showTests: false },
  );
}

function ctx(extra: Partial<FactsContext> = {}): FactsContext {
  return { nowMs: NOW, sessions: [], mayorMentions: new Map(), ...extra };
}

function session(name: string, lastActiveMs: number): BeadAttentionSession {
  return { id: `gc-${name}`, session_name: name, state: 'active', last_active: iso(lastActiveMs) };
}

function working(id: string, silentMs: number, extra: Partial<SupervisorBead> = {}) {
  return bead(id, {
    status: 'in_progress',
    assignee: 'worker-1',
    updated_at: iso(NOW - silentMs),
    labels: ['milestone:M04'],
    ...extra,
  });
}

// Live dw-mqfcx.13 (snapshot 15.11), plus the PR facts the city stamps.
const MQFCX13 = bead('dw-mqfcx.13', {
  title: 'dw-mqfcx.5 часть 2: миграция 0425 (удаление столбцов слепых вакансий)',
  parent: 'dw-mqfcx',
  priority: 3,
  created_at: '2026-11-12T12:14:34Z',
  updated_at: '2026-11-12T16:28:56Z',
  is_blocked: false,
  metadata: {
    'devwork.pr_number': '489',
    'devwork.pr_url': 'https://github.com/TheDeveloperTom/career-ops-platform/pull/489',
    'devwork.pr_draft': 'true',
    'devwork.task_branch': 'devwork/task/dw-mqfcx.13',
  },
  dependencies: [{ issue_id: 'dw-mqfcx.13', depends_on_id: 'dw-mqfcx', type: 'parent-child' }],
});

// Live dw-59wd5s: ready, nobody took it since 12.11, no stage label.
const W59 = bead('dw-59wd5s', {
  title: 'Land M03 #2 / Task 6: допуск, enqueue и claim по собственному ящику пользователя',
  priority: 1,
  created_at: '2026-11-12T07:21:13Z',
  updated_at: '2026-11-12T07:32:49Z',
  is_blocked: false,
});

describe('constants', () => {
  it('are the ruling values', () => {
    expect(STUCK_AFTER_MS).toBe(3_600_000);
    expect(OLD_UNTAKEN_MS).toBe(3 * 86_400_000);
  });
});

describe('lastProgressMs', () => {
  it('is the newest of session, step and card', () => {
    const card = modelOf({ items: [working('dw-a', 90 * MIN)] }).columns.working[0];
    if (card === undefined) throw new Error('working card expected');
    expect(lastProgressMs(card, [])).toBe(NOW - 90 * MIN);
    expect(lastProgressMs(card, [session('worker-1', NOW - 5 * MIN)])).toBe(NOW - 5 * MIN);
  });
});

describe('stuckItems', () => {
  it('working card silent 61 min is stuck, 59 min is not', () => {
    const stuck = modelOf({ items: [working('dw-a', 61 * MIN)] });
    const fine = modelOf({ items: [working('dw-b', 59 * MIN)] });
    const sessions61 = [session('worker-1', NOW - 61 * MIN)];
    const sessions59 = [session('worker-1', NOW - 59 * MIN)];
    const items = stuckItems(stuck, ctx({ sessions: sessions61 }));
    expect(items.map((i) => i.cardId)).toEqual(['dw-a']);
    expect(items[0]).toMatchObject({ href: '/beads?bead=dw-a', sinceMs: NOW - 61 * MIN });
    expect(stuckItems(fine, ctx({ sessions: sessions59 }))).toEqual([]);
  });

  it('idle cause older than 1h is one item per cause', () => {
    const input = m04Idle();
    const model = modelOf({
      items: input.tasks,
      routeItems: input.routeItems,
      serviceItems: input.serviceItems,
      routesComplete: true,
    });
    const keys = stuckItems(model, ctx()).map((i) => i.key);
    expect(keys.filter((k) => k === 'idle:card:dw-4xn4b')).toHaveLength(1);
    expect(keys.filter((k) => k === 'idle:decision:dw-ssmbcp')).toHaveLength(1);
    expect(keys).toHaveLength(2);

    const fresh = m04Idle();
    for (const b of [...fresh.tasks, ...fresh.serviceItems]) b.created_at = iso(NOW - 30 * MIN);
    const freshModel = modelOf({
      items: fresh.tasks,
      routeItems: fresh.routeItems,
      serviceItems: fresh.serviceItems,
      routesComplete: true,
    });
    expect(stuckItems(freshModel, ctx())).toEqual([]);
  });

  it('unassigned card blocking a current-milestone card is stuck', () => {
    const held = working('dw-held', 5 * MIN, { title: 'M04 #5 — разбор ответа' });
    const waiter = bead('dw-waiter', {
      title: 'M04 #6 — отправка',
      labels: ['milestone:M04'],
      is_blocked: true,
      dependencies: [{ issue_id: 'dw-waiter', depends_on_id: 'dw-blocker', type: 'blocks' }],
    });
    const blocker = bead('dw-blocker', {
      title: 'Схема ответа',
      created_at: iso(NOW - 2 * 60 * MIN),
      updated_at: iso(NOW - 2 * 60 * MIN),
    });
    const model = modelOf({ items: [held, waiter, blocker] });
    const items = stuckItems(model, ctx({ sessions: [session('worker-1', NOW - MIN)] }));
    expect(items.map((i) => i.cardId)).toEqual(['dw-blocker']);
    expect(items[0]?.reason.text).toBe('Никто не взял, а её ждёт «M04 #6 — отправка»');
    expect(items[0]?.sinceMs).toBe(NOW - 2 * 60 * MIN);
  });

  it('dw-59wd5s (ready, unclaimed 3 days, blocks nothing current) is not stuck and is old-untaken', () => {
    const model = modelOf({ items: [W59, working('dw-a', 5 * MIN)] });
    expect(stuckItems(model, ctx({ sessions: [session('worker-1', NOW - MIN)] }))).toEqual([]);
    expect(oldUntaken(model, NOW).map((c) => c.node.bead.id)).toEqual(['dw-59wd5s']);
  });

  it('dw-mqfcx.13 with draft PR #489, no assignee for 3 days, is stuck', () => {
    const model = modelOf({ items: [MQFCX13] });
    const items = stuckItems(model, ctx());
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: 'card:dw-mqfcx.13',
      cardId: 'dw-mqfcx.13',
      mayor: 'not-told',
      mayorEvidence: null,
    });
    expect(items[0]?.reason.text).toBe('PR #489 — черновик, никто не ведёт 3 дн.');
  });

  it('mayor knows from hold:mayor', () => {
    const model = modelOf({ items: [{ ...MQFCX13, labels: ['hold:mayor'] }] });
    const item = stuckItems(model, ctx())[0];
    expect(item?.mayor).toBe('knows');
    expect(item?.mayorEvidence).toBe('hold:mayor');
  });

  it('mayor knows from a mail naming the root id', () => {
    const model = modelOf({ items: [MQFCX13] });
    const mentions = new Map([['dw-mqfcx', 'STALL-WATCH stall:dw-mqfcx']]);
    const item = stuckItems(model, ctx({ mayorMentions: mentions }))[0];
    expect(item?.mayor).toBe('knows');
    expect(item?.mayorEvidence).toBe('STALL-WATCH stall:dw-mqfcx');
  });

  it('unread mayor inbox gives unknown', () => {
    const model = modelOf({ items: [MQFCX13] });
    expect(stuckItems(model, ctx({ mayorMentions: null }))[0]?.mayor).toBe('unknown');
  });

  it('lists the oldest first', () => {
    const model = modelOf({ items: [working('dw-new', 70 * MIN), working('dw-old', 300 * MIN)] });
    expect(stuckItems(model, ctx()).map((i) => i.cardId)).toEqual(['dw-old', 'dw-new']);
  });
});

describe('mayorMentionsFrom', () => {
  it('names the ids of mails from the last 48 h', () => {
    const mentions = mayorMentionsFrom(
      [
        {
          subject: 'STALL-WATCH stall:dw-mqfcx',
          body: 'root dw-mqfcx',
          created_at: iso(NOW - 3_600_000),
        },
        { subject: 'old dw-old1', body: '', created_at: iso(NOW - 49 * 3_600_000) },
      ],
      NOW,
    );
    expect(mentions.get('dw-mqfcx')).toBe('STALL-WATCH stall:dw-mqfcx');
    expect(mentions.has('dw-old1')).toBe(false);
  });
});

describe('currentMilestones', () => {
  it('M04 with a working card is current; none active → lowest open milestone', () => {
    const active = modelOf({
      items: [
        bead('dw-3', { labels: ['milestone:M03'] }),
        working('dw-4', 5 * MIN),
        bead('dw-5', { labels: ['milestone:M05'] }),
      ],
    });
    expect(currentMilestones(active, NOW)).toEqual(['M04']);
    const quiet = modelOf({
      items: [
        bead('dw-10', { labels: ['milestone:M10'] }),
        bead('dw-5', { labels: ['milestone:M05'] }),
      ],
    });
    expect(currentMilestones(quiet, NOW)).toEqual(['M05']);
  });

  it('a milestone with a card merged today is current', () => {
    const model = modelOf({
      items: [
        bead('dw-3', { labels: ['milestone:M03'] }),
        bead('dw-6', {
          labels: ['milestone:M06'],
          status: 'closed',
          updated_at: iso(NOW - 60 * MIN),
        }),
      ],
    });
    expect(currentMilestones(model, NOW)).toEqual(['M06']);
  });
});

describe('mergedToday', () => {
  it('mergedToday drops yesterday 23:59', () => {
    const now = new Date(2026, 10, 15, 12, 0).getTime();
    const model = modelOf({
      items: [
        bead('dw-y', {
          status: 'closed',
          updated_at: new Date(2026, 10, 14, 23, 59).toISOString(),
        }),
        bead('dw-t1', { status: 'closed', updated_at: new Date(2026, 10, 15, 0, 1).toISOString() }),
        bead('dw-t2', {
          status: 'closed',
          updated_at: new Date(2026, 10, 15, 11, 0).toISOString(),
        }),
      ],
    });
    expect(mergedToday(model, now).map((c) => c.node.bead.id)).toEqual(['dw-t2', 'dw-t1']);
  });
});

describe('agents and projects', () => {
  it('bd.dog and claude are service agents', () => {
    expect(isServiceAgent({ name: 'bd.dog' }, RIGS)).toBe(true);
    expect(isServiceAgent({ name: 'claude', rig: 'devwork' }, RIGS)).toBe(true);
    expect(isServiceAgent({ name: 'devwork/superpowers.implementer', rig: 'devwork' }, RIGS)).toBe(
      false,
    );
    expect(isServiceAgent({ name: 'devwork/worker', rig: null }, RIGS)).toBe(true);
  });

  it('HQ rig devwork-platform is labelled Город', () => {
    expect(projectLabel('devwork-platform', 'devwork-platform')).toBe('Город');
    expect(projectLabel('devwork', 'devwork-platform')).toBe('devwork');
  });
});
