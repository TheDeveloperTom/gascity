import { describe, expect, it } from 'vitest';
import type { Bead } from 'gas-city-dashboard-shared/gc-supervisor';

import { m04Idle } from '../test/fixtures/m04Idle';
import { ALL_EPICS, NO_EPIC } from './epics';
import {
  ALL_PROJECTS,
  buildBoardModel,
  type BoardData,
  type BoardFilters,
  type RigPrefix,
} from './boardModel';

function bead(id: string, extra: Partial<Bead> = {}): Bead {
  return {
    id,
    title: id,
    status: 'open',
    issue_type: 'task',
    created_at: '2026-11-15T08:00:00Z',
    ...extra,
  };
}

const RIGS: RigPrefix[] = [{ name: 'devwork', prefix: 'dw' }];
const NO_FILTERS: BoardFilters = { project: ALL_PROJECTS, search: '', showTests: false };

function data(items: Bead[], extra: Partial<BoardData> = {}): BoardData {
  return { items, routeItems: [], serviceItems: [], routesComplete: true, ...extra };
}

const DP = bead('dp-dh6', { title: 'Приёмка города: часть B' });
const IY = bead('dw-iy9a', {
  title: 'M04 — приёмка этапа (проверяемые пункты §5 L186)',
  labels: ['milestone:M04'],
  assignee: 'devwork/worker',
});

const ids = (cards: readonly { node: { bead: Bead } }[]) => cards.map((c) => c.node.bead.id);

describe('buildBoardModel', () => {
  it('one board for every project', () => {
    const model = buildBoardModel(data([DP, IY]), RIGS, NO_FILTERS);
    expect(ids(model.columns.waiting).sort()).toEqual(['dp-dh6', 'dw-iy9a']);
    expect(model.projects.map((p) => [p.key, p.count])).toEqual([
      ['all', 2],
      ['devwork', 1],
      ['city', 1],
    ]);
    const card = (id: string) => model.columns.waiting.find((c) => c.node.bead.id === id)!;
    // vk-final: more than one project ⇒ every card carries its project tag.
    expect(card('dp-dh6').tag).toBe('City');
    expect(card('dw-iy9a').tag).toBe('devwork');
  });

  it('one project only ⇒ no project tags', () => {
    const model = buildBoardModel(data([IY]), RIGS, NO_FILTERS);
    expect(model.projects.map((p) => p.key)).toEqual(['all', 'devwork']);
    expect(model.columns.waiting.every((c) => c.tag === null)).toBe(true);
  });

  it('project filter', () => {
    const model = buildBoardModel(data([DP, IY]), RIGS, { ...NO_FILTERS, project: 'city' });
    expect(ids(model.columns.waiting)).toEqual(['dp-dh6']);
    expect(model.projects.map((p) => p.count)).toEqual([2, 1, 1]);
    expect(model.columns.waiting[0]?.tag).toBeNull();
  });

  it('a rig without prefix hides the split', () => {
    const model = buildBoardModel(data([DP, IY]), [{ name: 'devwork' }], NO_FILTERS);
    expect(model.projects.map((p) => p.key)).toEqual(['all']);
    expect(model.columns.waiting.every((c) => c.tag === null)).toBe(true);
  });

  it('two rigs with cards tag every card', () => {
    const rigs = [
      { name: 'devwork', prefix: 'dw' },
      { name: 'east', prefix: 'ea' },
    ];
    const model = buildBoardModel(data([DP, IY, bead('ea-1')]), rigs, NO_FILTERS);
    const tags = Object.fromEntries(model.columns.waiting.map((c) => [c.node.bead.id, c.tag]));
    expect(tags).toEqual({ 'dp-dh6': 'City', 'dw-iy9a': 'devwork', 'ea-1': 'east' });
  });

  it('service beads never cards', () => {
    const order = bead('gcg-ord1', {
      title: 'order:archyl-drift-stage',
      labels: ['order-run:archyl-drift-stage', 'order-tracking'],
    });
    const model = buildBoardModel(data([DP, order]), RIGS, NO_FILTERS);
    const all = Object.values(model.columns).flatMap((col) => ids(col));
    expect(all).not.toContain('gcg-ord1');
  });

  it('test cards hidden until asked', () => {
    const drill = bead('dw-cojx', {
      title: 'drill27-r28',
      status: 'closed',
      labels: ['kind:test'],
      updated_at: '2026-11-15T09:00:00Z',
    });
    const hidden = buildBoardModel(data([DP, drill]), RIGS, NO_FILTERS);
    expect(Object.values(hidden.columns).flatMap((col) => ids(col))).not.toContain('dw-cojx');
    expect(hidden.testCount).toBe(1);
    const shown = buildBoardModel(data([DP, drill]), RIGS, { ...NO_FILTERS, showTests: true });
    const card = shown.columns.merged.find((c) => c.node.bead.id === 'dw-cojx');
    expect(card?.isTest).toBe(true);
  });

  it('Waiting groups by stage', () => {
    const items = [
      bead('dw-a', { labels: ['milestone:M04'] }),
      bead('dw-b', { labels: ['milestone:M04'] }),
      bead('dw-c', { labels: ['milestone:M03'] }),
      bead('dw-d', { parent: 'dw-mqfcx' }),
      bead('dw-e'),
      bead('dw-mqfcx', {
        issue_type: 'epic',
        title: 'Один тип пользователя вместо наставника и ученика',
      }),
      bead('dw-3511d68caffe01f8', {
        issue_type: 'epic',
        title: 'M04 / 0b. Понимание вакансии и соответствие конкретному клиенту',
        labels: ['milestone:M04'],
      }),
    ];
    const model = buildBoardModel(data(items), RIGS, NO_FILTERS);
    expect(model.waitingGroups.map((g) => g.key)).toEqual([
      'milestone:M03',
      'milestone:M04',
      'epic:dw-mqfcx',
      'none',
    ]);
    const m04 = model.waitingGroups.find((g) => g.key === 'milestone:M04')!;
    expect(m04.name).toBe('M04');
    expect(m04.subtitle).toBe('M04 / 0b. Понимание вакансии и соответствие конкретному клиенту');
    expect(model.waitingGroups.find((g) => g.key === 'epic:dw-mqfcx')?.name).toBe(
      'Один тип пользователя вместо наставника и ученика',
    );
    expect(model.waitingGroups.find((g) => g.key === 'none')?.name).toBe('No stage');
    const cardIds = ids(model.columns.waiting);
    expect(cardIds).not.toContain('dw-mqfcx');
    expect(cardIds).not.toContain('dw-3511d68caffe01f8');
  });

  it('an epic that heads no group is a card', () => {
    const lone = bead('dw-epic', { issue_type: 'epic' });
    const model = buildBoardModel(data([lone]), RIGS, NO_FILTERS);
    expect(ids(model.columns.waiting)).toEqual(['dw-epic']);
  });

  it('fold only a big Waiting', () => {
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => bead(`dw-${i}`, { labels: ['milestone:M04'] }));
    expect(buildBoardModel(data(many(13)), RIGS, NO_FILTERS).foldWaiting).toBe(true);
    expect(buildBoardModel(data(many(12)), RIGS, NO_FILTERS).foldWaiting).toBe(false);
    expect(
      buildBoardModel(data(many(13)), RIGS, { ...NO_FILTERS, search: 'M04' }).foldWaiting,
    ).toBe(false);
  });

  it('idle ignores filters', () => {
    const working = bead('dw-w', { status: 'in_progress' });
    const model = buildBoardModel(data([working, DP]), RIGS, { ...NO_FILTERS, project: 'city' });
    expect(model.idle.state).toBe('busy');
  });

  it('a stop card folds into its visible task', () => {
    const stop = bead('dw-stopcard', { metadata: { 'devwork.stopped_card': 'dw-stopped' } });
    const stopped = bead('dw-stopped');
    const both = buildBoardModel(data([stop, stopped]), RIGS, NO_FILTERS);
    expect(ids(both.columns.waiting)).toEqual(['dw-stopped']);
    const alone = buildBoardModel(data([stop]), RIGS, NO_FILTERS);
    expect(ids(alone.columns.waiting)).toEqual(['dw-stopcard']);
  });

  it("a drain's root is no orphan", () => {
    const input = m04Idle();
    const base = { ...input, items: input.tasks };
    expect(buildBoardModel(base, RIGS, NO_FILTERS).orphanRuns).toBe(0);
    const ghost = bead('gcg-ghost', {
      status: 'in_progress',
      metadata: { 'gc.kind': 'workflow', 'gc.var.issue': 'dw-ghost' },
    });
    const withGhost = { ...base, routeItems: [...base.routeItems, ghost] };
    expect(buildBoardModel(withGhost, RIGS, NO_FILTERS).orphanRuns).toBe(1);
  });

  it('cards carry the wait word and the hold count', () => {
    const input = m04Idle();
    const model = buildBoardModel({ ...input, items: input.tasks }, RIGS, NO_FILTERS);
    const blocker = model.columns.waiting.find((c) => c.node.bead.id === 'dw-4xn4b')!;
    expect(blocker.wait).toEqual({ kind: 'ready' });
    const waiter = model.columns.waiting.find((c) => c.node.bead.id === 'dw-eba63b7db1e9a14e.2')!;
    expect(waiter.wait?.kind).toBe('decision');
  });

  it('search is case-insensitive over id, title, labels, assignee', () => {
    const items = [DP, IY, bead('dw-x', { labels: ['milestone:M04'] })];
    const find = (search: string) =>
      ids(buildBoardModel(data(items), RIGS, { ...NO_FILTERS, search }).columns.waiting);
    expect(find('приёмка')).toContain('dp-dh6');
    expect(find('DW-IY9A')).toEqual(['dw-iy9a']);
    expect(find('milestone:m04').sort()).toEqual(['dw-iy9a', 'dw-x']);
    expect(find('DEVWORK/WORKER')).toEqual(['dw-iy9a']);
    expect(buildBoardModel(data(items), RIGS, { ...NO_FILTERS, search: 'x' }).matched).toBe(1);
  });

  const EPIC_ITEMS = [DP, IY, bead('dw-m5', { labels: ['milestone:M05'] })];

  it('epic filter M04 keeps only milestone:M04 cards', () => {
    const model = buildBoardModel(data(EPIC_ITEMS), RIGS, { ...NO_FILTERS, epic: 'M04' });
    expect(ids(model.columns.waiting)).toEqual(['dw-iy9a']);
    const all = buildBoardModel(data(EPIC_ITEMS), RIGS, { ...NO_FILTERS, epic: ALL_EPICS });
    expect(ids(all.columns.waiting).sort()).toEqual(['dp-dh6', 'dw-iy9a', 'dw-m5']);
  });

  it('epic filter none keeps only cards without a milestone', () => {
    const model = buildBoardModel(data(EPIC_ITEMS), RIGS, { ...NO_FILTERS, epic: NO_EPIC });
    expect(ids(model.columns.waiting)).toEqual(['dp-dh6']);
  });

  it('every card has owner "me"', () => {
    const model = buildBoardModel(data([DP, IY]), RIGS, { ...NO_FILTERS, owner: 'all' });
    expect(model.columns.waiting.map((c) => c.owner)).toEqual(['me', 'me']);
    const richard = buildBoardModel(data([DP, IY]), RIGS, { ...NO_FILTERS, owner: 'richard' });
    expect(ids(richard.columns.waiting)).toEqual([]);
  });
});
