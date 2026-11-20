import { describe, expect, it } from 'vitest';
import type { SupervisorBead } from '../../supervisor/beadReads';
import { ownerDebtIndex } from '../../lib/ownerQuestions';
import { cityStepOf } from './planStep';

// A plan «да» gate nobody has asked about yet is the city's work: an ordinary
// step whose status comes from the plan's own tickets (commands/plan/help.md:6-13,
// :46-48 in the city repo; live shapes dw-bl2e, dp-vd3, dp-62p, dw-jjpd 20.11).

function bead(id: string, title: string, extra: Partial<SupervisorBead> = {}): SupervisorBead {
  return { id, title, status: 'open', issue_type: 'task', created_at: '2026-11-16T10:00:00Z', ...extra };
}
const stageGate = (id: string, stage: string) =>
  bead(id, `да на план ${stage}`, {
    issue_type: 'gate',
    metadata: { 'devwork.gate_kind': 'plan', 'devwork.owner_gate': 'true', 'devwork.stage': stage, 'gc.gate_type': 'human' },
  });
const yesWait = (id: string, slug: string, planGate?: string) =>
  bead(id, `ждёт «да» на план ${slug}`, {
    issue_type: 'gate',
    metadata: {
      'devwork.gate_kind': 'plan-yes',
      'devwork.plan_slug': slug,
      'gc.gate_type': 'plan-yes',
      ...(planGate === undefined ? {} : { 'devwork.plan_gate': planGate }),
    },
  });
const planTicket = (id: string, slug: string, extra: Record<string, string> = {}, status = 'in_progress') =>
  bead(id, `План ${slug}`, { status, metadata: { 'devwork.kind': 'plan', 'devwork.plan_slug': slug, ...extra } });

const step = (gate: SupervisorBead, others: SupervisorBead[]) => {
  const all = [gate, ...others];
  return cityStepOf(gate, ownerDebtIndex(all), all);
};

describe('cityStepOf', () => {
  it('a stage gate with its plan ticket open: «план M06 пишется»', () => {
    const gate = stageGate('dw-bl2e', 'M06');
    const s = step(gate, [planTicket('dp-62p', 'm06', { 'devwork.plan_gate': 'dw-bl2e', 'devwork.yes_wait': 'dp-vd3' })]);
    expect(s).toEqual({ label: 'план M06', reason: 'план M06 пишется' });
  });

  it('a stage gate with no plan ticket yet: «пишется» too (no plan yet)', () => {
    expect(step(stageGate('dw-83oh', 'M07'), [])?.reason).toBe('план M07 пишется');
  });

  it('an open review of the plan: «на проверке»', () => {
    const gate = stageGate('dw-bl2e', 'M06');
    const review = bead('dw-jjpd', 'Ревью плана m06, круг 2', { status: 'in_progress' });
    expect(step(gate, [review, planTicket('dp-62p', 'm06', {}, 'closed')])?.reason).toBe('план M06 на проверке');
  });

  it('«Правки плана <slug>, …» counts as writing', () => {
    const gate = stageGate('dw-bl2e', 'M06');
    expect(step(gate, [bead('dp-x', 'Правки плана m06, круг 1')])?.reason).toBe('план M06 пишется');
  });

  it('staged, nothing open: «готов — город спросит» (nothing posted yet)', () => {
    const gate = stageGate('dw-bl2e', 'M06');
    expect(step(gate, [yesWait('dp-vd3', 'm06', 'dw-bl2e')])?.reason).toBe('план M06 готов — город спросит');
  });

  it('asked but no Discord link: «вопрос задан, ссылка не записана», not «ещё не задан»', () => {
    const plan = stageGate('dw-bl2e', 'M06');
    const planNoLink = { ...plan, metadata: { ...plan.metadata, 'devwork.plan_qid': 'q-6' } };
    expect(step(planNoLink, [])?.reason).toBe('план M06: вопрос задан, ссылка не записана');
    const action = bead('dw-a', 'PR #1: что с ним делать?', {
      issue_type: 'gate',
      await_type: 'human',
      metadata: { 'decision.question_id': 'q-1' },
    });
    expect(step(action, [])).toEqual({ label: 'PR #1: что с ним делать?', reason: 'вопрос задан, ссылка не записана' });
  });

  it('a city plan-yes wait takes its stage name from its plan gate, else its slug', () => {
    const gate = stageGate('dw-bl2e', 'M06');
    const wait = yesWait('dp-vd3', 'm06', 'dw-bl2e');
    const all = [gate, wait, planTicket('dp-62p', 'm06', { 'devwork.yes_wait': 'dp-vd3' })];
    expect(cityStepOf(wait, ownerDebtIndex(all), all)).toEqual({ label: 'план M06', reason: 'план M06 пишется' });
    const bcd = yesWait('dp-9u0', 'blind-columns-drop');
    const all2 = [bcd, planTicket('dp-2bk', 'blind-columns-drop', { 'devwork.yes_wait': 'dp-9u0' }, 'open')];
    expect(cityStepOf(bcd, ownerDebtIndex(all2), all2)?.reason).toBe('план blind-columns-drop пишется');
  });

  it('another unasked human gate is an ordinary step: «вопрос ещё не задан»', () => {
    const gate = bead('dw-a', 'Окно L1', { issue_type: 'gate', metadata: { 'gc.gate_type': 'human' } });
    expect(step(gate, [])).toEqual({ label: 'Окно L1', reason: 'вопрос ещё не задан — делает город' });
  });

  it('not a step: agent waits, route/timer gates, plain tasks', () => {
    const wait = bead('gcg-1', 'wait:plan-writer-2', { issue_type: 'gate', labels: ['gc:wait'], metadata: { 'gc.gate_type': 'human' } });
    expect(step(wait, [])).toBeNull();
    expect(step(bead('t', 'timer', { issue_type: 'gate', metadata: { 'gc.gate_type': 'timer' } }), [])).toBeNull();
    expect(step(bead('x', 'task'), [])).toBeNull();
  });
});
