import { describe, expect, it } from 'vitest';
import { buildBoardGraph } from './boardModel';
import { questionNodeId, type GraphBead } from './model';

// Real-shaped fixtures (live board 16.11): milestone labels, parent epics,
// `needs` + blocking `dependencies[]`, the L1 decision gate holding several
// lanes, the M05–M13 drafts held by the old hold:plan intake reason.
const NOW = Date.parse('2026-11-16T12:00:00Z');
const DAY = 86_400_000;
const HOLD_PLAN =
  'prerequisite: держит метка hold:plan: её снимает Мэр, когда исполнимый пакет этапа подготовлен и принят; причина: нет пакета';

function bead(id: string, title: string, extra: Partial<GraphBead> = {}): GraphBead {
  return { id, title, status: 'open', issue_type: 'task', created_at: new Date(NOW - DAY / 2).toISOString(), ...extra };
}
const ms = (m: string) => [`milestone:${m}`];
const blocks = (issue: string, target: string) => ({ issue_id: issue, depends_on_id: target, type: 'blocks' });
const epic = (id: string, m: string | null, title: string, approved = true) =>
  bead(id, title, {
    issue_type: 'epic',
    ...(m === null ? {} : { labels: ms(m) }),
    ...(approved ? { metadata: { 'devwork.plan_status': 'admitted' } } : {}),
  });
const draft = (id: string, title: string, m: string, extra: Partial<GraphBead> = {}) =>
  bead(id, title, { labels: ms(m), metadata: { 'devwork.intake_reason': HOLD_PLAN }, ...extra });

function board(): GraphBead[] {
  return [
    epic('e03', 'M03', 'M03. Личный клиент'),
    epic('e04', 'M04', 'M04 / 0b. Понимание вакансии'),
    epic('e06', 'M06', 'M06. Досье', false),
    epic('e07', 'M07', 'M07. Общая схема формы', false),
    epic('e08', 'M08', 'M08. Вся подача', false),
    epic('e11', 'M11', 'M11. Остаток', false),
    epic('e13', 'M13', 'M13. Финальная приёмка', false),
    epic('one', null, 'Один тип пользователя вместо наставника и ученика'),
    // L1: a decision gate (no route metadata) holding M03, M04 and «Один тип».
    bead('l1', 'Окно L1 и ключ Clerk', {
      issue_type: 'gate',
      labels: ['needs/operator'],
      metadata: { 'decision.question_id': 'q-l1', 'owner.link': 'https://discord.com/channels/1/2/3' },
    }),
    bead('t6', 'M03 #6 — Допуск по своему ящику', { labels: ms('M03'), parent: 'e03', needs: ['l1'] }),
    bead('t7', 'M03 #7 — Портал', { labels: ms('M03'), parent: 'e03', status: 'in_progress', assignee: 'devwork/worker-1' }),
    bead('s3', 'M04 #3 — Не затирать оценку', { labels: ms('M04'), parent: 'e04', dependencies: [blocks('s3', 't6')] }),
    bead('s4', 'M04 #4 — Оценка ждущей подачи', { labels: ms('M04'), parent: 'e04', needs: ['s3', 'l1'] }),
    bead('o1', 'Один тип #1', { parent: 'one', needs: ['l1'] }),
    bead('o2', 'Один тип #2', { parent: 'one', needs: ['o1'] }),
    draft('m11a', 'M11 #1 — Кабинет', 'M11', { parent: 'e11', dependencies: [blocks('m11a', 't7')] }),
    draft('m6a', 'M06.2 — Порт данных', 'M06', { parent: 'e06' }),
    draft('m7a', 'M07 #1 — Схема', 'M07', { parent: 'e07', needs: ['m6a'] }),
    draft('m8a', 'M08a — Подача', 'M08', { parent: 'e08', needs: ['m6a'] }),
    // M13 waits on whole epics, not on tickets.
    draft('m13', 'M13 #1 — Приёмка', 'M13', { parent: 'e13', dependencies: [blocks('m13', 'e06'), blocks('m13', 'e07')] }),
    bead('loose', 'Почистить логи', {}),
    // Engine plumbing: never a node.
    bead('route', 'route step', { metadata: { 'gc.kind': 'workflow' } }),
  ];
}

const g = () => buildBoardGraph(board(), { nowMs: NOW });

describe('buildBoardGraph', () => {
  it('puts every open work ticket and question on the board, no plumbing', () => {
    const ids = g().nodes.map((n) => n.id).sort();
    expect(ids).toEqual(['l1', 'loose', 'm11a', 'm13', 'm6a', 'm7a', 'm8a', 'o1', 'o2', 's3', 's4', 't6', 't7'].sort());
  });

  it('leaves out service beads the board keeps aside (runtime ops, mail, sessions, alarms)', () => {
    const beads = [
      ...board(),
      bead('gcg-5', 'runtime gcg-5', { issue_type: 'op', labels: ['gc:rt'] }),
      bead('gcg-m', 'Проверка Мака', { issue_type: 'message' }),
      bead('gcg-s', 'session', { issue_type: 'session', labels: ['gc:session'] }),
      bead('al', 'стоит: M04 #3', { labels: ms('M04'), parent: 'e04' }),
      bead('s7', 'M04 #7', { labels: ms('M04'), parent: 'e04', needs: ['gcg-5'] }),
    ];
    const graph = buildBoardGraph(beads, { nowMs: NOW });
    const ids = graph.nodes.map((n) => n.id);
    for (const id of ['gcg-5', 'gcg-m', 'gcg-s', 'al']) expect(ids).not.toContain(id);
    expect(ids).toContain('s7');
    expect(graph.lanes.find((l) => l.key === 'M04')?.total).toBe(3);
  });

  it('orders lanes by the plan: M00→M14, then epics without a milestone, «Без эпика» last', () => {
    expect(g().lanes.map((l) => l.key)).toEqual(['M03', 'M04', 'M06', 'M07', 'M08', 'M11', 'M13', 'one', 'none']);
    const one = g().lanes.find((l) => l.key === 'one');
    expect(one?.title).toBe('Один тип пользователя вместо наставника и ученика');
    expect(g().lanes.at(-1)?.title).toBe('Без эпика');
  });

  it('puts questions in the shared «От тебя» column', () => {
    const graph = g();
    expect(graph.laneOf.l1).toBe('ask');
    expect(graph.nodes.find((n) => n.id === 'l1')?.column).toBe(0);
    expect(graph.columns[0]?.title).toBe('От тебя');
    // L1 holds tickets in three lanes; s4 reaches it through s3 too, so its
    // direct L1 edge is pruned.
    const fromL1 = graph.edges.filter((e) => e.from === 'l1').map((e) => e.to).sort();
    expect(fromL1).toEqual(['o1', 't6']);
  });

  it('uses global waves so a ticket waiting on another epic sits to its right', () => {
    const col = (id: string) => g().nodes.find((n) => n.id === id)?.column;
    expect(col('t6')).toBe(1);
    expect(col('s3')).toBe(2);
    expect(col('s4')).toBe(3);
    expect(g().edges).toContainEqual({ from: 't6', to: 's3' });
  });

  it('assigns a lane by milestone, else parent epic, else «Без эпика»', () => {
    const { laneOf } = g();
    expect(laneOf.s3).toBe('M04');
    expect(laneOf.o2).toBe('one');
    expect(laneOf.loose).toBe('none');
    expect(g().lanes.find((l) => l.key === 'M04')?.nodeIds.sort()).toEqual(['s3', 's4']);
  });

  it('keeps «Один тип» children in its lane even when they carry a milestone (live dw-mqfcx.2 is M03)', () => {
    const beads = [...board(), bead('o3', 'Убрать роль junior', { labels: ms('M03'), parent: 'one' })];
    expect(buildBoardGraph(beads, { nowMs: NOW }).laneOf.o3).toBe('one');
  });

  it('does not count owner-answer placeholders in the epic progress', () => {
    const beads = [...board(), bead('qa', 'M04 — ответ владельца на ВВ-6', { labels: ms('M04'), parent: 'e04' })];
    const graph = buildBoardGraph(beads, { nowMs: NOW });
    // a placeholder is a task, never a question (owner 16.11: asked questions only)
    expect(graph.laneOf.qa).toBe('M04');
    expect(graph.lanes.find((l) => l.key === 'M04')?.total).toBe(2);
  });

  it('keeps cross-epic links (M03→M11, M06→M07/M08)', () => {
    const e = g().edges;
    expect(e).toContainEqual({ from: 't7', to: 'm11a' });
    expect(e).toContainEqual({ from: 'm6a', to: 'm7a' });
    expect(e).toContainEqual({ from: 'm6a', to: 'm8a' });
  });

  it('marks a lane that waits on whole epics instead of drawing lines', () => {
    const graph = g();
    expect(graph.lanes.find((l) => l.key === 'M13')?.waitsOnEpics).toEqual(['M06', 'M07']);
    expect(graph.edges.some((e) => e.to === 'm13')).toBe(false);
  });

  it('collapses lanes without an approved plan by default, expands approved ones', () => {
    const lanes = Object.fromEntries(g().lanes.map((l) => [l.key, l]));
    expect(lanes.M06?.approved).toBe(false);
    expect(lanes.M06?.collapsed).toBe(true);
    expect(lanes.M04?.approved).toBe(true);
    expect(lanes.M04?.collapsed).toBe(false);
    // An epic with no plan status but no hold:plan ticket (live M04) is approved.
    const noStatus = board().map((b) => (b.id === 'e04' ? { ...b, metadata: {} } : b));
    expect(buildBoardGraph(noStatus, { nowMs: NOW }).lanes.find((l) => l.key === 'M04')?.approved).toBe(true);
  });

  it('honours the owner’s collapse toggles', () => {
    const graph = buildBoardGraph(board(), { nowMs: NOW, collapsed: { M06: false, M04: true } });
    const lanes = Object.fromEntries(graph.lanes.map((l) => [l.key, l]));
    expect(lanes.M06?.collapsed).toBe(false);
    expect(lanes.M04?.collapsed).toBe(true);
  });

  it('collapses every lane above 300 nodes', () => {
    const many = [...board()];
    for (let i = 0; i < 300; i++) many.push(bead(`x${i}`, `x ${i}`, { labels: ms('M04'), parent: 'e04' }));
    const graph = buildBoardGraph(many, { nowMs: NOW });
    expect(graph.lanes.every((l) => l.collapsed)).toBe(true);
  });

  it('counts epic progress in the lane header', () => {
    const withClosed = [...board(), bead('s0', 'M04 #0', { labels: ms('M04'), parent: 'e04', status: 'closed' })];
    const lane = buildBoardGraph(withClosed, { nowMs: NOW }).lanes.find((l) => l.key === 'M04');
    expect(lane).toMatchObject({ done: 1, total: 3 });
    expect(lane?.nodeIds).not.toContain('s0');
  });

  it('turns a link to a ticket not on the board into a dashed outside stub', () => {
    const beads = [...board(), bead('s5', 'M04 #5', { labels: ms('M04'), parent: 'e04', needs: ['rich-42'] })];
    const graph = buildBoardGraph(beads, { nowMs: NOW });
    const stub = graph.nodes.find((n) => n.id === 'rich-42');
    expect(stub?.outside).toBe(true);
    expect(stub?.reason).toMatch(/снаружи/u);
    expect(graph.laneOf['rich-42']).toBe('M04');
    expect(graph.edges).toContainEqual({ from: 'rich-42', to: 's5' });
  });

  it('drops a link to an absent ticket of this board’s own store (the open read omits closed ones)', () => {
    const beads = [
      ...board(),
      bead('dw-1', 'M04 #10', { labels: ms('M04'), parent: 'e04', needs: ['dw-gone'] }),
    ];
    const graph = buildBoardGraph(beads, { nowMs: NOW });
    expect(graph.nodes.some((n) => n.id === 'dw-gone')).toBe(false);
    expect(graph.nodes.find((n) => n.id === 'dw-1')?.column).toBe(1);
    // Partial data: absence proves nothing, so it stays an outside stub.
    const partial = buildBoardGraph(beads, { nowMs: NOW, partial: true });
    expect(partial.nodes.find((n) => n.id === 'dw-gone')?.outside).toBe(true);
  });

  it('draws the real blocker behind a cross-store gate', () => {
    const gate = bead('gcg-xsg-1', 'xsg', { issue_type: 'gate', metadata: { 'gc.cross_store_blocker': 't6', 'gc.await_type': 'bead' } });
    const beads = [...board(), gate, bead('s6', 'M04 #6', { labels: ms('M04'), parent: 'e04', needs: ['gcg-xsg-1'] })];
    const graph = buildBoardGraph(beads, { nowMs: NOW });
    expect(graph.nodes.some((n) => n.id === 'gcg-xsg-1')).toBe(false);
    expect(graph.edges).toContainEqual({ from: 't6', to: 's6' });
  });

  it('reports a cycle in a red banner and still lays out', () => {
    const beads = [
      ...board(),
      bead('ca', 'M04 #8 — А', { labels: ms('M04'), parent: 'e04', needs: ['cb'] }),
      bead('cb', 'M04 #9 — Б', { labels: ms('M04'), parent: 'e04', needs: ['ca'] }),
    ];
    const graph = buildBoardGraph(beads, { nowMs: NOW });
    expect(graph.warnings.some((w) => /^цикл: .+ ⇄ .+ — поправь связь$/u.test(w))).toBe(true);
    expect(graph.nodes.filter((n) => n.id === 'ca' || n.id === 'cb')).toHaveLength(2);
  });

  it('on partial data warns and never says «никто не взял»', () => {
    const old = { created_at: new Date(NOW - 5 * DAY).toISOString() };
    const beads = board().map((b) => (b.id === 'loose' ? { ...b, ...old } : b));
    expect(buildBoardGraph(beads, { nowMs: NOW }).nodes.find((n) => n.id === 'loose')?.state).toBe('nobody_took');
    const partial = buildBoardGraph(beads, { nowMs: NOW, partial: true });
    expect(partial.warnings.some((w) => /прочитано не полностью/iu.test(w))).toBe(true);
    expect(partial.nodes.some((n) => n.state === 'nobody_took' || /никто не взял/u.test(n.reason))).toBe(false);
  });

  it('gives each node a row inside its lane, unique per lane and column', () => {
    const graph = g();
    const seen = new Set<string>();
    for (const n of graph.nodes) {
      const key = `${graph.laneOf[n.id]}|${n.column}|${n.row}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('builds column headers over the compressed waves', () => {
    const graph = g();
    const maxCol = Math.max(...graph.nodes.map((n) => n.column));
    expect(graph.columns).toHaveLength(maxCol + 1);
    expect(graph.columns.map((c) => c.title).slice(0, 3)).toEqual(['От тебя', 'Сейчас', 'Следом']);
    expect(graph.headline.length).toBeGreaterThan(0);
  });

  it('filter «только то, что держит меня» keeps the questions and what they hold', () => {
    const ids = buildBoardGraph(board(), { nowMs: NOW, filter: 'holds_me' }).nodes.map((n) => n.id).sort();
    expect(ids).toEqual(['l1', 'o1', 'o2', 's3', 's4', 't6'].sort());
  });

  it('filter «только в работе» keeps in-work tickets and compresses the waves', () => {
    const graph = buildBoardGraph(board(), { nowMs: NOW, filter: 'in_work' });
    expect(graph.nodes.map((n) => n.id)).toEqual(['t7']);
    expect(graph.nodes[0]?.column).toBe(1);
    expect(graph.lanes.map((l) => l.key)).toEqual(['M03']);
  });

  it('filter «только стоящее» keeps tickets standing without a reason', () => {
    const old = { created_at: new Date(NOW - 5 * DAY).toISOString() };
    const beads = board().map((b) => (b.id === 'loose' ? { ...b, ...old } : b));
    const ids = buildBoardGraph(beads, { nowMs: NOW, filter: 'stuck' }).nodes.map((n) => n.id);
    expect(ids).toContain('loose');
    expect(ids).not.toContain('t7');
    expect(ids).not.toContain('s4');
  });

  it('gives an in-work task with its own decision a question card in «От тебя»', () => {
    const beads = board().map((b) =>
      b.id === 't7' ? {
            ...b,
            labels: [...ms('M03'), 'needs/operator'],
            metadata: { 'decision.decide': 'какой портал', 'decision.question_id': 'q-t7', 'owner.link': 'https://discord.com/channels/1/2/3' },
          } : b,
    );
    const graph = buildBoardGraph(beads, { nowMs: NOW });
    expect(graph.laneOf[questionNodeId('t7')]).toBe('ask');
    expect(graph.laneOf.t7).toBe('M03');
  });
});
