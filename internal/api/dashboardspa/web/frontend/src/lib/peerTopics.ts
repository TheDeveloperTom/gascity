import type { AuthorKind, PeerBoardsResult, PeerTopic } from '../supervisor/peerBoardReads';

// vk-final part 4: Mayor-to-Mayor topics with a peer city (COMMENTS-PLAN
// Revision 2; coordinator 15.11). People watch and can step in. Pure helpers
// for the list, the thread and «Нужно от меня».

/** Resolved topics stay listed for 14 days (the export window). */
export const RESOLVED_WINDOW_MS = 14 * 86_400_000;
/** List previews use a message's `summary`, at most 80 characters. */
export const PREVIEW_MAX = 80;

export interface TopicSections {
  open: readonly PeerTopic[];
  /** `paused`: by the rails (needs_human, the Mayors did not agree) or by a person. */
  paused: readonly PeerTopic[];
  resolved: readonly PeerTopic[];
}

const at = (iso: string | null): number => {
  const ms = iso === null ? Number.NaN : Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
};

function lastActivity(topic: PeerTopic): number {
  const last = topic.messages.at(-1);
  return Math.max(at(topic.lastActivityAt), at(last?.createdAt ?? null), at(topic.openedAt));
}

const isClosed = (tp: PeerTopic) => tp.status === 'resolved' || tp.status === 'rejected';
const closedAt = (tp: PeerTopic) => at(tp.resolvedAt) || lastActivity(tp);

export function topicSections(topics: readonly PeerTopic[], nowMs: number): TopicSections {
  const byRecent = (a: PeerTopic, b: PeerTopic) => lastActivity(b) - lastActivity(a);
  const railsFirst = (a: PeerTopic, b: PeerTopic) =>
    Number(b.pausedReason === 'needs_human') - Number(a.pausedReason === 'needs_human') || byRecent(a, b);
  return {
    open: topics.filter((tp) => tp.status === 'open').sort(byRecent),
    // the rails' pause (a person is needed) before a person's own pause
    paused: topics.filter((tp) => tp.status === 'paused').sort(railsFirst),
    // resolved, and opens the peer refused (`rejected`), for 14 days
    resolved: topics
      .filter(isClosed)
      .filter((tp) => {
        const done = closedAt(tp);
        return done === 0 || nowMs - done <= RESOLVED_WINDOW_MS;
      })
      .sort((a, b) => closedAt(b) - closedAt(a)),
  };
}

export interface Waiting {
  /** Who owes the reply. */
  side: 'peer';
  /** What kind of author on our side wrote last (the reply is owed to them). */
  kind: AuthorKind;
  since: string;
}

/** «ждёт ответа от Мэра Ричарда с 18:40»: the last word is ours, the topic still open. */
export function waitingOn(topic: PeerTopic): Waiting | null {
  if (isClosed(topic)) return null;
  const last = topic.messages.at(-1);
  if (last === undefined || !last.mine) return null;
  return { side: 'peer', kind: last.author.kind === 'person' ? 'person' : 'mayor', since: last.createdAt };
}

/** The topic's newest messages from the other side, as many as `unread_count`. */
export function unreadIdsOf(topic: PeerTopic): ReadonlySet<string> {
  if (topic.unreadCount <= 0) return new Set();
  const theirs = topic.messages.filter((m) => !m.mine);
  return new Set(theirs.slice(-topic.unreadCount).map((m) => m.id));
}

export function previewOf(topic: PeerTopic): string {
  const unread = unreadIdsOf(topic);
  const pick = [...topic.messages].reverse().find((m) => unread.has(m.id)) ?? topic.messages.at(-1);
  const text = (pick?.summary ?? pick?.text ?? '').replace(/\s+/g, ' ').trim();
  return text.length <= PREVIEW_MAX ? text : `${text.slice(0, PREVIEW_MAX - 1)}…`;
}

export function topicHref(login: string, topicId: string): string {
  return `/beads?${new URLSearchParams({ topics: login, topic: topicId }).toString()}`;
}

export interface CardRef {
  /** His login for his card; null for my card (its city is mine, never a peer's). */
  peerLogin: string | null;
  rig: string;
  id: string;
}

export interface CardTopic {
  /** The peer the topic is with (whose panel opens it). */
  login: string;
  topic: PeerTopic;
}

/** The Mayor topics linked to one card (`topic.card`), newest activity first. */
export function topicsForCard(result: PeerBoardsResult | null, card: CardRef): CardTopic[] {
  if (result === null) return [];
  const peers = new Set(result.peers.map((p) => p.login));
  const out: CardTopic[] = [];
  for (const peer of result.peers) {
    for (const topic of peer.topics) {
      const ref = topic.card;
      if (ref === null || ref.rig !== card.rig || ref.id !== card.id) continue;
      const cityMatches = card.peerLogin === null ? !peers.has(ref.city) : ref.city === card.peerLogin;
      if (cityMatches) out.push({ login: peer.login, topic });
    }
  }
  return out.sort((a, b) => lastActivity(b.topic) - lastActivity(a.topic));
}

/**
 * Our own people.json login, learnt from the topics: a topic we opened has
 * `city` = us; a topic the peer opened has `peer` = us. Null until one exists
 * (the dashboard has no other source for it).
 */
export function ownLoginOf(result: PeerBoardsResult | null): string | null {
  for (const peer of result?.peers ?? []) {
    for (const topic of peer.topics) {
      if (topic.mine) return topic.city;
      if (topic.peerCity !== null) return topic.peerCity;
    }
  }
  return null;
}

export interface TopicNeed {
  key: string;
  login: string;
  topicId: string;
  title: string;
  preview: string;
  needsHuman: boolean;
  unread: number;
  /** A paused topic counts in the badge; an unread one is listed only. */
  counts: boolean;
  href: string;
}

/** «Нужно от меня»: every needs_human topic, then open topics with unread messages. */
export function topicNeedsOf(result: PeerBoardsResult | null, nowMs: number): TopicNeed[] {
  if (result === null) return [];
  const paused: TopicNeed[] = [];
  const unread: TopicNeed[] = [];
  for (const peer of result.peers) {
    const sections = topicSections(peer.topics, nowMs);
    const need = (tp: PeerTopic, needsHuman: boolean): TopicNeed => ({
      key: `${peer.login}:${tp.topicId}`,
      login: peer.login,
      topicId: tp.topicId,
      title: tp.title,
      preview: previewOf(tp),
      needsHuman,
      unread: tp.unreadCount,
      counts: needsHuman,
      href: topicHref(peer.login, tp.topicId),
    });
    // a person's own pause is a choice, not a need
    for (const tp of sections.paused) if (tp.pausedReason === 'needs_human') paused.push(need(tp, true));
    for (const tp of sections.open) if (tp.unreadCount > 0) unread.push(need(tp, false));
  }
  return [...paused, ...unread];
}
