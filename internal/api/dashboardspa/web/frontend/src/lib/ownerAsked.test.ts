import { describe, expect, it } from 'vitest';
import type { SupervisorBead } from '../supervisor/beadReads';
import { buildBoardGraph } from '../vk/graph/boardModel';
import { beadIdOf } from '../vk/graph/model';
import { needsFromBoard } from './needsFromMe';
import { askedOwnerQuestions } from './ownerAsked';

// One rule for «Нужно от меня» and the graph's «От тебя» (owner 16.11):
// an open owner question that (a) holds at least one open task, directly
// or through others, and (b) was actually put to the owner (needs/operator,
// decision.question_id, a Discord link). Shapes are the live 16.11 cases.

const NOW_MS = Date.parse('2026-11-16T20:00:00Z');
const AT = '2026-11-16T10:00:00Z';
const LINK = 'https://discord.com/channels/1/2/3';

function bead(id: string, over: Partial<SupervisorBead> = {}): SupervisorBead {
  return { id, title: id, status: 'open', issue_type: 'task', created_at: AT, updated_at: AT, ...over } as SupervisorBead;
}
const asked = (qid: string) => ({
  'decision.question_id': qid,
  'decision.decide': `вопрос ${qid}?`,
  'decision.asked_at': AT,
  'owner.link': LINK,
});
const blocks = (id: string) => [{ issue_id: '', depends_on_id: id, type: 'blocks' }] as SupervisorBead['dependencies'];

const BEADS: SupervisorBead[] = [
  // dw-mjo5: asked gate holding a task.
  bead('dw-g1', { issue_type: 'gate', title: 'да на пересборку M03', labels: ['needs/operator'], metadata: { ...asked('q1'), 'gc.gate_type': 'human', 'devwork.owner_gate': 'true' } }),
  bead('dw-t1', { labels: ['milestone:M03'], dependencies: blocks('dw-g1') }),
  // dw-pqio: plan gate from the feeder cutover, never asked.
  bead('dw-g2', { issue_type: 'gate', title: 'да на план M05', metadata: { 'gc.gate_type': 'human', 'devwork.owner_gate': 'true', 'devwork.gate_kind': 'plan', 'devwork.stage': 'M05' } }),
  bead('dw-t2', { labels: ['milestone:M05'], dependencies: blocks('dw-g2'), assignee: '' }),
  // dw-dp30: the Mayor's plan task carrying an asked decision, nothing waits on it.
  bead('dw-p1', { title: 'Мэр: перенарезать остаток M03 (план)', labels: ['milestone:M03', 'needs/operator'], metadata: asked('q3') }),
  // dw-eba63…: the M03 epic carrying a stale copy of the re-slice question.
  bead('dw-e1', { issue_type: 'epic', title: 'M03. Эпик', labels: ['milestone:M03', 'needs/operator'], metadata: asked('q4') }),
  bead('dw-t3', { labels: ['milestone:M13'], dependencies: blocks('dw-e1') }),
  // dw-cs2w: «ответ владельца» placeholder task, not marked, waits on an asked gate.
  bead('dw-a1', { title: 'M04 — ответ владельца на ВВ-6', labels: ['milestone:M04'], dependencies: blocks('dw-g1') }),
  // dw-37352…: a task in work that asked its own question; it holds itself.
  bead('dw-w1', { status: 'in_progress', assignee: 'worker', labels: ['milestone:M04', 'needs/operator'], metadata: asked('q6') }),
  // An asked gate whose only dependent is closed.
  bead('dw-g3', { issue_type: 'gate', labels: ['needs/operator'], metadata: { ...asked('q7'), 'gc.gate_type': 'human' } }),
  bead('dw-t4', { status: 'closed', dependencies: blocks('dw-g3') }),
];

describe('askedOwnerQuestions', () => {
  it('keeps only asked questions that hold an open task', () => {
    expect([...askedOwnerQuestions(BEADS).keys()].sort()).toEqual(['dw-g1', 'dw-w1']);
  });

  it('counts held tasks transitively, an in-work carrier holding itself', () => {
    const q = askedOwnerQuestions(BEADS);
    expect(q.get('dw-g1')?.holds).toBe(2);
    expect(q.get('dw-w1')?.holds).toBe(1);
  });
});

describe('«Нужно от меня» and the graph «От тебя» agree', () => {
  const needs = needsFromBoard({ items: BEADS, routeItems: [], serviceItems: [], routesComplete: true }, [], [], NOW_MS, false, []);
  const graph = buildBoardGraph(BEADS, { nowMs: NOW_MS });
  const graphQuestions = graph.nodes.filter((n) => n.kind === 'question').map((n) => beadIdOf(n.id));

  it('shows the same set in both places', () => {
    const needIds = needs.needs.filter((n) => n.kind === 'question').map((n) => n.id);
    expect(needIds.sort()).toEqual(['dw-g1', 'dw-w1']);
    expect(graphQuestions.sort()).toEqual(['dw-g1', 'dw-w1']);
    expect(needs.count).toBe(graphQuestions.length);
  });

  it('a question that holds nothing never comes back as an owner stall', () => {
    expect(needs.stalls.map((s) => s.id)).not.toContain('dw-p1');
  });

  it('a task behind a gate not yet asked says so instead of «никто не взял»', () => {
    const t2 = graph.nodes.find((n) => n.id === 'dw-t2');
    expect(t2?.state).toBe('waits_task');
    expect(t2?.reason).toContain('вопрос ещё не задан');
  });

  it('the «ответ владельца» placeholder is a task waiting on the question', () => {
    const a1 = graph.nodes.find((n) => n.id === 'dw-a1');
    expect(a1?.kind).toBe('task');
    expect(a1?.state).toBe('waits_owner');
  });
});
