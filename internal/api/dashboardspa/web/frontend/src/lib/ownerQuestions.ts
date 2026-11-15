import type { SupervisorBead } from '../supervisor/beadReads';

// Owner questions (dashboard v3, R-A, V3, V8). «Тебя ждёт» holds only beads
// the Mayor marked as a question for the owner: label `needs/operator` plus
// metadata `decision.question_id`. The Mayor writes the `decision.*` keys
// (Task 5); the owner's answer goes back as one mail to the Mayor.

export const OWNER_QUESTION_LABEL = 'needs/operator';

const DECIDE_KEY = 'decision.decide';
const WHY_KEY = 'decision.why';
const CHOICES_KEY = 'decision.choices_json';
const QUESTION_ID_KEY = 'decision.question_id';
const CHAT_URL_KEY = 'decision.chat_url';
const ASKED_AT_KEY = 'decision.asked_at';

/** The subject prefix the Mayor rule (Task 5) matches. A protocol string, never translated. */
export const ANSWER_SUBJECT_PREFIX = 'Ответ владельца: ';

export interface OwnerChoice {
  label: string;
  then: string;
}

export interface OwnerQuestion {
  beadId: string;
  title: string;
  question: string;
  why: string | null;
  /** Empty for a legacy ask with no `decision.choices_json` (V8). */
  choices: readonly OwnerChoice[];
  questionId: string;
  chatUrl: string | null;
  askedAt: string | null;
}

function meta(bead: SupervisorBead, key: string): string {
  return bead.metadata?.[key]?.trim() ?? '';
}

function orNull(value: string): string | null {
  return value.length > 0 ? value : null;
}

function httpsOrNull(raw: string): string | null {
  if (raw.length === 0) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && url.username === '' && url.password === ''
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function parseChoices(raw: string): OwnerChoice[] {
  if (raw.length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const choices: OwnerChoice[] = [];
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) return [];
    const { label, then } = entry as { label?: unknown; then?: unknown };
    if (typeof label !== 'string' || label.trim().length === 0) return [];
    choices.push({ label: label.trim(), then: typeof then === 'string' ? then.trim() : '' });
  }
  return choices;
}

export function ownerQuestionOf(bead: SupervisorBead): OwnerQuestion | null {
  if (bead.status === 'closed') return null;
  if (!(bead.labels ?? []).some((label) => label.trim() === OWNER_QUESTION_LABEL)) return null;
  const questionId = meta(bead, QUESTION_ID_KEY);
  if (questionId.length === 0) return null;
  const decide = meta(bead, DECIDE_KEY);
  return {
    beadId: bead.id,
    title: bead.title,
    question: decide.length > 0 ? decide : bead.title,
    why: orNull(meta(bead, WHY_KEY)),
    choices: parseChoices(meta(bead, CHOICES_KEY)),
    questionId,
    chatUrl: httpsOrNull(meta(bead, CHAT_URL_KEY)),
    askedAt: orNull(meta(bead, ASKED_AT_KEY)),
  };
}

/** The owner's answer as one mail to the Mayor (V3). */
export function answerMail(
  q: OwnerQuestion,
  label: string,
  atIso: string,
): { to: 'mayor'; subject: string; body: string } {
  return {
    to: 'mayor',
    subject: `${ANSWER_SUBJECT_PREFIX}${q.beadId}`,
    body: JSON.stringify({
      bead: q.beadId,
      question_id: q.questionId,
      label,
      at: atIso,
      via: 'dashboard',
    }),
  };
}
