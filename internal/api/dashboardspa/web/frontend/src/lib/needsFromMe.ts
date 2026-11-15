// Seam (vk lane 0b). Owner: lane 3. Other lanes import, never edit.
import { useMemo } from 'react';
import type { BeadAttentionSession } from '../attention/beadsNeedingAttention';
import { useBoardData } from '../hooks/useBoardData';
import type { SupervisorBead } from '../supervisor/beadReads';
import { stuckItems } from './boardFacts';
import { ALL_PROJECTS, buildBoardModel, type BoardData, type RigPrefix } from './boardModel';
import { transitiveWaiters } from './holds';
import { ownerQuestionOf } from './ownerQuestions';
import { milestoneOf } from './waitReasons';

// «Нужно от меня» (vk lane 3): one model for the page and for the red badge,
// so the two can never disagree. A need is a Mayor question with a Discord
// link (ownerQuestionOf), or a «Застряло» item the Mayor does not know about
// (stuckItems, mayor !== 'knows'). Everything is read from the one board.

export interface MilestoneCount {
  milestone: string;
  count: number;
}

export interface NeedItem {
  kind: 'question' | 'stall';
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
  href: string;
}

export interface QuietItem {
  id: string;
  title: string;
  href: string;
}

export interface NeedsModel {
  state: 'loading' | 'unavailable' | 'ready';
  needs: readonly NeedItem[];
  quiet: readonly QuietItem[];
}

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
): NeedsModel {
  if (data === undefined) {
    return { state: loading ? 'loading' : 'unavailable', needs: [], quiet: [] };
  }
  const model = buildBoardModel(data, rigs, FILTERS);
  const everything = [...data.items, ...data.serviceItems];
  const byId = new Map(everything.map((bead) => [bead.id, bead]));

  const questions = everything
    .flatMap((bead) => {
      const q = ownerQuestionOf(bead);
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
      };
    })
    .sort((a, b) => (b.waitedMs ?? -1) - (a.waitedMs ?? -1));
  const questionIds = new Set(questions.map((q) => q.id));

  // `mayorMentions: null`: Home reads no Mayor mail, so only a Mayor label
  // marks a stall as known (V2); an unknown stall stays the owner's to see.
  const stalls = stuckItems(model, { nowMs, sessions, mayorMentions: null })
    .filter((item) => item.mayor !== 'knows')
    .filter((item) => item.cardId === null || !questionIds.has(item.cardId))
    .map(
      (item): NeedItem => ({
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
      }),
    );

  const needs = [...questions, ...stalls];
  const needIds = new Set(needs.map((n) => n.id));
  const quiet = model.columns.waiting
    .filter((card) => !needIds.has(card.node.bead.id))
    .map((card) => ({
      id: card.node.bead.id,
      title: card.node.bead.title,
      href: beadHref(card.node.bead.id),
    }));
  return { state: 'ready', needs, quiet };
}

/** The page's model: the one board read, recomputed when it changes. */
export function useNeedsModel(): NeedsModel {
  const read = useBoardData();
  const { data, rigs, sessions, loading } = read;
  return useMemo(
    () => needsFromBoard(data, rigs, sessions, Date.now(), loading),
    [data, rigs, sessions, loading],
  );
}

/** Count for the red «Нужно от меня» badge (top nav and phone tab). */
export function useNeedsFromMeCount(): number {
  return useNeedsModel().needs.length;
}
