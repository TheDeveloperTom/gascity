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
  /** Those tasks (ids). */
  waiters: ReadonlySet<string>;
  /** Tasks that start the moment it is answered (no other open blocker). */
  opensNow: number;
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
  return ownerAskedOf(beads).questions;
}

/**
 * The one owner model (review 16.11): computed ONCE from the raw bead set a
 * page loads (ownerBeadsOf), before any view drops service or noise beads.
 * The shelf, the badge, the per-epic graph and the all-tickets graph all
 * read it; no view walks its own edges to say what a question holds.
 */
export interface OwnerAsked {
  /** Winning carrier id → its question (one per question id). */
  questions: Map<string, AskedOwnerQuestion>;
  /** Every bead carrying an asked question, duplicates included. */
  carriers: ReadonlySet<string>;
  /** Open task → the questions (winning carrier ids) it waits on, directly or through others. */
  heldBy: ReadonlyMap<string, readonly string[]>;
  /**
   * Marked for the owner with a question id but no Discord link yet: the
   * question is being asked. Not «От тебя» yet; its tasks say «вопрос задаётся».
   */
  asking: ReadonlySet<string>;
}

/** The raw bead set of one board read: the unscoped window, every rig's open work store, the service beads. */
export function ownerBeadsOf(data: {
  items: readonly SupervisorBead[];
  rigStoreItems?: readonly SupervisorBead[];
  serviceItems: readonly SupervisorBead[];
}): SupervisorBead[] {
  const seen = new Set<string>();
  const out: SupervisorBead[] = [];
  for (const bead of [...data.items, ...(data.rigStoreItems ?? []), ...data.serviceItems]) {
    if (seen.has(bead.id)) continue;
    seen.add(bead.id);
    out.push(bead);
  }
  return out;
}

const OWNER_LABEL = 'needs/operator';

function isAsking(bead: SupervisorBead): boolean {
  if (bead.status === 'closed' || ownerQuestionOf(bead) !== null) return false;
  if (!(bead.labels ?? []).some((l) => l.trim() === OWNER_LABEL)) return false;
  return (bead.metadata?.['decision.question_id']?.trim() ?? '').length > 0;
}

export function ownerAskedOf(beads: readonly SupervisorBead[]): OwnerAsked {
  const byId = new Map<string, SupervisorBead>();
  for (const b of beads) if (!byId.has(b.id)) byId.set(b.id, b);
  const waitersOf = new Map<string, string[]>();
  for (const b of byId.values()) {
    if (b.status === 'closed') continue;
    for (const id of blockingIdsOf(b)) waitersOf.set(id, [...(waitersOf.get(id) ?? []), b.id]);
  }
  // One carrier per question id: a gate or task before a stage epic, then by id.
  const carrier = new Map<string, SupervisorBead>();
  const carriers = new Set<string>();
  for (const b of byId.values()) {
    const q = ownerQuestionOf(b);
    if (q === null) continue;
    carriers.add(b.id);
    const prev = carrier.get(q.questionId);
    const better =
      prev === undefined ||
      Number(isStage(b)) - Number(isStage(prev)) < 0 ||
      (isStage(b) === isStage(prev) && b.id.localeCompare(prev.id) < 0);
    if (better) carrier.set(q.questionId, b);
  }
  const winnerOf = new Map<string, string>();
  for (const id of carriers) {
    const q = ownerQuestionOf(byId.get(id) as SupervisorBead) as OwnerQuestion;
    winnerOf.set(id, (carrier.get(q.questionId) as SupervisorBead).id);
  }
  const questions = new Map<string, AskedOwnerQuestion>();
  const heldBy = new Map<string, string[]>();
  const hold = (task: string, q: string) => {
    const list = heldBy.get(task) ?? [];
    if (!list.includes(q)) heldBy.set(task, [...list, q]);
  };
  for (const b of carrier.values()) {
    const q = ownerQuestionOf(b) as OwnerQuestion;
    // Walk from every carrier of this question id (a stale copy holds too).
    const starts = [...carriers].filter((id) => winnerOf.get(id) === b.id);
    const seen = new Set<string>(starts);
    const stack = starts.flatMap((id) => waitersOf.get(id) ?? []);
    const direct = new Set(stack);
    const waiters = new Set<string>();
    if (b.status === 'in_progress' && isOpenTask(b)) waiters.add(b.id);
    while (stack.length > 0) {
      const id = stack.pop() as string;
      if (seen.has(id)) continue;
      seen.add(id);
      const w = byId.get(id);
      if (w === undefined || w.status === 'closed') continue;
      if (isOpenTask(w)) waiters.add(id);
      stack.push(...(waitersOf.get(id) ?? []));
    }
    for (const id of waiters) if (id !== b.id) hold(id, b.id);
    // Opens at once: a direct waiter whose every open blocker is this question.
    const opensNow = [...direct].filter((id) => {
      const w = byId.get(id);
      if (w === undefined || !isOpenTask(w)) return false;
      return blockingIdsOf(w).every((x) => {
        const blocker = byId.get(x);
        return winnerOf.get(x) === b.id || blocker === undefined || blocker.status === 'closed';
      });
    }).length;
    questions.set(b.id, { ...q, holds: waiters.size, waiters, opensNow });
  }
  const asking = new Set([...byId.values()].filter(isAsking).map((b) => b.id));
  return { questions, carriers, heldBy, asking };
}
