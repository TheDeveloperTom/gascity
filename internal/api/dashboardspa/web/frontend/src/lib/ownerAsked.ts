import type { SupervisorBead } from '../supervisor/beadReads';
import { ownerQuestionOf, type OwnerQuestion } from './ownerQuestions';

// «От тебя» (owner 16.11): ONE rule for «Нужно от меня» and the graph's
// «От тебя» column, so the two lists and their numbers are the same: every
// open question actually put to the owner — `needs/operator`,
// `decision.question_id` and a Discord link (ownerQuestionOf).
// - «Держит N» is a label and a sort key (holders first). N = 0 reads
//   «ничего не держит»; it never hides a question the owner still owes.
// - One question id shows once: when a stage epic carries a copy of a
//   question a gate or task also carries, the non-epic bead wins.
// - A gate nobody asked yet (a stage plan gate before its plan exists) is no
//   question: the tasks behind it read «у этапа нет плана».

export interface AskedOwnerQuestion extends OwnerQuestion {
  /** Open tasks it holds, directly or not; an in-work carrier holds itself. */
  holds: number;
}

/** Holders first, then the longest wait (unknown waits last), then id. */
export function byHoldersFirst(a: { holds: number; waitedMs: number | null; id: string }, b: typeof a): number {
  return (
    Number(a.holds === 0) - Number(b.holds === 0) ||
    (b.waitedMs ?? -1) - (a.waitedMs ?? -1) ||
    a.id.localeCompare(b.id)
  );
}

/** Dependency types that do not block (lib/beadGraph, vk/graph/model). */
const NON_BLOCKING: ReadonlySet<string> = new Set([
  'parent-child',
  'related',
  'relates-to',
  'discovered-from',
  'duplicates',
  'supersedes',
  'replies-to',
  'tracks',
]);
const ROUTE_KEYS = ['gc.kind', 'gc.root_bead_id', 'gc.cross_store_blocker', 'gc.cross_store_gate_owner'] as const;

function isStage(bead: SupervisorBead): boolean {
  return bead.issue_type === 'epic' || bead.issue_type === 'convoy';
}

/** An open task: not a stage, a gate or engine route plumbing. */
function isOpenTask(bead: SupervisorBead): boolean {
  if (bead.status === 'closed' || isStage(bead) || bead.issue_type === 'gate') return false;
  return !ROUTE_KEYS.some((key) => (bead.metadata?.[key]?.trim() ?? '').length > 0);
}

/** A bead's blockers: its `needs` plus its blocking `dependencies[]`. */
export function blockingIdsOf(bead: SupervisorBead): string[] {
  const out = new Set<string>();
  for (const id of bead.needs ?? []) if (id.length > 0 && id !== bead.id) out.add(id);
  for (const dep of bead.dependencies ?? []) {
    if (!NON_BLOCKING.has(dep.type) && dep.depends_on_id.length > 0 && dep.depends_on_id !== bead.id) out.add(dep.depends_on_id);
  }
  return [...out];
}

/** Every bead that carries an asked owner question, duplicates included. */
export function allAskedQuestionIds(beads: readonly SupervisorBead[]): Set<string> {
  return new Set(beads.flatMap((b) => (ownerQuestionOf(b) !== null ? [b.id] : [])));
}

/** The «От тебя» set: every asked owner question, once per question id, with what it holds. */
export function askedOwnerQuestions(beads: readonly SupervisorBead[]): Map<string, AskedOwnerQuestion> {
  const byId = new Map<string, SupervisorBead>();
  for (const b of beads) if (!byId.has(b.id)) byId.set(b.id, b);
  const waitersOf = new Map<string, string[]>();
  for (const b of byId.values()) {
    if (b.status === 'closed') continue;
    for (const id of blockingIdsOf(b)) waitersOf.set(id, [...(waitersOf.get(id) ?? []), b.id]);
  }
  // One carrier per question id: a gate or task before a stage epic, then by id.
  const carrier = new Map<string, SupervisorBead>();
  for (const b of byId.values()) {
    const q = ownerQuestionOf(b);
    if (q === null) continue;
    const prev = carrier.get(q.questionId);
    const better =
      prev === undefined ||
      Number(isStage(b)) - Number(isStage(prev)) < 0 ||
      (isStage(b) === isStage(prev) && b.id.localeCompare(prev.id) < 0);
    if (better) carrier.set(q.questionId, b);
  }
  const out = new Map<string, AskedOwnerQuestion>();
  for (const b of carrier.values()) {
    const q = ownerQuestionOf(b) as OwnerQuestion;
    const seen = new Set<string>([b.id]);
    const stack = [...(waitersOf.get(b.id) ?? [])];
    let holds = b.status === 'in_progress' && isOpenTask(b) ? 1 : 0;
    while (stack.length > 0) {
      const id = stack.pop() as string;
      if (seen.has(id)) continue;
      seen.add(id);
      const w = byId.get(id);
      if (w === undefined || w.status === 'closed') continue;
      if (isOpenTask(w)) holds++;
      stack.push(...(waitersOf.get(id) ?? []));
    }
    out.set(b.id, { ...q, holds });
  }
  return out;
}
