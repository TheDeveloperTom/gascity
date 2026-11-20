import { describe, expect, it } from 'vitest';
import type { SupervisorBead } from '../supervisor/beadReads';
import { LIVE_59WD5S, LIVE_MQFCX13 } from '../test/fixtures/liveCards';
import {
  discordLinkOf,
  isAgentWait,
  isOwnerDebt,
  isUnaskedHumanGate,
  isUnlinkedOwnerQuestion,
  OWNER_QUESTION_LABEL,
  gateQuestionWithoutLink,
  ownerDebtIndex,
  ownerDebtOf,
  ownerQuestionOf,
} from './ownerQuestions';

// R-A: «Тебя ждёт» holds only beads the Mayor marked as an owner question:
// label needs/operator plus metadata decision.question_id (Task 5 writes them).

function bead(id: string, extra: Partial<SupervisorBead> = {}): SupervisorBead {
  return {
    id,
    title: `bead ${id}`,
    status: 'open',
    issue_type: 'task',
    created_at: '2026-11-12T09:00:00Z',
    ...extra,
  };
}

const QUESTION = bead('dw-x', {
  title: 'Перенос ящика на основной аккаунт',
  labels: [OWNER_QUESTION_LABEL, 'milestone:M03'],
  metadata: {
    'decision.decide': 'Когда переносим ящик на основной аккаунт?',
    'decision.why': 'Без переноса M03 не закрыть.',
    'decision.choices_json': JSON.stringify([
      { label: 'Сегодня вечером', then: 'Мэр запускает перенос в 20:00' },
      { label: 'Отложить', then: 'M03 ждёт' },
    ]),
    'decision.question_id': 'q-2026-11-15-1',
    'decision.chat_url': 'https://discord.com/channels/1/2/3',
    'decision.asked_at': '2026-11-15T10:00:00Z',
  },
});

describe('ownerQuestionOf', () => {
  it('reads a full owner question', () => {
    expect(ownerQuestionOf(QUESTION)).toEqual({
      beadId: 'dw-x',
      title: 'Перенос ящика на основной аккаунт',
      question: 'Когда переносим ящик на основной аккаунт?',
      why: 'Без переноса M03 не закрыть.',
      choices: [
        { label: 'Сегодня вечером', then: 'Мэр запускает перенос в 20:00' },
        { label: 'Отложить', then: 'M03 ждёт' },
      ],
      questionId: 'q-2026-11-15-1',
      chatUrl: 'https://discord.com/channels/1/2/3',
      askedAt: '2026-11-15T10:00:00Z',
    });
  });

  it('label without question_id is not a question', () => {
    const b = bead('dw-y', {
      labels: [OWNER_QUESTION_LABEL],
      metadata: { 'decision.decide': 'Что делать?' },
    });
    expect(ownerQuestionOf(b)).toBeNull();
  });

  it('the label is display only: a posted question without it still reads', () => {
    const b = bead('dw-z', {
      metadata: { 'decision.question_id': 'q-1', 'owner.link': 'https://discord.com/channels/1/2/3' },
    });
    expect(ownerQuestionOf(b)?.questionId).toBe('q-1');
  });

  it('a closed bead is not a question', () => {
    expect(ownerQuestionOf({ ...QUESTION, status: 'closed' })).toBeNull();
  });

  it('dw-mqfcx.13 is not a question', () => {
    expect(ownerQuestionOf(LIVE_MQFCX13)).toBeNull();
    expect(isUnlinkedOwnerQuestion(LIVE_MQFCX13)).toBe(false);
  });

  it('dw-59wd5s is not a question', () => {
    expect(ownerQuestionOf(LIVE_59WD5S)).toBeNull();
  });

  it('bad choices_json gives a legacy question with no choices', () => {
    const b = {
      ...QUESTION,
      metadata: { ...QUESTION.metadata, 'decision.choices_json': '[{"label":' },
    };
    const q = ownerQuestionOf(b);
    expect(q).not.toBeNull();
    expect(q?.choices).toEqual([]);
    expect(q?.question).toBe('Когда переносим ящик на основной аккаунт?');
  });

  it('link comes from owner.link, else decision.chat_url', () => {
    const both = {
      ...QUESTION,
      metadata: { ...QUESTION.metadata, 'owner.link': 'https://discord.com/channels/9/8/7' },
    };
    expect(discordLinkOf(both)).toBe('https://discord.com/channels/9/8/7');
    expect(ownerQuestionOf(both)?.chatUrl).toBe('https://discord.com/channels/9/8/7');
    expect(discordLinkOf(QUESTION)).toBe('https://discord.com/channels/1/2/3');
    const legacyHost = {
      ...QUESTION,
      metadata: { ...QUESTION.metadata, 'owner.link': 'https://discordapp.com/channels/1/2/4' },
    };
    expect(discordLinkOf(legacyHost)).toBe('https://discordapp.com/channels/1/2/4');
  });

  it('no https link means not a question', () => {
    const metadata = { ...QUESTION.metadata };
    delete metadata['decision.chat_url'];
    const none = { ...QUESTION, metadata };
    const bad = (link: string) => ({ ...QUESTION, metadata: { ...metadata, 'owner.link': link } });
    for (const b of [
      none,
      bad('javascript:alert(1)'),
      bad('http://discord.com/channels/1/2/3'),
      bad('https://example.com/channels/1/2/3'),
      bad('https://discord.com.evil.io/x'),
    ]) {
      expect(discordLinkOf(b)).toBeNull();
      expect(ownerQuestionOf(b)).toBeNull();
      expect(isUnlinkedOwnerQuestion(b)).toBe(true);
    }
    expect(isUnlinkedOwnerQuestion(QUESTION)).toBe(false);
    expect(isUnlinkedOwnerQuestion(bead('dw-plain'))).toBe(false);
  });

  it('no decide text falls back to the title', () => {
    const metadata = { ...QUESTION.metadata };
    delete metadata['decision.decide'];
    expect(ownerQuestionOf({ ...QUESTION, metadata })?.question).toBe(QUESTION.title);
  });
});

// DIAG-board-vs-needs-you 20.11 (B5): one rule for «the owner owes this».
describe('ownerDebtOf: the one native rule', () => {
  // A human gate the owner was asked on (live dw-v60o shape, without the label).
  const GATE: SupervisorBead = {
    ...QUESTION,
    id: 'dw-g',
    issue_type: 'gate',
    labels: [],
    metadata: { ...QUESTION.metadata, 'gc.gate_type': 'human' },
  };

  it('an open human gate with a posted question is owner debt; the label plays no part', () => {
    expect(isOwnerDebt(GATE)).toBe(true);
    expect(ownerDebtOf(GATE)?.beadId).toBe('dw-g');
    expect(isOwnerDebt({ ...GATE, labels: [OWNER_QUESTION_LABEL] })).toBe(true);
  });

  it('bd’s own await_type counts like gc.gate_type (core notify-on-human-gate-creation.sh:169-173)', () => {
    const bdGate: SupervisorBead = { ...GATE, metadata: { ...QUESTION.metadata }, await_type: 'human' };
    expect(isOwnerDebt(bdGate)).toBe(true);
    // await_type wins over gc.gate_type
    expect(isOwnerDebt({ ...GATE, await_type: 'timer' })).toBe(false);
  });

  // Review of fork #6, B1/B3 (VERIFY §5): before every card question has its
  // own answer gate, the city asks on plain cards; they must still count.
  it('plain-card fallback: label + posted question on an open card counts', () => {
    expect(isOwnerDebt(QUESTION)).toBe(true);
    expect(ownerDebtOf(QUESTION)?.beadId).toBe('dw-x');
    // an in-work card counts the same (no gate needed)
    expect(isOwnerDebt({ ...QUESTION, status: 'in_progress' })).toBe(true);
  });

  it('plain-card fallback needs the label, the posted question and an open card', () => {
    expect(isOwnerDebt({ ...QUESTION, labels: ['milestone:M03'] })).toBe(false);
    expect(isOwnerDebt({ ...QUESTION, status: 'closed' })).toBe(false);
    const noLink = { ...QUESTION, metadata: { ...QUESTION.metadata } };
    delete noLink.metadata['decision.chat_url'];
    expect(isOwnerDebt(noLink)).toBe(false);
    expect(isOwnerDebt({ ...QUESTION, labels: [...(QUESTION.labels ?? []), 'gc:wait'] })).toBe(false);
  });

  it('a card with an open answer gate is not counted itself: the gate is, once', () => {
    const answerGate = bead('dw-ag', {
      issue_type: 'gate',
      metadata: { 'gc.gate_type': 'human', 'devwork.gate_kind': 'answer', 'devwork.answer_for': 'dw-x' },
    });
    const index = ownerDebtIndex([QUESTION, answerGate]);
    expect(ownerDebtOf(QUESTION, index)).toBeNull();
    expect(ownerDebtOf(answerGate, index)?.questionId).toBe('q-2026-11-15-1');
    // a closed answer gate no longer holds the card: it counts again
    const closed = ownerDebtIndex([QUESTION, { ...answerGate, status: 'closed' }]);
    expect(ownerDebtOf(QUESTION, closed)?.beadId).toBe('dw-x');
  });

  it('only a human gate: a typeless, plan-yes or timer gate is not owner debt', () => {
    expect(isOwnerDebt({ ...GATE, metadata: { ...QUESTION.metadata } })).toBe(false);
    expect(isOwnerDebt({ ...GATE, metadata: { ...GATE.metadata, 'gc.gate_type': 'plan-yes' } })).toBe(false);
    expect(isOwnerDebt({ ...GATE, metadata: { ...GATE.metadata, 'gc.gate_type': 'timer' } })).toBe(false);
  });

  it('a closed (answered) gate is not owner debt', () => {
    expect(isOwnerDebt({ ...GATE, status: 'closed' })).toBe(false);
  });

  it('a human gate with no question posted is not owner debt (a plan «да» nobody asked yet)', () => {
    const planGate = bead('dw-bl2e', {
      issue_type: 'gate',
      title: 'да на план M06',
      metadata: { 'devwork.gate_kind': 'plan', 'devwork.owner_gate': 'true', 'devwork.stage': 'M06', 'gc.gate_type': 'human' },
    });
    expect(isOwnerDebt(planGate)).toBe(false);
    expect(isUnaskedHumanGate(planGate)).toBe(true);
    // a question id with no Discord link is not posted either: asked, link missing
    const noLink = { ...planGate, metadata: { ...planGate.metadata, 'devwork.plan_qid': 'q-9' } };
    expect(isOwnerDebt(noLink)).toBe(false);
    expect(gateQuestionWithoutLink(noLink)).toBe(true);
    expect(gateQuestionWithoutLink(planGate)).toBe(false);
    // plan ask posted: devwork.plan_qid + the card's link
    const asked = {
      ...planGate,
      metadata: { ...planGate.metadata, 'devwork.plan_qid': 'q-9', 'decision.chat_url': 'https://discord.com/channels/1/2/9' },
    };
    expect(ownerDebtOf(asked)?.questionId).toBe('q-9');
    expect(isUnaskedHumanGate(asked)).toBe(false);
  });

  it('an answer gate takes its question from the card it answers for (devwork.answer_for)', () => {
    const card = bead('dw-card', { ...QUESTION, id: 'dw-card', labels: [] });
    const answerGate = bead('dw-ag', {
      issue_type: 'gate',
      title: 'ответ на dw-card',
      metadata: { 'gc.gate_type': 'human', 'devwork.gate_kind': 'answer', 'devwork.answer_for': 'dw-card' },
    });
    const index = ownerDebtIndex([card, answerGate]);
    const debt = ownerDebtOf(answerGate, index);
    expect(debt?.beadId).toBe('dw-ag');
    expect(debt?.questionId).toBe('q-2026-11-15-1');
    expect(ownerDebtOf(answerGate)).toBeNull();
    expect(ownerDebtOf({ ...answerGate, status: 'closed' }, index)).toBeNull();
  });

  it('an agent session wait (gc:wait, session:*) is never owner debt, whatever it carries', () => {
    expect(isOwnerDebt({ ...GATE, labels: ['gc:wait'] })).toBe(false);
    expect(isOwnerDebt({ ...GATE, labels: ['session:gcg-session-1'] })).toBe(false);
    expect(isAgentWait(bead('gcg-1', { issue_type: 'gate', title: 'wait:plan-writer-2', labels: ['gc:wait'] }))).toBe(true);
    expect(isAgentWait(QUESTION)).toBe(false);
    expect(isUnaskedHumanGate({ ...GATE, labels: ['gc:wait'] })).toBe(false);
  });
});
