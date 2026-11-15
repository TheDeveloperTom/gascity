import { describe, expect, it } from 'vitest';
import type { SupervisorBead } from '../supervisor/beadReads';
import { answerMail, OWNER_QUESTION_LABEL, ownerQuestionOf } from './ownerQuestions';

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

  it('question_id without the label is not a question', () => {
    const b = bead('dw-z', { metadata: { 'decision.question_id': 'q-1' } });
    expect(ownerQuestionOf(b)).toBeNull();
  });

  it('a closed bead is not a question', () => {
    expect(ownerQuestionOf({ ...QUESTION, status: 'closed' })).toBeNull();
  });

  it('dw-mqfcx.13 is not a question', () => {
    const b = bead('dw-mqfcx.13', {
      title: 'M03 #13 — повторная проверка очереди',
      labels: ['milestone:M03'],
      metadata: { 'devwork.pr_number': '489', 'devwork.pr_url': 'https://github.com/o/r/pull/489' },
    });
    expect(ownerQuestionOf(b)).toBeNull();
  });

  it('dw-59wd5s is not a question', () => {
    const b = bead('dw-59wd5s', { title: 'Почистить старые ветки', status: 'open' });
    expect(ownerQuestionOf(b)).toBeNull();
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

  it('a non-https chat link is dropped', () => {
    const b = {
      ...QUESTION,
      metadata: { ...QUESTION.metadata, 'decision.chat_url': 'javascript:alert(1)' },
    };
    expect(ownerQuestionOf(b)?.chatUrl).toBeNull();
  });

  it('no decide text falls back to the title', () => {
    const metadata = { ...QUESTION.metadata };
    delete metadata['decision.decide'];
    expect(ownerQuestionOf({ ...QUESTION, metadata })?.question).toBe(QUESTION.title);
  });
});

describe('answerMail', () => {
  it('answerMail subject «Ответ владельца: dw-x», JSON body with via dashboard', () => {
    const q = ownerQuestionOf(QUESTION);
    if (q === null) throw new Error('fixture is a question');
    const mail = answerMail(q, 'Сегодня вечером', '2026-11-15T12:30:00Z');
    expect(mail.to).toBe('mayor');
    expect(mail.subject).toBe('Ответ владельца: dw-x');
    expect(JSON.parse(mail.body)).toEqual({
      bead: 'dw-x',
      question_id: 'q-2026-11-15-1',
      label: 'Сегодня вечером',
      at: '2026-11-15T12:30:00Z',
      via: 'dashboard',
    });
  });
});
