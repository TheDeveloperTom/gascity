import {
  gateQuestionWithoutLink,
  gateTypeOf,
  isAgentWait,
  isOwnerDebt,
  type OwnerDebtIndex,
} from '../../lib/ownerQuestions';
import type { SupervisorBead } from '../../supervisor/beadReads';

// An open gate the city still works on (owner 20.11): a plan «да» nobody has
// asked yet, or any other human gate with no question posted. It is an
// ordinary step in the flow with an honest status, never «От тебя» and never
// an owner counter (lib/ownerQuestions.ts ownerDebtOf decides those).
//
// The plan's status is read from the plan's own beads, as the city writes them
// (city repo commands/plan/help.md:6-13, :46-48; plan_launch.py:306;
// plan_yes.py:22):
//   - the stage gate «да на план M0X»: `devwork.gate_kind=plan`, `devwork.stage`;
//   - the city's wait «ждёт «да» на план <slug>»: `gc.gate_type=plan-yes`
//     (= `devwork.gate_kind`), `devwork.plan_slug`, `devwork.plan_gate`;
//   - the planning ticket «План <slug>» / «Правки плана <slug>, …»:
//     `devwork.kind=plan`, `devwork.plan_slug`, `devwork.plan_gate`, `devwork.yes_wait`;
//   - the review ticket «Ревью плана <slug>, круг N» (carries no slug key; its
//     title is the city's fixed shape).
// Open review → «на проверке»; open planning ticket, or no plan staged yet →
// «пишется»; staged and nothing open → «готов — город спросит» (nothing is
// posted yet; once `plan ask` posts the question, ownerDebtOf takes over).
// A gate with a question id and no Discord link → «вопрос задан, ссылка не
// записана» (asked, but the owner has no button: the Mayor asks again).

export interface CityStep {
  /** The node's short name: «план M06». */
  label: string;
  /** The status line: «план M06 пишется». */
  reason: string;
}

const PLAN_KIND = 'plan';
const PLAN_YES = 'plan-yes';
const HUMAN = 'human';
const NO_LINK = 'вопрос задан, ссылка не записана';

function meta(bead: SupervisorBead, key: string): string {
  return bead.metadata?.[key]?.trim() ?? '';
}

function isPlanGate(bead: SupervisorBead): boolean {
  const kind = meta(bead, 'devwork.gate_kind');
  return kind === PLAN_KIND || kind === PLAN_YES || gateTypeOf(bead) === PLAN_YES;
}

/** True for an open gate the city works on: a plan gate, or a human gate with no question posted. */
export function isCityStepGate(bead: SupervisorBead, index?: OwnerDebtIndex): boolean {
  if (bead.issue_type !== 'gate' || bead.status === 'closed' || isAgentWait(bead)) return false;
  if (isOwnerDebt(bead, index)) return false;
  return isPlanGate(bead) || gateTypeOf(bead) === HUMAN;
}

const lower = (s: string) => s.trim().toLocaleLowerCase('ru');

function reviewSlugOf(title: string): string | null {
  const m = /^Ревью плана\s+(\S+?),\s*круг/u.exec(title.trim());
  return m === null ? null : lower(m[1] ?? '');
}

function writingSlugOf(title: string): string | null {
  const t = title.trim();
  const fix = /^Правки плана\s+(\S+?)(?:,|\s|$)/u.exec(t);
  if (fix !== null) return lower(fix[1] ?? '');
  const plan = /^План\s+(\S+)$/u.exec(t);
  return plan === null ? null : lower(plan[1] ?? '');
}

export function cityStepOf(
  gate: SupervisorBead,
  index: OwnerDebtIndex,
  all: ReadonlyArray<SupervisorBead>,
): CityStep | null {
  if (!isCityStepGate(gate, index)) return null;
  // Asked, but the Discord link was never written: the Mayor's to ask again (V3).
  const noLink = gateQuestionWithoutLink(gate, index);
  if (!isPlanGate(gate)) {
    return { label: gate.title.trim(), reason: noLink ? NO_LINK : 'вопрос ещё не задан — делает город' };
  }

  const planGateId = meta(gate, 'devwork.plan_gate');
  const planGate = planGateId.length > 0 ? index.lookup(planGateId) : undefined;
  const stage = meta(gate, 'devwork.stage') || (planGate === undefined ? '' : meta(planGate, 'devwork.stage'));
  const slug = lower(meta(gate, 'devwork.plan_slug') || stage);
  const name = stage || meta(gate, 'devwork.plan_slug') || gate.title.trim();
  // The stage gate and its city wait are one plan: tickets naming either belong to it.
  const ids = new Set([gate.id, ...(planGateId.length > 0 ? [planGateId] : [])]);

  let reviewing = false;
  let writing = false;
  let staged = gateTypeOf(gate) === PLAN_YES || meta(gate, 'devwork.plan_slug').length > 0;
  for (const b of all) {
    if (b.status === 'closed' || b.id === gate.id) continue;
    if (slug.length > 0 && reviewSlugOf(b.title) === slug) reviewing = true;
    const ticketForThis =
      meta(b, 'devwork.kind') === PLAN_KIND &&
      (ids.has(meta(b, 'devwork.plan_gate')) ||
        ids.has(meta(b, 'devwork.yes_wait')) ||
        (slug.length > 0 && lower(meta(b, 'devwork.plan_slug')) === slug));
    if (ticketForThis || (slug.length > 0 && writingSlugOf(b.title) === slug)) writing = true;
    if (
      b.issue_type === 'gate' &&
      isPlanGate(b) &&
      gateTypeOf(b) === PLAN_YES &&
      (ids.has(meta(b, 'devwork.plan_gate')) || (slug.length > 0 && lower(meta(b, 'devwork.plan_slug')) === slug))
    ) {
      staged = true;
    }
  }
  const label = `план ${name}`;
  if (noLink) return { label, reason: `${label}: ${NO_LINK}` };
  if (reviewing) return { label, reason: `${label} на проверке` };
  if (writing || !staged) return { label, reason: `${label} пишется` };
  // Not «спрашиваем тебя»: nothing is posted yet (review approved but ask refused,
  // or the gap before a fix ticket) — the city will ask (review of fork #6).
  return { label, reason: `${label} готов — город спросит` };
}
