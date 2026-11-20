import { describe, expect, it } from 'vitest';
import { needsFromBoard } from '../../lib/needsFromMe';
import type { BoardData } from '../../lib/boardModel';
import type { SupervisorBead } from '../../supervisor/beadReads';
import { buildBoardGraph } from './boardModel';

// DIAG-board-vs-needs-you (20.11, step 2): the graph's «От тебя» and «Нужно от
// меня» read ONE owner-debt rule, so their counts can never disagree. The
// fixture mirrors the live board read at ~13:30 20.11 (dashboard-equivalent
// GET /v0/city/devwork-platform/beads + `gc bd show` per card):
//   - 8 rig plan gates «да на план M06…M13» (gc.gate_type=human, no question
//     posted), 32 wave-1 tasks behind them (M13 6, M12 6, M07 5, M06 5, M11 4,
//     M08 3, M10 2, M09 1);
//   - 2 city waits «ждёт «да» на план m06 / blind-columns-drop» (gc.gate_type=plan-yes),
//     with their open planning tickets «План m06» (in work) and «План blind-columns-drop»;
//   - 3 agent session waits wait:* (gc:wait, session:*);
//   - ВВ-6 (dw-v60o) answered: the verified answer closed its gate (city PR #95),
//     and its placeholder dw-cs2w «M04 — ответ владельца на ВВ-6 …»;
//   - 4 tasks in work.
//   - dw-eog7 «PR #630: что с ним делать?»: an asked human gate whose type is
//     only bd's await_type (VERIFY-human-gate-model.md §5).
// Expected: exactly 1 owner debt (dw-eog7) everywhere; the 10 plan gates are ordinary steps with
// their plan's status; the agent waits are nowhere.

const NOW = Date.parse('2026-11-20T13:30:00Z');
const AT = '2026-11-16T10:00:00Z';

function bead(id: string, title: string, extra: Partial<SupervisorBead> = {}): SupervisorBead {
  return { id, title, status: 'open', issue_type: 'task', created_at: AT, updated_at: '2026-11-20T12:00:00Z', ...extra };
}
const blocks = (issue: string, target: string) => ({ issue_id: issue, depends_on_id: target, type: 'blocks' });

const STAGES: ReadonlyArray<[string, string, number]> = [
  ['M06', 'dw-bl2e', 5],
  ['M07', 'dw-83oh', 5],
  ['M08', 'dw-smmz', 3],
  ['M09', 'dw-06if', 1],
  ['M10', 'dw-ebw2', 2],
  ['M11', 'dw-lo0x', 4],
  ['M12', 'dw-fu6j', 6],
  ['M13', 'dw-c4mc', 6],
];

function liveBoard(): BoardData {
  const items: SupervisorBead[] = [];
  const serviceItems: SupervisorBead[] = [];
  for (const [stage, gate, waiting] of STAGES) {
    serviceItems.push(
      bead(gate, `да на план ${stage}`, {
        issue_type: 'gate',
        metadata: { 'devwork.gate_kind': 'plan', 'devwork.owner_gate': 'true', 'devwork.stage': stage, 'gc.gate_type': 'human' },
      }),
    );
    for (let i = 1; i <= waiting; i += 1) {
      const id = `dw-${stage.toLowerCase()}-${i}`;
      items.push(
        bead(id, `${stage} #${i} — задача`, {
          labels: [`milestone:${stage}`],
          assignee: 'devwork/implementer-1',
          dependencies: [blocks(id, gate)],
        }),
      );
    }
  }
  serviceItems.push(
    bead('dp-vd3', 'ждёт «да» на план m06', {
      issue_type: 'gate',
      metadata: { 'devwork.gate_kind': 'plan-yes', 'devwork.plan_gate': 'dw-bl2e', 'devwork.plan_slug': 'm06', 'gc.gate_type': 'plan-yes' },
    }),
    bead('dp-9u0', 'ждёт «да» на план blind-columns-drop', {
      issue_type: 'gate',
      metadata: { 'devwork.gate_kind': 'plan-yes', 'devwork.plan_slug': 'blind-columns-drop', 'gc.gate_type': 'plan-yes' },
    }),
  );
  items.push(
    bead('dp-62p', 'План m06', {
      status: 'in_progress',
      assignee: 'gcg-session-cb47',
      metadata: { 'devwork.kind': 'plan', 'devwork.plan_gate': 'dw-bl2e', 'devwork.plan_slug': 'm06', 'devwork.stage': 'M06', 'devwork.yes_wait': 'dp-vd3' },
    }),
    bead('dp-2bk', 'План blind-columns-drop', {
      assignee: 'plan-writer',
      metadata: { 'devwork.kind': 'plan', 'devwork.plan_slug': 'blind-columns-drop', 'devwork.yes_wait': 'dp-9u0' },
    }),
  );
  // Agents waiting on agents (engine durable session waits).
  for (const [id, title, on] of [
    ['gcg-1396737', 'wait:plan-writer-2', 'dw-8q6e'],
    ['gcg-1397761', 'wait:plan-writer-1', 'dw-jjpd'],
    ['gcg-1474561', 'wait:devwork/implementer-high-1', 'dw-3guc'],
  ] as const) {
    serviceItems.push(
      bead(id, title, {
        issue_type: 'gate',
        labels: ['gc:wait', `session:gcg-session-${id}`],
        metadata: { kind: 'deps', dep_ids: on, state: 'ready' },
      }),
    );
  }
  // dw-eog7: today's one real owner question, a gate `owner ask --gate action`
  // made with `bd gate create --type=human`: its type is ONLY bd's await_type
  // (no gc.gate_type), the question is posted (id + Discord link).
  serviceItems.push(
    bead('dw-eog7', 'PR #630: что с ним делать?', {
      issue_type: 'gate',
      await_type: 'human',
      labels: ['needs/operator'],
      metadata: {
        'decision.question_id': '9d34a3fef16e1f3e3fc776dd',
        'decision.approve_qid': '9d34a3fef16e1f3e3fc776dd',
        'decision.chat_url': 'https://discord.com/channels/1/2/1573318023195009175',
        'decision.decide': 'PR #630: что с ним делать?',
        'decision.gate': 'action',
        'devwork.gate_kind': 'action',
        'devwork.owner_gate': 'true',
      },
    }),
  );
  // ВВ-6: answered, so its gate is closed (it is not in the open read); the
  // placeholder task waits on nothing open any more.
  items.push(
    bead('dw-cs2w', 'M04 — ответ владельца на ВВ-6 (способ оплаты клиентом) в m04-client-payment-channel.md', {
      labels: ['milestone:M04'],
      assignee: 'devwork/implementer-2',
      dependencies: [blocks('dw-cs2w', 'dw-v60o')],
    }),
  );
  for (let i = 1; i <= 4; i += 1) {
    items.push(bead(`dw-run-${i}`, `M03 #${i} — в работе`, { status: 'in_progress', assignee: `devwork/w-${i}`, labels: ['milestone:M03'] }));
  }
  return { items, routeItems: [], serviceItems, routesComplete: true };
}

function graphOf(data: BoardData) {
  return buildBoardGraph([...data.items, ...data.serviceItems], { nowMs: NOW });
}

function fromYou(data: BoardData): number {
  return graphOf(data).nodes.filter((n) => n.column === 0 && n.kind === 'question').length;
}

function needsQuestions(data: BoardData): number {
  return needsFromBoard(data, [], [], NOW, false, []).needs.filter((n) => n.kind === 'question').length;
}

describe('one owner-debt rule on the live board of 20.11', () => {
  it('«От тебя» count equals «Нужно от меня» count: today both are 1 (dw-eog7)', () => {
    const data = liveBoard();
    expect(fromYou(data)).toBe(needsQuestions(data));
    expect(fromYou(data)).toBe(1);
    const needs = needsFromBoard(data, [], [], NOW, false, []);
    expect(needs.count).toBe(1);
    expect(needs.needs.map((n) => n.id)).toEqual(['dw-eog7']);
    expect(graphOf(data).nodes.filter((n) => n.kind === 'question').map((n) => n.id)).toEqual(['dw-eog7']);
  });

  it('dw-eog7 counts only through await_type: without it the gate is no human gate', () => {
    const data = liveBoard();
    data.serviceItems = data.serviceItems.map((b) => {
      if (b.id !== 'dw-eog7') return b;
      const { await_type: _dropped, ...rest } = b;
      return rest;
    });
    expect(fromYou(data)).toBe(0);
    expect(needsQuestions(data)).toBe(0);
  });

  it('the 10 plan gates are ordinary steps with their plan’s status, never questions', () => {
    const graph = graphOf(liveBoard());
    const steps = graph.nodes.filter((n) => /^план /u.test(n.label));
    expect(steps).toHaveLength(10);
    expect(steps.every((n) => n.kind === 'task' && n.column > 0)).toBe(true);
    const reason = (id: string) => graph.nodes.find((n) => n.id === id)?.reason;
    expect(reason('dw-bl2e')).toBe('план M06 пишется');
    expect(reason('dp-vd3')).toBe('план M06 пишется');
    expect(reason('dp-9u0')).toBe('план blind-columns-drop пишется');
    expect(reason('dw-c4mc')).toBe('план M13 пишется');
    // they live in their stage lanes, not in «От тебя»
    expect(graph.laneOf['dw-bl2e']).toBe('M06');
    expect(graph.laneOf['dp-vd3']).toBe('M06');
    expect(graph.laneOf['dw-c4mc']).toBe('M13');
  });

  it('no owner counter counts the plan gates or the agent waits', () => {
    const graph = graphOf(liveBoard());
    const ids = graph.nodes.map((n) => n.id);
    for (const id of ['gcg-1396737', 'gcg-1397761', 'gcg-1474561']) expect(ids).not.toContain(id);
    expect(graph.nodes.some((n) => n.kind === 'task' && n.state === 'waits_owner')).toBe(false);
    expect(graph.columns[0]?.verdict).toMatch(/^1 вопрос · больше всех держит /u);
    expect(graph.columns.map((c) => c.verdict).join(' ')).not.toMatch(/твоих ответов|твоего ответа/u);
    expect(graph.headline).not.toMatch(/больше всех держит да на план/u);
    // the 32 wave-1 tasks wait on their plan step, as city work
    const waiting = graph.nodes.filter((n) => /^ждёт: план M/u.test(n.reason));
    expect(waiting).toHaveLength(32);
    // «держит меня» shows only the real question, none of the plan steps
    const holdsMe = buildBoardGraph([...liveBoard().items, ...liveBoard().serviceItems], { nowMs: NOW, filter: 'holds_me' });
    expect(holdsMe.nodes.map((n) => n.id)).toEqual(['dw-eog7']);
  });

  it('the placeholder for an answered question is plain work, not a question', () => {
    const graph = graphOf(liveBoard());
    const placeholder = graph.nodes.find((n) => n.id === 'dw-cs2w');
    expect(placeholder?.kind).toBe('task');
    expect(graph.laneOf['dw-cs2w']).toBe('M04');
  });

  it('once the city posts the M06 question, both counts move together to 2', () => {
    const data = liveBoard();
    data.serviceItems = data.serviceItems.map((b) =>
      b.id === 'dw-bl2e'
        ? {
            ...b,
            metadata: {
              ...b.metadata,
              'devwork.plan_slug': 'm06',
              'devwork.plan_qid': 'q-m06',
              'decision.question_id': 'q-m06',
              'decision.chat_url': 'https://discord.com/channels/1/2/6',
            },
          }
        : b,
    );
    expect(fromYou(data)).toBe(2);
    expect(needsQuestions(data)).toBe(2);
    const graph = graphOf(data);
    expect(graph.columns[1]?.verdict).toMatch(/5 ждут твоих ответов/u);
    // an agent wait carrying the same keys still never counts
    data.serviceItems = data.serviceItems.map((b) =>
      b.id === 'gcg-1396737' ? { ...b, metadata: { ...b.metadata, 'gc.gate_type': 'human', 'decision.question_id': 'q-x', 'owner.link': 'https://discord.com/channels/1/2/9' } } : b,
    );
    expect(fromYou(data)).toBe(2);
    expect(needsQuestions(data)).toBe(2);
  });
});
