import { describe, expect, it } from 'vitest';
import { beadIdOf, buildGraph, chainOf, questionNodeId, whatIfBanner, type GraphBead } from './model';

// The M04 chain of the owner-approved mockups (gen.py EPIC_ID / EPIC_EDGES),
// in the live bead shape: `needs` and `dependencies[]` both carry blockers,
// owner questions carry `needs/operator`, M03 T6 lives in another epic.
const NOW = Date.parse('2026-11-16T12:00:00Z');
const DAY = 86_400_000;

function bead(id: string, title: string, extra: Partial<GraphBead> = {}): GraphBead {
  return {
    id,
    title,
    status: 'open',
    issue_type: 'task',
    created_at: new Date(NOW - DAY / 2).toISOString(),
    labels: ['milestone:M04'],
    ...extra,
  };
}
// An owner question as the engine holds it (DIAG 20.11): an open human gate
// with a question posted (id + Discord link); the label is display only.
const asked = (id: string) => ({
  'gc.gate_type': 'human',
  'decision.question_id': `q-${id}`,
  'owner.link': `https://discord.com/channels/1/2/${id}`,
});
const q = (id: string, title: string, milestone = 'M04') =>
  bead(id, title, { issue_type: 'gate', labels: [`milestone:${milestone}`, 'needs/operator'], metadata: asked(id) });
const blocks = (issue: string, target: string) => ({ issue_id: issue, depends_on_id: target, type: 'blocks' });

const ID = {
  m3: 'dw-37352d0f782d1d17',
  t6: 'dw-eba63b7db1e9a14e.2',
  s3: 'dw-3511d68caffe01f8.3',
  s1: 'dw-3511d68caffe01f8.1',
  s4: 'dw-3511d68caffe01f8.4',
  s6: 'dw-3511d68caffe01f8.6',
  s7: 'dw-3511d68caffe01f8.7',
  s8: 'dw-3511d68caffe01f8.8',
  e5: 'dw-43cc',
  a1: 'dw-a4e4d4b8c7da1166',
  gw: 'dw-6a4i',
  s9: 'dw-3511d68caffe01f8.9',
  acc: 'dw-iy9a',
  qv3: 'dw-qv3',
  qv4: 'dw-qv4',
  ql1: 'dw-ssmbcp',
  qv6: 'dw-cs2w',
};
// Titles as on the live board: children say «#3»/«#5», the id suffix (.3) gives «#3.3».
const SEVEN = [ID.s1, ID.s4, ID.s6, ID.s7, ID.s8, ID.e5, ID.a1];

function m04(): GraphBead[] {
  return [
    bead('dw-m04', 'M04 · Понимание вакансии', { issue_type: 'epic' }),
    q(ID.qv3, 'M04 ВВ-3: траты около $7.3'),
    q(ID.qv4, 'M04 ВВ-4: миграция 0426'),
    q(ID.ql1, 'Окно L1 и ключ Clerk', 'M03'),
    q(ID.qv6, 'M04 ВВ-6: как платит клиент'),
    bead(ID.s9, 'M04 — Разделить страны', { needs: [ID.qv3] }),
    bead(ID.m3, 'M04 #3 — Пересчёт при правках', { status: 'in_progress', assignee: 'devwork/worker-1', needs: [ID.qv4] }),
    bead(ID.t6, 'M03 #6 — Допуск по своему ящику', { labels: ['milestone:M03'], needs: [ID.ql1] }),
    bead(ID.s3, 'M04 #3 — Не затирать оценку', { needs: [ID.m3], dependencies: [blocks(ID.s3, ID.t6)] }),
    bead(ID.s1, 'M04 #3 — Смена вакансии', { needs: [ID.s3] }),
    bead(ID.s4, 'M04 #3 — Оценка ждущей подачи', { needs: [ID.s3] }),
    bead(ID.s6, 'M04 #5 — Ручные записи оценки', { needs: [ID.s3] }),
    bead(ID.s7, 'M04 #5 — Удаление заглушек', { needs: [ID.s3] }),
    bead(ID.s8, 'M04 #5 — Чтение из снимка', { needs: [ID.s3] }),
    bead(ID.e5, 'M04 Task 5E — Мост досье для подбора', { needs: [ID.s3] }),
    // a redundant edge (a1 → m3 is implied through s3) must be pruned
    bead(ID.a1, 'M04 #1 — Перенести расчёт', { needs: [ID.s3, ID.m3] }),
    bead(ID.gw, 'M04 — Шлюз LLM для векторов', { needs: [ID.a1] }),
    bead(ID.acc, 'M04 — приёмка этапа', {
      needs: [...SEVEN, ID.gw, ID.s9, ID.s3],
      dependencies: [blocks(ID.acc, ID.qv6), { issue_id: ID.acc, depends_on_id: 'dw-m04', type: 'parent-child' }],
    }),
    bead('dw-done1', 'M04 #0 — Готово 1', { status: 'closed' }),
    bead('dw-done2', 'M04 #0.1 — Готово 2', { status: 'closed' }),
    bead('dw-done3', 'M04 #0.2 — Готово 3', { status: 'closed' }),
    bead('dw-done4', 'M04 #0.3 — Готово 4', { status: 'closed' }),
    bead('dw-done5', 'M04 #0.4 — Готово 5', { status: 'closed' }),
    bead('dw-other', 'M05 #1 — Чужая задача', { labels: ['milestone:M05'] }),
  ];
}

const node = (m: ReturnType<typeof buildGraph>, id: string) => {
  const n = m.nodes.find((x) => x.id === id);
  if (n === undefined) throw new Error(`no node ${id}`);
  return n;
};

describe('buildGraph on the M04 chain', () => {
  const m = buildGraph(m04(), { epicId: 'M04', nowMs: NOW });

  it('keeps the epic tasks, the outside blocker and the questions; drops closed, epic and other epics', () => {
    const ids = new Set(m.nodes.map((n) => n.id));
    expect(ids.has('dw-m04')).toBe(false);
    expect(ids.has('dw-done1')).toBe(false);
    expect(ids.has('dw-other')).toBe(false);
    expect(ids.has(ID.t6)).toBe(true);
    expect(node(m, ID.t6).outside).toBe(true);
    expect(node(m, ID.s3).outside).toBe(false);
    expect(m.nodes).toHaveLength(17);
  });

  it('puts questions in column 0 and tasks in waves by longest path', () => {
    for (const id of [ID.qv3, ID.qv4, ID.ql1, ID.qv6]) {
      expect(node(m, id).kind).toBe('question');
      expect(node(m, id).column).toBe(0);
    }
    expect(node(m, ID.m3).column).toBe(1);
    expect(node(m, ID.t6).column).toBe(1);
    expect(node(m, ID.s9).column).toBe(1);
    expect(node(m, ID.s3).column).toBe(2);
    for (const id of SEVEN) expect(node(m, id).column).toBe(3);
    expect(node(m, ID.gw).column).toBe(4);
    expect(node(m, ID.acc).column).toBe(5);
  });

  it('prunes transitively redundant edges', () => {
    const has = (a: string, b: string) => m.edges.some((e) => e.from === a && e.to === b);
    expect(has(ID.m3, ID.a1)).toBe(false);
    expect(has(ID.s3, ID.acc)).toBe(false);
    expect(has(ID.s3, ID.a1)).toBe(true);
    expect(has(ID.t6, ID.s3)).toBe(true);
    expect(has(ID.ql1, ID.t6)).toBe(true);
    expect(has(ID.qv6, ID.acc)).toBe(true);
    expect(has(ID.a1, ID.acc)).toBe(false); // implied by a1 → gw → acc
    expect(has(ID.s1, ID.acc)).toBe(true);
  });

  it('counts holds transitively', () => {
    expect(node(m, ID.ql1).holds).toBe(11); // t6, s3, seven, gw, acc
    expect(node(m, ID.s3).holds).toBe(9);
    expect(node(m, ID.qv6).holds).toBe(1);
    expect(node(m, ID.acc).holds).toBe(0);
  });

  it('labels with cardLabel and sets states and reasons in Russian', () => {
    expect(node(m, ID.s3).label).toBe('M04 #3.3');
    expect(node(m, ID.s3).title).toBe('Не затирать оценку');
    expect(node(m, ID.qv4).label).toBe('вопрос · ВВ-4');
    expect(node(m, ID.ql1).label).toBe('вопрос · Окно L1 и ключ Clerk');
    expect(node(m, ID.qv4).state).toBe('waits_owner');
    expect(node(m, ID.qv4).reason).toBe('держит 11');
    expect(node(m, ID.m3).state).toBe('in_work');
    expect(node(m, ID.m3).reason).toBe('ждёт тебя: ВВ-4');
    expect(node(m, ID.m3).assignee).toBe('devwork/worker-1');
    expect(node(m, ID.t6).state).toBe('waits_owner');
    expect(node(m, ID.s3).state).toBe('waits_task');
    expect(node(m, ID.s3).reason).toBe('ждёт: M04 #3, M03 #6.2');
    expect(node(m, ID.s1).reason).toBe('ждёт: M04 #3.3');
  });

  it('builds column headers with verdicts', () => {
    expect(m.columns.map((c) => c.title)).toEqual(['От тебя', 'Сейчас', 'Следом', 'Потом', 'Ещё позже', 'В конце']);
    expect(m.columns.map((c) => c.count)).toEqual([4, 3, 1, 7, 1, 1]);
    expect(m.columns[0]?.verdict).toBe('4 вопроса · больше всех держит ВВ-4');
    expect(m.columns[1]?.verdict).toBe('в работе 1 из 3 · 2 ждут твоих ответов');
    expect(m.columns[2]?.verdict).toBe('ждёт M04 #3 и M03 #6.2');
    expect(m.columns[3]?.verdict).toBe('7 пойдут параллельно после M04 #3.3');
    expect(m.columns[4]?.verdict).toBe('ждёт M04 #1');
    expect(m.columns[5]?.verdict).toBe('приёмка ждёт всё, что левее');
  });

  it('writes the headline and subline', () => {
    expect(m.headline).toBe('M04: 5 из 17 закрыто. Всё дальше стоит за M04 #3.3: она ждёт M04 #3 и M03 #6.2.');
    expect(m.subline).toBe(
      'Без причины не стоит ничего: что не в работе, ждёт других задач или твоих ответов — они слева, в колонке «От тебя».',
    );
  });

  it('orders rows inside a column 0..n-1', () => {
    for (const col of [0, 1, 3]) {
      const rows = m.nodes.filter((n) => n.column === col).map((n) => n.row).sort((a, b) => a - b);
      expect(rows).toEqual(rows.map((_, i) => i));
    }
  });
});

describe('chainOf and whatIfBanner', () => {
  const m = buildGraph(m04(), { epicId: 'M04', nowMs: NOW });

  it('walks ancestors, descendants and those that start right after', () => {
    const c = chainOf(m, ID.s3);
    expect([...c.up].sort()).toEqual([ID.m3, ID.t6, ID.qv4, ID.ql1].sort());
    expect(c.down.size).toBe(9);
    expect([...c.downNow].sort()).toEqual([...SEVEN].sort());
  });

  it('a question banner says what answering opens', () => {
    expect(whatIfBanner(m, ID.ql1)).toBe('Если ответишь: сразу пойдёт 1, всего откроется 11');
    expect(whatIfBanner(m, ID.qv6)).toBe('Если ответишь: сразу пойдут 0, всего откроется 1');
  });

  it('a question that holds nothing gets no banner (never «сразу пойдут 0, всего откроется 0»)', () => {
    const lone = {
      nodes: [
        { id: 'q', kind: 'question' as const, label: 'вопрос · X', title: 'X', state: 'waits_owner' as const, reason: '', holds: 0, column: 0, row: 0, outside: false, assignee: null },
      ],
      edges: [],
      columns: [],
      headline: '',
      subline: '',
    };
    expect(whatIfBanner(lone, 'q')).toBeNull();
  });

  it('a task banner says what it waits for and what it opens', () => {
    expect(whatIfBanner(m, ID.s3)).toBe('M04 #3.3 ждёт 2: M04 #3 в работе, M03 #6.2 ждёт тебя · откроет 7 сразу, 9 всего');
    expect(whatIfBanner(m, ID.acc)).toMatch(/^M04 приёмка ждёт 9: .* · откроет 0 сразу, 0 всего$/);
  });
});

describe('buildGraph edges of the live data', () => {
  it('keeps real tasks that carry engine gc.* keys; drops route steps and cross-store gates', () => {
    const beads = [
      bead('dw-t', 'M04 #1 — Задача', { metadata: { 'gc.exclusive_drain_reservation': 'x', 'gc.routed_to': 'w' } }),
      bead('gcg-step', 'prepare-worktree', { metadata: { 'gc.root_bead_id': 'gcg-root' } }),
      bead('gcg-xsg', 'cross-store gate', { issue_type: 'gate', metadata: { 'gc.cross_store_blocker': 'dw-t' } }),
      bead('dw-u', 'M04 #2 — Ждёт', { dependencies: [blocks('dw-u', 'gcg-xsg'), blocks('dw-u', 'gcg-step')] }),
    ];
    const m = buildGraph(beads, { epicId: 'M04', nowMs: NOW });
    expect(m.nodes.map((n) => n.id).sort()).toEqual(['dw-t', 'dw-u']);
  });

  it('a card’s own question is its answer gate in column 0, never the card (native gates, DIAG 20.11)', () => {
    const beads = [
      bead(ID.m3, 'M04 #3 — Сделать invalidation', {
        status: 'in_progress',
        labels: ['milestone:M04', 'needs/operator'],
        needs: ['dw-ag'],
        metadata: {
          'decision.question_id': 'b736',
          'decision.decide': 'ВВ-4: применять ли миграцию 0426',
          'owner.link': 'https://discord.com/channels/1/2/3',
        },
      }),
      bead('dw-ag', 'ответ на M04 #3', {
        issue_type: 'gate',
        labels: ['milestone:M04'],
        metadata: { 'gc.gate_type': 'human', 'devwork.gate_kind': 'answer', 'devwork.answer_for': ID.m3 },
      }),
      bead(ID.s3, 'M04 #33 — Не затирать', { needs: [ID.m3] }),
      // A title is no question: the old «ответ владельца» placeholder is a plain task.
      bead(ID.qv6, 'M04 — ответ владельца на ВВ-6 (способ оплаты)'),
    ];
    const m = buildGraph(beads, { epicId: 'M04', nowMs: NOW });
    const task = node(m, ID.m3);
    expect(task.kind).toBe('task');
    expect(task.state).toBe('in_work');
    expect(task.reason).toBe('ждёт тебя: ВВ-4');
    expect(node(m, 'dw-ag').kind).toBe('question');
    expect(node(m, 'dw-ag').label).toBe('вопрос · ВВ-4');
    expect(m.edges).toContainEqual({ from: 'dw-ag', to: ID.m3 });
    expect(node(m, 'dw-ag').holds).toBe(2);
    expect(m.nodes.some((n) => n.id === questionNodeId(ID.m3))).toBe(false);
    expect(beadIdOf(questionNodeId(ID.m3))).toBe(ID.m3);
    expect(node(m, ID.qv6).kind).toBe('task');
  });

  it('marks an untaken free task «никто не взял · N дн» and says so in the subline', () => {
    const beads = [bead('dw-a', 'M04 #9 — Старое', { created_at: new Date(NOW - 5 * DAY).toISOString() })];
    const m = buildGraph(beads, { epicId: 'M04', nowMs: NOW });
    expect(m.nodes[0]?.state).toBe('nobody_took');
    expect(m.nodes[0]?.reason).toBe('никто не взял · 5 дн');
    expect(m.columns[1]?.alarm).toBe(true);
    expect(m.subline).toBe('Без причины стоит 1: никто не взял.');
  });

  it('partial data never says «никто не взял» (ALL-README rule 11)', () => {
    const beads = [bead('dw-a', 'M04 #9 — Старое', { created_at: new Date(NOW - 5 * DAY).toISOString() })];
    const m = buildGraph(beads, { epicId: 'M04', nowMs: NOW, partial: true });
    expect(m.nodes[0]?.state).toBe('free');
    expect(JSON.stringify(m)).not.toContain('никто не взял');
    expect(m.columns[1]?.alarm).toBe(false);
    expect(m.subline).toBe('Данные догружаются: кто ничего не ждёт, может ждать то, что ещё не прочитано.');
  });

  it('counts each bead once when the board read repeats it across legs', () => {
    const m = buildGraph([...m04(), ...m04()], { epicId: 'M04', nowMs: NOW });
    expect(m.headline.startsWith('M04: 5 из 17 закрыто.')).toBe(true);
  });

  it('accepts an epic bead id as well as the milestone key', () => {
    const byKey = buildGraph(m04(), { epicId: 'M04', nowMs: NOW });
    const byBead = buildGraph(m04(), { epicId: 'dw-m04', nowMs: NOW });
    expect(byBead.nodes.map((n) => n.id).sort()).toEqual(byKey.nodes.map((n) => n.id).sort());
    expect(byBead.headline).toBe(byKey.headline);
  });

  it('focusIds restrict the graph to the chains of those beads', () => {
    const m = buildGraph(m04(), { epicId: null, focusIds: [ID.qv6], nowMs: NOW });
    expect(m.nodes.map((n) => n.id).sort()).toEqual([ID.acc, ID.qv6].sort());
  });

  it('survives a dependency cycle and unknown values', () => {
    const beads: unknown[] = [
      bead('dw-x', 'M04 #1 — X', { needs: ['dw-y'] }),
      bead('dw-y', 'M04 #2 — Y', { needs: ['dw-x', 'dw-missing'] }),
      null,
      { nope: true },
    ];
    const m = buildGraph(beads, { epicId: 'M04', nowMs: NOW });
    expect(m.nodes).toHaveLength(2);
  });
});

describe('labels keep the child sub-number (integration 16.11)', () => {
  it('live titles «M04 #3 — …» on child ids .3/.1 get «M04 #3.3»/«M04 #3.1», not one shared «M04 #3»', () => {
    const beads = m04().map((b) =>
      b.id === ID.s3
        ? { ...b, title: 'M04 #3 — ответ по старому профилю не перезаписывает оценку' }
        : b.id === ID.s1
          ? { ...b, title: 'M04 #3 — инвалидация при изменении вакансии' }
          : b,
    );
    const m = buildGraph(beads, { epicId: 'M04', nowMs: NOW });
    expect(node(m, ID.s3).label).toBe('M04 #3.3');
    expect(node(m, ID.s1).label).toBe('M04 #3.1');
    expect(node(m, ID.m3).label).toBe('M04 #3');
  });
});
