import type { SupervisorBead } from '../supervisor/beadReads';

// Owner questions (dashboard v3, R-A, V3, V8; ruling C1). «Тебя ждёт» holds
// only beads the Mayor marked as a question for the owner: label
// `needs/operator`, metadata `decision.question_id`, and a link to the
// question's Discord message (`owner.link`, else `decision.chat_url`). The
// Mayor writes these keys (Task 5). The owner answers only in Discord; the
// dashboard shows the question and opens that link, and sends nothing.

export const OWNER_QUESTION_LABEL = 'needs/operator';

const DECIDE_KEY = 'decision.decide';
const WHY_KEY = 'decision.why';
const CHOICES_KEY = 'decision.choices_json';
const QUESTION_ID_KEY = 'decision.question_id';
const OWNER_LINK_KEY = 'owner.link';
const CHAT_URL_KEY = 'decision.chat_url';
const ASKED_AT_KEY = 'decision.asked_at';
const DISCORD_HOSTS: ReadonlySet<string> = new Set(['discord.com', 'discordapp.com']);

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
  /** The question's Discord message (discordLinkOf); never null. */
  chatUrl: string;
  askedAt: string | null;
}

function meta(bead: SupervisorBead, key: string): string {
  return bead.metadata?.[key]?.trim() ?? '';
}

function orNull(value: string): string | null {
  return value.length > 0 ? value : null;
}

function discordUrlOrNull(raw: string): string | null {
  if (raw.length === 0) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return null;
    if (url.port !== '' || !DISCORD_HOSTS.has(url.hostname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** The question's Discord message: `owner.link`, else `decision.chat_url`; https Discord only. */
export function discordLinkOf(bead: SupervisorBead): string | null {
  return discordUrlOrNull(meta(bead, OWNER_LINK_KEY)) ?? discordUrlOrNull(meta(bead, CHAT_URL_KEY));
}

function isMarkedQuestion(bead: SupervisorBead): boolean {
  if (bead.status === 'closed') return false;
  if (!(bead.labels ?? []).some((label) => label.trim() === OWNER_QUESTION_LABEL)) return false;
  return meta(bead, QUESTION_ID_KEY).length > 0;
}

/**
 * A marked owner question the owner cannot act on: no valid Discord link.
 * It never reaches «Тебя ждёт»; «Застряло» lists it as the Mayor's work (V3).
 */
export function isUnlinkedOwnerQuestion(bead: SupervisorBead): boolean {
  return isMarkedQuestion(bead) && discordLinkOf(bead) === null;
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
  if (!isMarkedQuestion(bead)) return null;
  const chatUrl = discordLinkOf(bead);
  if (chatUrl === null) return null;
  const decide = meta(bead, DECIDE_KEY);
  return {
    beadId: bead.id,
    title: bead.title,
    question: decide.length > 0 ? decide : bead.title,
    why: orNull(meta(bead, WHY_KEY)),
    choices: parseChoices(meta(bead, CHOICES_KEY)),
    questionId: meta(bead, QUESTION_ID_KEY),
    chatUrl,
    askedAt: orNull(meta(bead, ASKED_AT_KEY)),
  };
}
