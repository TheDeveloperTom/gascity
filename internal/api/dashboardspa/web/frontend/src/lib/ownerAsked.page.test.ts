import { describe, expect, it } from 'vitest';
import type { AttentionItem } from '../attention/compose';
import type { SupervisorBead } from '../supervisor/beadReads';
import { buildBoardGraph } from '../vk/graph/boardModel';
import { beadIdOf, buildGraph, holdsLabel, whatIfBanner, type GraphModel } from '../vk/graph/model';
import type { BoardData } from './boardModel';
import { needsFromBoard } from './needsFromMe';
import { ownerAskedOf, ownerBeadsOf } from './ownerAsked';

// REVIEW 16.11 (OWNER-QUESTIONS-REVIEW.md): every view is built from what its
// page really loads. useBoardData gives one BoardData — the unscoped window
// (items), each rig's open work store (rigStoreItems) and the service beads —
// and ONE owner model computed from its raw union (ownerBeadsOf → ownerAskedOf).
// The shelf and badge (needsFromBoard), the all-tickets graph and the
// per-epic graph (routes/Beads.tsx graphRows = the same union) all take it.

const NOW_MS = Date.parse('2026-11-16T20:00:00Z');
const OLD = '2026-11-10T10:00:00Z';
const LINK = 'https://discord.com/channels/1/2/3';

function bead(id: string, over: Partial<SupervisorBead> = {}): SupervisorBead {
  return { id, title: id, status: 'open', issue_type: 'task', created_at: OLD, updated_at: OLD, ...over } as SupervisorBead;
}
const asked = (qid: string, link = true) => ({
  'decision.question_id': qid,
  'decision.decide': `вопрос ${qid}?`,
  'decision.asked_at': OLD,
  ...(link ? { 'owner.link': LINK } : {}),
});
const blocks = (...ids: string[]) =>
  ids.map((id) => ({ issue_id: '', depends_on_id: id, type: 'blocks' })) as NonNullable<SupervisorBead['dependencies']>;
const gate = (id: string, qid: string, over: Partial<SupervisorBead> = {}) =>
  bead(id, { issue_type: 'gate', labels: ['needs/operator'], metadata: { ...asked(qid), 'gc.gate_type': 'human' }, ...over });

interface Pages {
  needs: ReturnType<typeof needsFromBoard>;
  all: ReturnType<typeof buildBoardGraph>;
  epic: (key: string) => GraphModel;
}

/** What the pages build from one useBoardData result. */
function pages(data: BoardData, ownerItems: readonly AttentionItem[] = []): Pages {
  const rows = ownerBeadsOf(data);
  const owner = ownerAskedOf(rows);
  return {
    needs: needsFromBoard(data, [], [], NOW_MS, false, ownerItems, owner),
    all: buildBoardGraph(rows, { nowMs: NOW_MS, owner }),
    epic: (key) => buildGraph(rows, { epicId: key, nowMs: NOW_MS, owner }),
  };
}
const board = (items: SupervisorBead[], rigStoreItems: SupervisorBead[] = [], serviceItems: SupervisorBead[] = []): BoardData => ({
  items,
  rigStoreItems,
  routeItems: [],
  serviceItems,
  routesComplete: true,
});
const questionIds = (p: Pages) => p.needs.needs.filter((n) => n.kind === 'question').map((n) => n.id).sort();
const graphQuestions = (g: { nodes: GraphModel['nodes'] }) =>
  g.nodes.filter((n) => n.kind === 'question').map((n) => beadIdOf(n.id)).sort();
const holdsOf = (g: { nodes: GraphModel['nodes'] }, id: string) => g.nodes.find((n) => n.kind === 'question' && beadIdOf(n.id) === id)?.holds;
const needHolds = (p: Pages, id: string) => p.needs.needs.find((n) => n.id === id)?.holds;
const node = (g: { nodes: GraphModel['nodes'] }, id: string) => g.nodes.find((n) => n.id === id);

describe('one owner model for every page (review 16.11)', () => {
  it('HIGH 1: dependents only in a rig store count on the shelf and on the graph alike', () => {
    const p = pages(
      board([gate('dw-q', 'q1')], [bead('dw-a', { labels: ['milestone:M04'], dependencies: blocks('dw-q') }), bead('dw-b', { labels: ['milestone:M04'], dependencies: blocks('dw-q') })]),
    );
    expect(needHolds(p, 'dw-q')).toBe(2);
    expect(holdsOf(p.all, 'dw-q')).toBe(2);
    expect(p.needs.questionCount).toBe(p.all.columns[0]?.count);
  });

  it('HIGH 1: a question asked only in a rig store is on the shelf, the badge and the graph', () => {
    const p = pages(board([], [gate('dw-q', 'q1'), bead('dw-a', { dependencies: blocks('dw-q') })]));
    expect(questionIds(p)).toEqual(['dw-q']);
    expect(graphQuestions(p.all)).toEqual(['dw-q']);
    expect(p.needs.count).toBe(1);
  });

  it('HIGH 2: an asked question on a noise or service carrier is never dropped by the graph', () => {
    const noise = bead('dw-r1', { title: 'Repair PR #12', labels: ['needs/operator'], metadata: asked('q-r') });
    const person = bead('dw-r2', { labels: ['needs/operator'], metadata: { ...asked('q-p'), 'devwork.intake_needs_person': 'true' } });
    const service = bead('dw-s1', { labels: ['needs/operator'], metadata: asked('q-s') });
    const p = pages(board([noise, person], [], [service]));
    expect(questionIds(p)).toEqual(['dw-r1', 'dw-r2', 'dw-s1']);
    expect(graphQuestions(p.all)).toEqual(['dw-r1', 'dw-r2', 'dw-s1']);
    expect(p.all.columns[0]?.count).toBe(3);
    expect(p.needs.count).toBe(3);
  });

  it('MEDIUM 1: «держит N» counts through noise beads the same in all three views', () => {
    const p = pages(
      board([
        gate('dw-q', 'q1'),
        bead('dw-n', { title: 'стоит: dw-x', labels: ['milestone:M04'], dependencies: blocks('dw-q') }),
        bead('dw-x', { labels: ['milestone:M04'], dependencies: blocks('dw-n') }),
      ]),
    );
    expect(needHolds(p, 'dw-q')).toBe(2);
    expect(holdsOf(p.all, 'dw-q')).toBe(2);
    expect(holdsOf(p.epic('M04'), 'dw-q')).toBe(2);
    // the task behind the dropped noise bead waits for the owner, not «никто не взял»
    expect(node(p.all, 'dw-x')?.state).toBe('waits_owner');
  });

  describe('MEDIUM 2: a task held by an asked epic', () => {
    const data = board([
      bead('dw-e3', { issue_type: 'epic', title: 'M03. Эпик', labels: ['milestone:M03', 'needs/operator'], metadata: asked('q-e') }),
      bead('dw-m13', { title: 'M13 #7 — Обновить сценарии', labels: ['milestone:M13'], dependencies: blocks('dw-e3') }),
    ]);
    const p = pages(data);

    it('reads «ждёт тебя», never «свободна» or «никто не взял»', () => {
      expect(node(p.all, 'dw-m13')?.state).toBe('waits_owner');
      expect(node(p.all, 'dw-m13')?.reason).toMatch(/^ждёт тебя: /);
    });

    it('stays under «только то, что держит меня»', () => {
      const held = buildBoardGraph(ownerBeadsOf(data), { nowMs: NOW_MS, owner: ownerAskedOf(ownerBeadsOf(data)), filter: 'holds_me' });
      expect(held.nodes.map((n) => n.id).sort()).toEqual(['dw-e3', 'dw-m13']);
    });

    it('the banner says what answering opens', () => {
      expect(holdsOf(p.all, 'dw-e3')).toBe(1);
      expect(whatIfBanner(p.all, 'dw-e3')).toBe('Если ответишь: сразу пойдёт 1, всего откроется 1');
    });
  });

  it('MEDIUM 2: the per-epic banner counts every held task, not only this epic’s', () => {
    const p = pages(
      board([
        gate('dw-q', 'q1'),
        bead('dw-a', { labels: ['milestone:M03'], dependencies: blocks('dw-q') }),
        bead('dw-b', { labels: ['milestone:M04'], dependencies: blocks('dw-q') }),
        bead('dw-c', { labels: ['milestone:M04'], dependencies: blocks('dw-q') }),
      ]),
    );
    const m03 = p.epic('M03');
    expect(holdsOf(m03, 'dw-q')).toBe(3);
    expect(whatIfBanner(m03, 'dw-q')).toBe('Если ответишь: сразу пойдут 3, всего откроется 3');
  });

  describe('MEDIUM 3: the badge', () => {
    const ask: AttentionItem = {
      id: 'mail:M-1:unread',
      domain: 'mail',
      severity: 'attention',
      audience: 'owner',
      title: 'Нужен доступ',
      href: '/mail?message=M-1',
      updatedAt: OLD,
    } as AttentionItem;
    const p = pages(
      board([
        gate('dw-q', 'q1'),
        bead('dw-a', { dependencies: blocks('dw-q') }),
        // just asked: marked, question id, no Discord link yet
        bead('dw-u1', { labels: ['needs/operator'], metadata: asked('q-u', false) }),
        bead('dw-u2', { dependencies: blocks('dw-u1') }),
      ]),
      [ask],
    );

    it('is questions + mail/agent asks + owner-marked stalls; its question part is the «От тебя» header', () => {
      const asks = p.needs.needs.filter((n) => n.kind === 'ask').length;
      const marked = p.needs.stalls.filter((s) => s.forOwner).length;
      expect(p.needs.count).toBe(p.needs.questionCount + asks + marked);
      expect(p.needs.questionCount).toBe(p.all.columns[0]?.count);
      expect([p.needs.questionCount, asks, marked]).toEqual([1, 1, 1]);
    });

    it('a marked question with no link yet reads «вопрос задаётся» in the graph, not a free task', () => {
      expect(node(p.all, 'dw-u1')?.state).toBe('waits_owner');
      expect(node(p.all, 'dw-u1')?.reason).toBe('вопрос задаётся');
      expect(node(p.all, 'dw-u2')?.reason).toContain('вопрос задаётся');
    });
  });

  it('LOW: a task behind an unasked non-plan owner gate says the question is not asked yet', () => {
    const p = pages(
      board([
        bead('dw-g', { issue_type: 'gate', title: 'окно на проде', metadata: { 'gc.gate_type': 'human', 'devwork.owner_gate': 'true' } }),
        bead('dw-t', { dependencies: blocks('dw-g') }),
      ]),
    );
    expect(graphQuestions(p.all)).toEqual([]);
    expect(node(p.all, 'dw-t')?.reason).toBe('ждёт: окно на проде — вопрос ещё не задан');
  });

  it('a question card reads «ничего не держит» at 0 and «держит N» otherwise', () => {
    expect(holdsLabel(0)).toBe('ничего не держит');
    expect(holdsLabel(3)).toBe('держит 3');
  });
});
