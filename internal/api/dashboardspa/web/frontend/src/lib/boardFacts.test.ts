import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLocale } from '../i18n';
import type { BeadAttentionSession } from '../attention/beadsNeedingAttention';
import type { SupervisorBead } from '../supervisor/beadReads';
import { LIVE_59WD5S, LIVE_7LPZG7, LIVE_MQFCX13 } from '../test/fixtures/liveCards';
import { m04Idle } from '../test/fixtures/m04Idle';
import { ALL_PROJECTS, buildBoardModel, type BoardData, type BoardModel } from './boardModel';
import {
  currentMilestones,
  isServiceAgent,
  lastProgressMs,
  mayorMentionsFrom,
  mergedToday,
  mergedWithin,
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

// Live cards, verbatim keys (test/fixtures/liveCards): dw-mqfcx.13 has no PR
// key of its own; PR #489 is on its land bead dw-7lpzg7. dw-59wd5s is ready,
// nobody took it since 12.11, no stage label.
const MQFCX13 = LIVE_MQFCX13;
const LAND = LIVE_7LPZG7;
const W59 = LIVE_59WD5S;

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

  it('a ready card between two current milestones is not old-untaken', () => {
    const old = iso(NOW - 4 * 86_400_000);
    const model = modelOf({
      items: [
        working('dw-4', 5 * MIN, { labels: ['milestone:M04'] }),
        working('dw-6', 5 * MIN, { labels: ['milestone:M06'] }),
        bead('dw-5', { labels: ['milestone:M05'], created_at: old }),
        bead('dw-3', { labels: ['milestone:M03'], created_at: old }),
      ],
    });
    expect(currentMilestones(model, NOW)).toEqual(['M04', 'M06']);
    expect(oldUntaken(model, NOW).map((c) => c.node.bead.id)).toEqual(['dw-3']);
  });

  it('dw-59wd5s (ready, unclaimed 3 days, blocks nothing current) is not stuck and is old-untaken', () => {
    const model = modelOf({ items: [W59, working('dw-a', 5 * MIN)] });
    expect(stuckItems(model, ctx({ sessions: [session('worker-1', NOW - MIN)] }))).toEqual([]);
    expect(oldUntaken(model, NOW).map((c) => c.node.bead.id)).toEqual(['dw-59wd5s']);
  });

  // Live shape: the PR number is read from the land bead (never-invent-keys
  // ruling); no live key says «черновик», so the reason does not.
  it('dw-mqfcx.13 with PR #489 on its land bead, no assignee for 3 days, is stuck', () => {
    const model = modelOf({ items: [MQFCX13, LAND] });
    expect(model.columns.pr.map((c) => c.node.bead.id)).toEqual(['dw-mqfcx.13']);
    expect(model.columns.pr[0]?.stage.pr).toEqual({
      number: '489',
      url: 'https://github.com/TheDeveloperTom/career-ops-platform/pull/489',
    });
    const items = stuckItems(model, ctx());
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: 'card:dw-mqfcx.13',
      cardId: 'dw-mqfcx.13',
      mayor: 'not-told',
      mayorEvidence: null,
    });
    expect(items[0]?.reason.text).toBe('PR #489 открыт, никто не ведёт 3 дн.');
  });

  it('the land bead is found by gc.source_bead_id or devwork.task too', () => {
    for (const key of ['gc.source_bead_id', 'devwork.task']) {
      const task = { ...MQFCX13, metadata: { 'devwork.task_branch': 'devwork/task/dw-mqfcx.13' } };
      const land = {
        ...LAND,
        metadata: { [key]: 'dw-mqfcx.13', pr_number: '489' },
      };
      const model = modelOf({ items: [task, land] });
      expect(
        model.columns.pr.map((c) => c.node.bead.id),
        key,
      ).toEqual(['dw-mqfcx.13']);
    }
  });

  it('a task with its own devwork.pr_number keeps it', () => {
    const task = { ...MQFCX13, metadata: { ...MQFCX13.metadata, 'devwork.pr_number': '500' } };
    const model = modelOf({ items: [task, LAND] });
    expect(model.columns.pr[0]?.stage.pr?.number).toBe('500');
  });

  it('without a PR anywhere dw-mqfcx.13 waits and is not stuck', () => {
    const model = modelOf({ items: [MQFCX13] });
    expect(model.columns.waiting.map((c) => c.node.bead.id)).toEqual(['dw-mqfcx.13']);
    expect(stuckItems(model, ctx())).toEqual([]);
  });

  it('a marked owner question with no Discord link is stuck as the Mayor’s work', () => {
    const asked = bead('dw-ask', {
      title: 'Когда переносим ящик?',
      labels: ['needs/operator'],
      created_at: iso(NOW - 3 * 60 * MIN),
      updated_at: iso(NOW - 3 * 60 * MIN),
      metadata: { 'decision.question_id': 'q-1', 'owner.link': 'javascript:alert(1)' },
    });
    const linked = bead('dw-ok', {
      labels: ['needs/operator'],
      metadata: {
        'decision.question_id': 'q-2',
        'owner.link': 'https://discord.com/channels/1/2/3',
      },
    });
    const items = stuckItems(modelOf({ items: [asked, linked] }), ctx());
    expect(items.map((i) => i.key)).toEqual(['unlinked-question:dw-ask']);
    expect(items[0]?.reason.text).toBe('вопрос владельцу без ссылки — Мэр должен переспросить');
    expect(items[0]?.sinceMs).toBe(NOW - 3 * 60 * MIN);
  });

  it('mayor knows from needs/operator', () => {
    const model = modelOf({ items: [{ ...MQFCX13, labels: ['needs/operator'] }, LAND] });
    const item = stuckItems(model, ctx())[0];
    expect(item?.mayor).toBe('knows');
    expect(item?.mayorEvidence).toBe('needs/operator');
  });

  // owner 17.11: a card the Mayor paused waits; it is not «stuck» in work.
  it('a card on hold:mayor is paused, not stuck', () => {
    const model = modelOf({ items: [{ ...MQFCX13, labels: ['hold:mayor'] }, LAND] });
    expect(stuckItems(model, ctx()).filter((i) => i.key.includes(MQFCX13.id))).toEqual([]);
  });

  it('a label merely containing «escalat» is not the escalation label', () => {
    const model = modelOf({ items: [{ ...MQFCX13, labels: ['escalation-drill'] }, LAND] });
    expect(stuckItems(model, ctx())[0]?.mayor).toBe('not-told');
  });

  it('mayor knows from a mail naming the root id', () => {
    const model = modelOf({ items: [MQFCX13, LAND] });
    const mentions = new Map([['dw-mqfcx', 'STALL-WATCH stall:dw-mqfcx']]);
    const item = stuckItems(model, ctx({ mayorMentions: mentions }))[0];
    expect(item?.mayor).toBe('knows');
    expect(item?.mayorEvidence).toBe('STALL-WATCH stall:dw-mqfcx');
  });

  it('unread mayor inbox gives unknown', () => {
    const model = modelOf({ items: [MQFCX13, LAND] });
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

describe('mergedWithin', () => {
  it('mergedWithin keeps closed ≤7 days, drops 8 days, sorts newest first', () => {
    const DAY = 86_400_000;
    const at = (ago: number) => new Date(NOW - ago).toISOString();
    const model = modelOf({
      items: [
        bead('dw-8d', { status: 'closed', updated_at: at(8 * DAY) }),
        bead('dw-7d', { status: 'closed', updated_at: at(7 * DAY) }),
        bead('dw-1h', { status: 'closed', updated_at: at(60 * MIN) }),
        bead('dw-2d', { status: 'closed', updated_at: at(2 * DAY) }),
      ],
    });
    expect(mergedWithin(model, NOW).map((c) => c.node.bead.id)).toEqual([
      'dw-1h',
      'dw-2d',
      'dw-7d',
    ]);
    expect(mergedWithin(model, NOW, 1).map((c) => c.node.bead.id)).toEqual(['dw-1h']);
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

  it('HQ rig devwork-platform is labelled «Город (служебное)», a rig «Продукт <rig>» (polish2)', () => {
    expect(projectLabel('devwork-platform', 'devwork-platform')).toBe('Город (служебное)');
    expect(projectLabel('devwork', 'devwork-platform')).toBe('Продукт devwork');
  });
});
