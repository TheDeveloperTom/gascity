import type { SupervisorBead } from '../supervisor/beadReads';
import { ownerQuestionOf, type OwnerQuestion } from './ownerQuestions';

// «От тебя» (owner 16.11): ONE rule for «Нужно от меня» and the graph's
// «От тебя» column, so the two lists and their numbers are the same. An
// owner question counts when
//   (a) it holds at least one open task, directly or through others, and
//   (b) it was actually put to the owner: `needs/operator`,
//       `decision.question_id` and a Discord link (ownerQuestionOf).
// A gate nobody asked yet is not a question (the city asks it, then it
// counts); a question that holds nothing is noise (the city closes such
// gates). An epic is a stage, never a question: its owner question lives on
// the stage's gate.

export interface AskedOwnerQuestion extends OwnerQuestion {
  /** Open tasks it holds, directly or not; an in-work carrier holds itself. */
  holds: number;
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

/** Every asked owner question on the read, whatever it holds (stage beads excluded). */
export function allAskedQuestionIds(beads: readonly SupervisorBead[]): Set<string> {
  return new Set(beads.flatMap((b) => (!isStage(b) && ownerQuestionOf(b) !== null ? [b.id] : [])));
}

/** The «От тебя» set: asked owner questions that hold at least one open task. */
export function askedOwnerQuestions(beads: readonly SupervisorBead[]): Map<string, AskedOwnerQuestion> {
  const byId = new Map<string, SupervisorBead>();
  for (const b of beads) if (!byId.has(b.id)) byId.set(b.id, b);
  const waitersOf = new Map<string, string[]>();
  for (const b of byId.values()) {
    if (b.status === 'closed') continue;
    for (const id of blockingIdsOf(b)) waitersOf.set(id, [...(waitersOf.get(id) ?? []), b.id]);
  }
  const out = new Map<string, AskedOwnerQuestion>();
  for (const b of byId.values()) {
    if (isStage(b)) continue;
    const q = ownerQuestionOf(b);
    if (q === null) continue;
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
    if (holds > 0) out.set(b.id, { ...q, holds });
  }
  return out;
}
