// Seam (vk lane 0b). Owner: lane 3. Other lanes import, never edit.
import { useMemo } from 'react';
import type { BeadAttentionSession } from '../attention/beadsNeedingAttention';
import type { AttentionItem } from '../attention/compose';
import { useAttentionModel } from '../attention/context';
import { useBoardData } from '../hooks/useBoardData';
import { usePeerBoards } from '../hooks/usePeerBoards';
import { peerNeedsCount } from './topicQuestions';
import type { SupervisorBead } from '../supervisor/beadReads';
import { stuckItems } from './boardFacts';
import { ALL_PROJECTS, buildBoardModel, type BoardData, type RigPrefix } from './boardModel';
import { transitiveWaiters } from './holds';
import { ownerDebtOf } from './ownerQuestions';
import { milestoneOf } from './waitReasons';

// «Нужно от меня» (vk lane 3): one model for the page and for the red badge,
// so the two can never disagree. A need is an owner question by the one rule
// (ownerDebtOf: an open human gate with a posted question, the same rule as
// the graph's «От тебя»), or a «Застряло» item the Mayor does not know about
// (stuckItems, mayor !== 'knows'). Everything is read from the one board.

export interface MilestoneCount {
  milestone: string;
  count: number;
}

export interface NeedItem {
  /** question: the Mayor asks; ask: mail or an agent waits for the owner; stall: «Стоит». */
  kind: 'question' | 'ask' | 'stall';
  /** The bead id, or the stall key when the stall is not one card. */
  id: string;
  title: string;
  /** Question: decision.why. Stall: the «Застряло» reason. */
  summary: string | null;
  /** The Mayor's options, read-only on the list. */
  choices: readonly string[];
  /** How long it has waited: since decision.asked_at, or since the stall began. */
  waitedMs: number | null;
  /** Tasks that wait on it, directly or through others. */
  holds: number;
  breakdown: readonly MilestoneCount[];
  /** The in-app page that opens it; null for an ask that lives only in chat. */
  href: string | null;
  /** An ask's chat thread (https), when it has one. */
  externalHref?: string;
  /** A question's bridge id (`decision.question_id`): one question counts once. */
  questionId?: string;
  /**
   * A question: the «Стоит» items held behind it (they wait on it, directly or
   * not), folded under it instead of listed in «Стоит» (polish2 16.11).
   */
  heldStalls?: readonly StallItem[];
}

export interface StallItem extends NeedItem {
  kind: 'stall';
  /** Marked as waiting for the owner (`needs/operator` or a decision): it counts. */
  forOwner: boolean;
}

export interface QuietItem {
  id: string;
  title: string;
  href: string;
}

export interface NeedsModel {
  state: 'loading' | 'unavailable' | 'ready';
  /** The Mayor's questions, then owner asks: every one counts. */
  needs: readonly NeedItem[];
  /** «Стоит»: shown under the needs; only `forOwner` ones count. */
  stalls: readonly StallItem[];
  quiet: readonly QuietItem[];
  /** The badge number: needs + owner-marked stalls. */
  count: number;
}

/** The attention registry's id suffix for an owner question (mayorDecisionAttention). */
const MAYOR_DECISION_SUFFIX = ':mayor-decision';

const FILTERS = { project: ALL_PROJECTS, search: '', showTests: false } as const;

function beadHref(id: string): string {
  return `/beads?${new URLSearchParams({ bead: id }).toString()}`;
}

function parseMs(iso: string | null): number | null {
  if (iso === null) return null;
  const at = Date.parse(iso);
  return Number.isFinite(at) ? at : null;
}

function milestoneRank(milestone: string): number {
  const match = /(\d+)/.exec(milestone);
  return match === null ? Number.POSITIVE_INFINITY : Number(match[1]);
}

function holdsOf(
  id: string,
  waitersOf: ReadonlyMap<string, readonly string[]>,
  byId: ReadonlyMap<string, SupervisorBead>,
): Pick<NeedItem, 'holds' | 'breakdown'> {
  const waiters = transitiveWaiters(id, waitersOf);
  const counts = new Map<string, number>();
  for (const waiter of waiters) {
    const bead = byId.get(waiter);
    const milestone = bead === undefined ? null : milestoneOf(bead);
    if (milestone !== null) counts.set(milestone, (counts.get(milestone) ?? 0) + 1);
  }
  const breakdown = [...counts]
    .map(([milestone, count]) => ({ milestone, count }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        milestoneRank(a.milestone) - milestoneRank(b.milestone) ||
        a.milestone.localeCompare(b.milestone),
    );
  return { holds: waiters.length, breakdown };
}

export function needsFromBoard(
  data: BoardData | undefined,
  rigs: readonly RigPrefix[],
  sessions: readonly BeadAttentionSession[],
  nowMs: number,
  loading = true,
  ownerItems: readonly AttentionItem[] = [],
): NeedsModel {
  if (data === undefined) {
    // Owner questions arrive with the board: until then their attention
    // copies wait too, so a question never shows first as an ask.
    const asks = ownerAsks(
      ownerItems.filter((item) => !item.id.endsWith(MAYOR_DECISION_SUFFIX)),
      new Set(),
      nowMs,
    );
    return {
      state: loading ? 'loading' : 'unavailable',
      needs: asks,
      stalls: [],
      quiet: [],
      count: asks.length,
    };
  }
  const model = buildBoardModel(data, rigs, FILTERS);
  const everything = [...data.items, ...data.serviceItems];
  const byId = new Map(everything.map((bead) => [bead.id, bead]));

  const lookup = (id: string) => byId.get(id);
  // The one owner-debt rule (lib/ownerQuestions ownerDebtOf), the same the
  // graph's «От тебя» column draws: an open human gate with a posted question.
  const questions = everything
    .flatMap((bead) => {
      const q = ownerDebtOf(bead, lookup);
      return q === null ? [] : [q];
    })
    .map((q): NeedItem => {
      const askedMs = parseMs(q.askedAt);
      return {
        kind: 'question',
        id: q.beadId,
        title: q.question,
        summary: q.why,
        choices: q.choices.map((choice) => choice.label),
        waitedMs: askedMs === null ? null : Math.max(0, nowMs - askedMs),
        ...holdsOf(q.beadId, model.waitersOf, byId),
        href: beadHref(q.beadId),
        questionId: q.questionId,
      };
    })
    .sort((a, b) => (b.waitedMs ?? -1) - (a.waitedMs ?? -1));
  const questionIds = new Set(questions.map((q) => q.id));

  // «Стоит» (coordinator ruling 2): every stall the Mayor does not know about,
  // plus any stall marked as waiting for the owner. Only the marked ones
  // count. `mayorMentions: null`: Home reads no Mayor mail (V2).
  const stalls = stuckItems(model, { nowMs, sessions, mayorMentions: null })
    .filter((item) => item.cardId === null || !questionIds.has(item.cardId))
    .map((item): StallItem & { mayorKnows: boolean; unclaimedBlocker: boolean } => {
      const bead = item.cardId === null ? undefined : byId.get(item.cardId);
      return {
        kind: 'stall',
        id: item.cardId ?? item.key,
        title: item.title,
        summary: item.reason.text,
        choices: [],
        waitedMs: Math.max(0, nowMs - item.sinceMs),
        ...(item.cardId === null
          ? { holds: 0, breakdown: [] }
          : holdsOf(item.cardId, model.waitersOf, byId)),
        href: item.href,
        // Only the one owner-debt rule makes a stall the owner's; the
        // `needs/operator` label alone is display (DIAG 20.11, D5).
        forOwner: bead !== undefined && ownerDebtOf(bead, lookup) !== null,
        mayorKnows: item.mayor === 'knows',
        // stuckItems (c): «Никто не взял, а её ждёт …»
        unclaimedBlocker: item.key.startsWith('blocker:'),
      };
    })
    .filter((stall) => stall.forOwner || !stall.mayorKnows);
  // review I-2: only an unclaimed blocker («Никто не взял») can fold; its
  // cause is the question. Any other stall has its own cause.
  const foldable = new Set(stalls.filter((s) => s.unclaimedBlocker && !s.forOwner).map((s) => s.id));

  // polish2 16.11 (owner): a stall that waits on an owner question is already
  // explained by it («держит 22 задачи»); it folds under the closest question
  // (the one holding the fewest tasks) and leaves «Стоит». Only «Никто не
  // взял» blockers fold, and never one marked for the owner (review I-2): the
  // badge counts owner-marked stalls, so they must stay visible.
  const heldSets = questions.map((q) => ({ q, held: new Set(transitiveWaiters(q.id, model.waitersOf)) }));
  const folded = new Map<string, StallItem[]>();
  const openStalls: StallItem[] = [];
  for (const { mayorKnows: _known, unclaimedBlocker: _kind, ...stall } of stalls) {
    if (!foldable.has(stall.id)) {
      openStalls.push(stall);
      continue;
    }
    const owner = heldSets
      .filter(({ held }) => held.has(stall.id))
      .sort((a, b) => a.held.size - b.held.size)[0];
    if (owner === undefined) {
      openStalls.push(stall);
      continue;
    }
    const list = folded.get(owner.q.id) ?? [];
    list.push(stall);
    folded.set(owner.q.id, list);
  }
  const questionsWithHeld = questions.map((q) => {
    const held = folded.get(q.id);
    return held === undefined ? q : { ...q, heldStalls: held };
  });

  const needs = [...questionsWithHeld, ...ownerAsks(ownerItems, questionIds, nowMs)];
  const shown = new Set([...needs, ...stalls].map((n) => n.id));
  const quiet = model.columns.waiting
    .filter((card) => !shown.has(card.node.bead.id))
    .map((card) => ({
      id: card.node.bead.id,
      title: card.node.bead.title,
      href: beadHref(card.node.bead.id),
    }));
  return {
    state: 'ready',
    needs,
    stalls: openStalls,
    quiet,
    // owner-marked stalls never fold, so this is exactly what the page shows
    count: needs.length + openStalls.filter((s) => s.forOwner).length,
  };
}


/**
 * Owner asks from mail and agents (the owner-home plate's data: the
 * attention model's owner slice). The attention copy of a question the board
 * already lists is dropped; an unreadable source is never a need.
 */
function ownerAsks(
  items: readonly AttentionItem[],
  questionIds: ReadonlySet<string>,
  nowMs: number,
): NeedItem[] {
  return items
    .filter((item) => item.severity !== 'unavailable')
    .filter((item) => !(item.ref !== undefined && questionIds.has(item.ref)))
    .map((item): NeedItem => {
      const at = parseMs(item.updatedAt ?? null);
      return {
        kind: 'ask',
        id: item.id,
        title: item.title,
        summary: item.summary ?? null,
        choices: [],
        waitedMs: at === null ? null : Math.max(0, nowMs - at),
        holds: 0,
        breakdown: [],
        href: item.href ?? null,
        ...(item.externalHref === undefined ? {} : { externalHref: item.externalHref }),
      };
    });
}

/** The page's model: the one board read, recomputed when it changes. */
export function useNeedsModel(): NeedsModel {
  const read = useBoardData();
  const ownerItems = useAttentionModel().owner.items;
  const { data, rigs, sessions, loading } = read;
  return useMemo(
    () => needsFromBoard(data, rigs, sessions, Date.now(), loading, ownerItems),
    [data, rigs, sessions, loading, ownerItems],
  );
}

/** The bridge ids of the owner questions our own board already lists. */
export function ownQuestionIdsOf(model: NeedsModel): ReadonlySet<string> {
  return new Set(model.needs.flatMap((n) => (n.questionId === undefined ? [] : [n.questionId])));
}

/**
 * Count for the red «Нужно от меня» badge (top nav and phone tab). vk-final:
 * plus every paused Mayor topic («Мэры не договорились — нужен человек»);
 * BOARD-LIVE L7: plus every pending owner topic question, each once
 * (lib/topicQuestions peerNeedsCount). Peer cards never count (SYNC-PLAN
 * review focus 2).
 */
export function useNeedsFromMeCount(): number {
  const model = useNeedsModel();
  const { result } = usePeerBoards();
  const peer = useMemo(() => peerNeedsCount(result, ownQuestionIdsOf(model), Date.now()), [result, model]);
  return model.count + peer;
}
