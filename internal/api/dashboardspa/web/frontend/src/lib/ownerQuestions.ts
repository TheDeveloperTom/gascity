import type { SupervisorBead } from '../supervisor/beadReads';

// Owner questions and owner debt (dashboard v3, R-A, V3, V8; ruling C1;
// DIAG-board-vs-needs-you 20.11).
//
// ONE rule decides «the owner owes this» (ownerDebtOf). Every owner view
// reads it: the graph's «От тебя» column, «N ждут твоих ответов», «держит
// меня», «больше всех держит», «Нужно от меня» and its badge. The rule is the
// engine's own:
//
//   - an OPEN gate bead whose type is `human`. bd's own gates carry the type
//     in bd's `await_type` column (the API bead carries it since this change:
//     internal/beads/beads.go Bead.AwaitType), a gate a formula synthesized
//     (and the city's plan gates) carry it as `gc.gate_type` metadata
//     (D:17622-17630, D:19055-19062);
//     the core pack's human-gate orders read it the same way
//     (packs/core/assets/scripts/notify-on-human-gate-creation.sh:169-173).
//     A gate blocks until it is closed (D:18512-18518); the owner's verified
//     answer closes it, so «open» means «not answered yet».
//   - with a question POSTED for it: a question id (`decision.question_id`,
//     or `devwork.plan_qid` for a plan «да») and that question's https Discord
//     link (`owner.link`, else `decision.chat_url`), on the gate itself or on
//     the card the gate holds (`devwork.answer_for`: a card question waits
//     behind its own answer gate). A human gate with no question posted is
//     the city's work (a plan being written, reviewed, about to be asked),
//     never the owner's debt.
//   - never an agent's session wait (`gc:wait` / `session:*` labels): that is
//     an agent waiting on an agent (D:12103-12115, D:13266-13317, D:14072).
//
// The `needs/operator` label is display only: it decides nothing here.
// The owner answers only in Discord; the dashboard opens that link and sends
// nothing.

export const OWNER_QUESTION_LABEL = 'needs/operator';

const DECIDE_KEY = 'decision.decide';
const WHY_KEY = 'decision.why';
const CHOICES_KEY = 'decision.choices_json';
const QUESTION_ID_KEY = 'decision.question_id';
const PLAN_QID_KEY = 'devwork.plan_qid';
const OWNER_LINK_KEY = 'owner.link';
const CHAT_URL_KEY = 'decision.chat_url';
const ASKED_AT_KEY = 'decision.asked_at';
const GATE_TYPE_KEY = 'gc.gate_type';
const ANSWER_FOR_KEY = 'devwork.answer_for';
const HUMAN_GATE = 'human';
/** Engine durable session waits: `gc session wait` / `gc wait` (D:12103-12115, D:13266-13317, D:14072). */
const AGENT_WAIT_LABEL = 'gc:wait';
const SESSION_LABEL_PREFIX = 'session:';
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

/** Reads another bead of the same board by id (the card an answer gate holds). */
export type BeadLookup = (id: string) => SupervisorBead | undefined;

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

function questionIdOf(bead: SupervisorBead): string {
  return meta(bead, QUESTION_ID_KEY) || meta(bead, PLAN_QID_KEY);
}

/** An engine durable session wait: an agent waits on a bead. Never the owner's. */
export function isAgentWait(bead: SupervisorBead): boolean {
  return (bead.labels ?? []).some((l) => {
    const label = l.trim();
    return label === AGENT_WAIT_LABEL || label.startsWith(SESSION_LABEL_PREFIX);
  });
}

/**
 * The gate's engine type: bd's `await_type` column (a gate `bd gate create
 * --type=…` made, e.g. every `owner ask --gate action` gate), else
 * `gc.gate_type` metadata (a formula-synthesized or city-stamped gate), the
 * order the core pack's human-gate order reads them in.
 */
export function gateTypeOf(bead: SupervisorBead): string {
  const own = bead.await_type?.trim() ?? '';
  if (own.length > 0) return own;
  return meta(bead, GATE_TYPE_KEY);
}

/** An open human gate that is not an agent's wait: something only a person releases. */
export function isOpenHumanGate(bead: SupervisorBead): boolean {
  return (
    bead.issue_type === 'gate' && bead.status !== 'closed' && gateTypeOf(bead) === HUMAN_GATE && !isAgentWait(bead)
  );
}

/**
 * A posted question carried by this bead, read for display: a question id and
 * its Discord link. Not the owner-debt rule (that is ownerDebtOf); the detail
 * modal uses it to show the question on any card that carries one.
 */
export function ownerQuestionOf(bead: SupervisorBead): OwnerQuestion | null {
  if (bead.status === 'closed') return null;
  const questionId = questionIdOf(bead);
  if (questionId.length === 0) return null;
  const chatUrl = discordLinkOf(bead);
  if (chatUrl === null) return null;
  const decide = meta(bead, DECIDE_KEY);
  return {
    beadId: bead.id,
    title: bead.title,
    question: decide.length > 0 ? decide : bead.title,
    why: orNull(meta(bead, WHY_KEY)),
    choices: parseChoices(meta(bead, CHOICES_KEY)),
    questionId,
    chatUrl,
    askedAt: orNull(meta(bead, ASKED_AT_KEY)),
  };
}

/** The bead that carries the gate's question: the gate itself, else the card it answers for. */
function questionCarrierOf(gate: SupervisorBead, lookup?: BeadLookup): SupervisorBead {
  if (questionIdOf(gate).length > 0) return gate;
  const card = meta(gate, ANSWER_FOR_KEY);
  const held = card.length > 0 && lookup !== undefined ? lookup(card) : undefined;
  return held ?? gate;
}

/**
 * THE owner-debt rule: an open human gate with a question posted for it. The
 * result is keyed by the gate (the bead that blocks the work); its text comes
 * from whichever bead carries the question.
 */
export function ownerDebtOf(bead: SupervisorBead, lookup?: BeadLookup): OwnerQuestion | null {
  if (!isOpenHumanGate(bead)) return null;
  const carrier = questionCarrierOf(bead, lookup);
  const q = ownerQuestionOf(carrier);
  if (q === null) return null;
  return carrier.id === bead.id ? q : { ...q, beadId: bead.id };
}

export function isOwnerDebt(bead: SupervisorBead, lookup?: BeadLookup): boolean {
  return ownerDebtOf(bead, lookup) !== null;
}

/**
 * An open human gate nobody has asked the owner about yet (no question posted):
 * the city's work, shown as an ordinary step, never counted as the owner's.
 */
export function isUnaskedHumanGate(bead: SupervisorBead, lookup?: BeadLookup): boolean {
  return isOpenHumanGate(bead) && !isOwnerDebt(bead, lookup);
}

/**
 * A question id with no valid Discord link: the owner cannot act on it. It
 * never reaches «Нужно от меня»; «Застряло» lists it as the Mayor's work (V3).
 */
export function isUnlinkedOwnerQuestion(bead: SupervisorBead): boolean {
  if (bead.status === 'closed' || isAgentWait(bead)) return false;
  return questionIdOf(bead).length > 0 && discordLinkOf(bead) === null;
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
