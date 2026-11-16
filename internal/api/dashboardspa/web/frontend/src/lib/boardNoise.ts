import type { SupervisorBead } from '../supervisor/beadReads';

// VK 1:1 (16.11): the board shows the project's work items only. The engine
// also writes task-typed beads that are not work — plan-review rounds, PR
// repairs, gate-failure reworks and stall alarms. They are kept aside (they may
// still name a blocker) but never become cards.
//
// Each rule says how the row is identified on the live store (16.11):
// - issue types that are engine machinery (convoy, molecule, step, gate);
// - metadata the engine stamps on alarm beads (`devwork.stopped_card` on a
//   «стоит: …» bead, `devwork.intake_needs_person` on «ждут решения человека»);
// - title prefixes, where no marker exists (GUESSWORK, live titles only):
//   «Ревью плана … круг N», «Repair PR #…», «Доработка по провалу ворот…»,
//   «стоит: …».

const MACHINERY_TYPES: ReadonlySet<string> = new Set(['convoy', 'molecule', 'step', 'gate', 'wisp']);

const ALARM_METADATA_KEYS: readonly string[] = ['devwork.stopped_card', 'devwork.intake_needs_person'];

const NOISE_TITLE_PATTERNS: readonly RegExp[] = [
  /^\s*Ревью плана\s.*круг\s*\d+/iu,
  /^\s*стоит:\s/i,
];

// I1 (REVIEW 16.11): PR repairs and gate reworks are real agent work. They are
// noise only while nobody is on them; in progress or assigned, they are cards.
const IDLE_ONLY_NOISE_TITLE_PATTERNS: readonly RegExp[] = [
  /^\s*Repair PR #/i,
  /^\s*Доработка по провалу ворот/i,
];

function agentIsOn(bead: SupervisorBead): boolean {
  return bead.status === 'in_progress' || (bead.assignee?.trim() ?? '').length > 0;
}

/** True when a bead is engine bookkeeping, not a work item for the board. */
export function isBoardNoise(bead: SupervisorBead): boolean {
  if (MACHINERY_TYPES.has(bead.issue_type)) return true;
  const metadata = bead.metadata ?? {};
  if (ALARM_METADATA_KEYS.some((key) => (metadata[key] ?? '').trim().length > 0)) return true;
  const title = bead.title ?? '';
  if (NOISE_TITLE_PATTERNS.some((re) => re.test(title))) return true;
  return !agentIsOn(bead) && IDLE_ONLY_NOISE_TITLE_PATTERNS.some((re) => re.test(title));
}
