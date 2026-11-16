import { describe, expect, it } from 'vitest';
import type { Bead } from 'gas-city-dashboard-shared/gc-supervisor';
import type { PeerRuns } from '../supervisor/peerBoardReads';
import type { PeerBoardSource } from './boardOwner';
import { ALL_PROJECTS, buildBoardModel, type BoardCard, type BoardFilters, type BoardModel } from './boardModel';
import { STAGES, stepNoteOf } from './stageBoard';

// PEER-STAGE (16.11): a peer's card lands in the column it has on its home
// board. The home city ships its open runs of shared cards (`runs`); the
// board places the peer's cards with them through the same stageCardsOf our
// own cards use. Without runs (an older city) the placement is today's.

const RIGS = [{ name: 'devwork', prefix: 'dw' }];
const NO_FILTERS: BoardFilters = { project: ALL_PROJECTS, search: '', showTests: false };
const TASK = 'dw-ab12';
const ROOT = 'gcg-100';

const bead = (id: string, extra: Partial<Bead> = {}): Bead => ({
  id,
  title: id,
  status: 'open',
  issue_type: 'task',
  created_at: '2026-11-16T08:00:00Z',
  ...extra,
});
const task = (extra: Partial<Bead> = {}) => bead(TASK, { title: 'Мобильная панель', status: 'in_progress', ...extra });
const root = (meta: Record<string, string> = {}, extra: Partial<Bead> = {}) =>
  bead(ROOT, {
    title: 'devwork-development',
    status: 'in_progress',
    is_blocked: false,
    ...extra,
    metadata: { 'gc.kind': 'workflow', 'gc.var.issue': TASK, ...meta },
  });
let n = 0;
const step = (stage: string | null, extra: Partial<Bead> = {}, meta: Record<string, string> = {}) => {
  n += 1;
  return bead(`gcg-${300 + n}`, {
    title: `Step ${n}`,
    is_blocked: true,
    ...extra,
    metadata: {
      'gc.root_bead_id': ROOT,
      ...(stage === null ? {} : { 'dashboard.stage': stage }),
      ...meta,
    },
  });
};
const running = (stage: string, label: string) =>
  step(stage, { status: 'in_progress', is_blocked: false }, { 'dashboard.label': label });

function peer(cards: { rig: string; bead: Bead }[], runs: PeerRuns | null): PeerBoardSource {
  return {
    owner: 'peer:rich',
    login: 'rich',
    label: 'Ричарда',
    name: 'Ричард',
    dative: null,
    avatar: 'Р',
    available: true,
    asOf: '2026-11-16T18:52:00Z',
    stale: false,
    live: null,
    fetchedAt: null,
    cards,
    runs,
  };
}

const all = (m: BoardModel): BoardCard[] => STAGES.flatMap((s) => [...m.columns[s.id]]);
const peerCard = (m: BoardModel, id = TASK) => all(m).find((c) => c.peer !== null && c.node.bead.id === id);
const ownCard = (m: BoardModel, id = TASK) => all(m).find((c) => c.peer === null && c.node.bead.id === id);
const view = (c: BoardCard | undefined) =>
  c === undefined
    ? null
    : {
        stage: c.stage.stage,
        note: stepNoteOf(c.stage),
        pr: c.stage.pr,
        marks: c.stage.marks.map((m) => m.kind),
        wait: c.wait?.kind ?? null,
      };

/** The peer's card, placed from his runs, on OUR board. */
function onPeerBoard(t: Bead, runs: Bead[], complete = true, rig = 'devwork', others: Bead[] = []) {
  const model = buildBoardModel({ items: [], routeItems: [], serviceItems: [], routesComplete: true }, RIGS, NO_FILTERS, [
    peer([{ rig, bead: t }, ...others.map((b) => ({ rig, bead: b }))], { complete, beads: runs }),
  ]);
  return { model, card: peerCard(model) };
}

/** The same card on ITS HOME board (as the peer's own dashboard places it). */
function onHomeBoard(t: Bead, runs: Bead[], complete = true, others: Bead[] = []) {
  const model = buildBoardModel(
    { items: [t, ...others], routeItems: runs, serviceItems: [], routesComplete: complete },
    RIGS,
    NO_FILTERS,
  );
  return { model, card: ownCard(model) };
}

// Each case of the PEER-STAGE design table (report §3) that the model owns.
const CASES: ReadonlyArray<[string, Bead, Bead[], boolean, Bead[]]> = [
  ['1 no live run, in progress (complete read)', task(), [], true, []],
  ['1 no live run, in progress (incomplete read)', task(), [], false, []],
  ['1 no live run, open', task({ status: 'open' }), [], true, []],
  ['2 run at a working step', task(), [root(), running('working', 'пишет код'), step('review')], true, []],
  ['2 run at the review step', task(), [root(), running('review', 'ревью'), step('pr')], true, []],
  ['4 closed card with a run left over', task({ status: 'closed' }), [root(), step('pr')], true, []],
  ['5 queued run (waits for earlier runs)', task({ status: 'open' }), [root({}, { status: 'open', is_blocked: true }), step('working')], true, []],
  [
    '5 waits on another card',
    task({ status: 'open', dependencies: [{ issue_id: TASK, depends_on_id: 'dw-bb', type: 'blocks' }] }),
    [],
    true,
    [bead('dw-bb', { title: 'blocker' })],
  ],
  ['6 stop requested on the run', task(), [root({ 'gc.cancel_requested': 'true' }), running('working', 'пишет код')], true, []],
  ['7 PR on the task, run still working', task({ metadata: { 'devwork.pr_number': '584' } }), [root(), running('working', 'пишет код')], true, []],
  [
    '7 waiting merge at the PR gate',
    task(),
    [
      root(),
      step(null, { issue_type: 'gate', is_blocked: false }, { 'devwork.pr_number': '584', 'devwork.pr_url': 'https://github.com/o/r/pull/584' }),
      step('pr', {}, { 'dashboard.label': 'ждёт вливания' }),
    ],
    true,
    [],
  ],
  ['9 a step stage this engine does not know', task(), [root(), running('qa', 'проверка QA')], true, []],
  ['9 an unknown stage next to a known one', task(), [root(), running('qa', 'проверка QA'), running('review', 'ревью')], true, []],
];

describe('PEER-STAGE: a peer card lands where its home board puts it', () => {
  it.each(CASES)('%s', (_name, t, runs, complete, others) => {
    const home = view(onHomeBoard(t, runs, complete, others).card);
    const here = view(onPeerBoard(t, runs, complete, 'devwork', others).card);
    expect(home).not.toBeNull();
    expect(here).toEqual(home);
  });

  it('the reported case: his card at review is in «Ревью» here too, with its note', () => {
    const { model, card } = onPeerBoard(task(), [root(), running('review', 'ревью'), step('pr')]);
    expect(card?.stage.stage).toBe('review');
    expect(stepNoteOf(card!.stage)).toBe('ревью');
    expect(model.columns.review.map((c) => c.key)).toEqual(['peer:rich:devwork:dw-ab12']);
    expect(model.columns.working).toEqual([]);
  });

  it('waiting merge: «PR» with the PR number and «ждёт вливания»', () => {
    const { card } = onPeerBoard(task(), CASES[10]![2]);
    expect(card?.stage.stage).toBe('pr');
    expect(card?.stage.pr).toEqual({ number: '584', url: 'https://github.com/o/r/pull/584' });
    expect(stepNoteOf(card!.stage)).toBe('ждёт вливания');
  });

  it('3 without runs (an older city) the placement is today\'s: status only', () => {
    const model = buildBoardModel({ items: [], routeItems: [], serviceItems: [], routesComplete: true }, RIGS, NO_FILTERS, [
      peer([{ rig: 'devwork', bead: task() }], null),
    ]);
    const card = peerCard(model);
    expect(card?.stage.stage).toBe('working');
    expect(card?.stage.marks).toEqual([]);
    expect(stepNoteOf(card!.stage)).toBeNull();
  });

  it('8 a run of his other rig still places his card (runs are per city, matched by task)', () => {
    const runs = [root({ 'gc.root_store_ref': 'rig:crm-api' }), running('review', 'ревью')];
    expect(onPeerBoard(task(), runs, true, 'crm-api').card?.stage.stage).toBe('review');
  });

  it('a run of a card he did not share places nothing', () => {
    const runs = [root({ 'gc.var.issue': 'dw-hidden' }), running('review', 'ревью')];
    expect(onPeerBoard(task(), runs).card?.stage.stage).toBe('working');
  });

  it('his runs never touch our cards with the same id, nor ours his', () => {
    const ours = task();
    const model = buildBoardModel(
      { items: [ours], routeItems: [], serviceItems: [], routesComplete: true },
      RIGS,
      NO_FILTERS,
      [peer([{ rig: 'devwork', bead: task() }], { complete: true, beads: [root(), running('review', 'ревью')] })],
    );
    expect(ownCard(model)?.stage.stage).toBe('working');
    expect(peerCard(model)?.stage.stage).toBe('review');
    // idle and orphan runs are about our city only
    expect(model.orphanRuns).toBe(0);
  });

  it('15 column counts follow the placement', () => {
    const { model } = onPeerBoard(task(), [root(), running('review', 'ревью')]);
    expect(model.columns.review).toHaveLength(1);
    expect(model.columns.working).toHaveLength(0);
    expect(model.matched).toBe(1);
  });

  it('14/16 filters apply after placement: owner, project, search, epic', () => {
    const runs = [root(), running('review', 'ревью')];
    const sources = [peer([{ rig: 'devwork', bead: task({ labels: ['milestone:M04'] }) }], { complete: true, beads: runs })];
    const empty = { items: [], routeItems: [], serviceItems: [], routesComplete: true };
    const reviewKeys = (f: Partial<BoardFilters>) =>
      buildBoardModel(empty, RIGS, { ...NO_FILTERS, ...f }, sources).columns.review.map((c) => c.key);
    const key = ['peer:rich:devwork:dw-ab12'];
    expect(reviewKeys({ owner: 'peer:rich' })).toEqual(key);
    expect(reviewKeys({ owner: 'me' })).toEqual([]);
    expect(reviewKeys({ project: 'devwork' })).toEqual(key);
    expect(reviewKeys({ project: 'peer:rich:devwork' })).toEqual(key);
    expect(reviewKeys({ search: 'мобильная' })).toEqual(key);
    expect(reviewKeys({ search: 'nothing like it' })).toEqual([]);
    // L14: our epic filter never shows his cards, wherever they are placed
    expect(reviewKeys({ epic: 'M04' })).toEqual([]);
  });
});
