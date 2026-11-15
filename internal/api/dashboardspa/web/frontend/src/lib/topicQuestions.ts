import type { PeerBoardsResult, TopicQuestion } from '../supervisor/peerBoardReads';
import { topicHref, topicNeedsOf, topicsForCard, type CardRef } from './peerTopics';

// BOARD-LIVE L10 / L7, owner Q-B: one owner question about a topic shows in
// three views — «Нужно от меня» (counted), the card drawer (ours and the
// peer's) and its Discord message. They all read the same list (the service's
// `owner_q.question_views`), so answering anywhere clears all three on the
// next boards read. Only `pending` questions show.

export interface PendingTopicQuestion {
  question: TopicQuestion;
  /** The topic view in the app, when the topic is on a peer board we read. */
  href: string | null;
}

/** Where a topic lives: the peer board that carries it. */
function boardOf(result: PeerBoardsResult, topicId: string | null): string | null {
  if (topicId === null) return null;
  for (const peer of result.peers) {
    if (peer.topics.some((tp) => tp.topicId === topicId)) return peer.login;
  }
  return null;
}

/**
 * Pending topic questions for «Нужно от меня». `ownQuestionIds` are question
 * ids our own board already lists (a bead with `needs/operator` and the same
 * `decision.question_id`): those are shown and counted once, there.
 */
export function pendingTopicQuestions(
  result: PeerBoardsResult | null,
  ownQuestionIds: ReadonlySet<string>,
): PendingTopicQuestion[] {
  if (result === null) return [];
  return result.ownerQuestions
    .filter((q) => q.status === 'pending' && !ownQuestionIds.has(q.questionId))
    .map((question) => {
      const login = boardOf(result, question.topicId);
      return { question, href: login === null || question.topicId === null ? null : topicHref(login, question.topicId) };
    });
}

/**
 * What the peer boards add to the «Нужно от меня» badge: every pending topic
 * question, plus every paused needs_human topic the owner was not asked
 * about yet. Once asked, the question is the one item; once answered, the
 * next step is the Mayor's, so the topic no longer counts.
 */
export function peerNeedsCount(
  result: PeerBoardsResult | null,
  ownQuestionIds: ReadonlySet<string>,
  nowMs: number,
): number {
  if (result === null) return 0;
  const asked = new Set(result.ownerQuestions.filter((q) => q.topicId !== null).map((q) => q.topicId));
  const paused = topicNeedsOf(result, nowMs).filter((n) => n.counts && !asked.has(n.topicId)).length;
  return paused + pendingTopicQuestions(result, ownQuestionIds).length;
}

/**
 * Pending questions for one card's drawer: a question naming this card (our
 * service sets `card` from the Mayor's `--bead`), or one about a topic linked
 * to this card (topicsForCard, on trusted keys only).
 */
export function questionsForCard(result: PeerBoardsResult | null, card: CardRef): TopicQuestion[] {
  if (result === null || card.city === null) return [];
  const topicIds = new Set(topicsForCard(result, card).map((ct) => ct.topic.topicId));
  return result.ownerQuestions.filter((q) => {
    if (q.status !== 'pending') return false;
    if (q.card !== null) {
      return card.mine && q.card.city === card.city && q.card.rig === card.rig && q.card.id === card.id;
    }
    return q.topicId !== null && topicIds.has(q.topicId);
  });
}
