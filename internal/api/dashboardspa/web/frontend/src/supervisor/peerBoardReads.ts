import { z } from 'zod';
import { getActiveCity } from '../api/cityBase';
import { authHeaders, withApiBase } from '../lib/apiBase';
import type { SupervisorBead } from './beadReads';

// vk-final part 3 (SYNC-PLAN Task 5): the peers' boards, read-only, from the
// city-pack service `peer-boards` (`/v0/city/<city>/svc/peer-boards/v1/boards`,
// a sanctioned untyped /svc surface the pack process owns). The schema
// follows the service body (sync/b + sync/rigs 27457ed0) and stays loose:
// every object accepts fields the city adds later (changed_at, rig,
// heartbeat_seconds, stale_after_seconds, dropped_cards, board_schema, rigs,
// skipped_rigs, threads …). Only the fields the board reads are checked.

/** A `devwork.board/1` peer's cards have no `rig`; all of them come from devwork. */
export const PEER_DEFAULT_RIG = 'devwork';
/** Used when the service does not send `stale_after_seconds` (25 min). */
export const DEFAULT_STALE_AFTER_SECONDS = 1500;

// The city's own allowlists (common.py ID_RE, RIG_RE, login).
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const RIG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const LOGIN_RE = /^[A-Za-z0-9-]{1,39}$/;

const optString = z.string().nullish();

const CardSchema = z.looseObject({
  id: z.string().regex(ID_RE),
  title: z.string(),
  status: z.string(),
  issue_type: optString,
  priority: z.number().nullish(),
  labels: z.array(z.string()).nullish(),
  parent: optString,
  created_at: optString,
  updated_at: optString,
  closed_at: optString,
  description: optString,
  metadata: z.record(z.string(), z.string()).nullish(),
  needs: z.array(z.string()).nullish(),
  rig: z.string().regex(RIG_RE).nullish(),
});

const PeerSchema = z.looseObject({
  login: z.string().regex(LOGIN_RE),
  person: z.looseObject({ name: z.string(), genitive: z.string(), initial: z.string(), dative: optString }),
  city: optString,
  snapshot_at: z.string(),
  generated_at: optString,
  changed_at: optString,
  fetched_at: optString,
  fetch_error: optString,
  fetch_failed_at: optString,
  board_schema: optString,
  rigs: z.array(z.string()).nullish(),
  skipped_rigs: z.array(z.looseObject({ rig: z.string() })).nullish(),
  dropped_cards: z.number().nullish(),
  cards: z.array(CardSchema),
  // vk-final part 4 (COMMENTS-PLAN «Dashboard contract» + Revision 2): each
  // entry is checked on its own, so one malformed thread or topic is skipped
  // and never costs the board.
  threads: z.array(z.unknown()).nullish(),
  topics: z.array(z.unknown()).nullish(),
});

// ---- comments and topics (vk-final part 4) --------------------------------

const AuthorObject = z.looseObject({
  kind: z.string().nullish(),
  city: optString,
  name: z.string(),
  agent: optString,
  // owner 15.11: the author's Discord identity, the avatar cached and served
  // by OUR city service (same origin); see safeAvatarUrl.
  display_name: optString,
  avatar_url: optString,
});

// Only a root-relative path into our own peer-boards service's avatar cache:
// `/v0/city/<city>/svc/peer-boards/v1/avatars/<id>.<png|webp|jpg|gif>`. Any
// other origin (Discord's own image host included) or a climbing path is dropped,
// so the board never loads a third-party image (and works in the Activity
// with no extra CSP).
const AVATAR_PATH_RE =
  /^\/v0\/city\/[A-Za-z0-9._-]+\/svc\/peer-boards\/v1\/avatars\/[A-Za-z0-9_-]{1,80}\.(?:png|webp|jpg|jpeg|gif)$/;

function safeAvatarUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string' || !AVATAR_PATH_RE.test(raw)) return null;
  return raw;
}

const CommentSchema = z.looseObject({
  id: z.string().min(1),
  mine: z.boolean().nullish(),
  // Revision 1 sent the name only; Revision 2 sends {kind, city, name, agent?}.
  author: z.union([z.string(), AuthorObject]),
  text: z.string(),
  summary: optString,
  created_at: z.string(),
  state: optString,
  reason: optString,
  reopened: z.boolean().nullish(),
});

const ThreadSchema = z.looseObject({
  rig: z.string().regex(RIG_RE).nullish(),
  card: z.string().regex(ID_RE),
  comments: z.array(z.unknown()),
});

const ResolutionSchema = z.looseObject({
  reason: z.string(),
  by: z.union([z.string(), AuthorObject]).nullish(),
  at: optString,
  deciding_message_id: optString,
  summary: optString,
});

const ReactionSchema = z.looseObject({
  message_id: z.string(),
  kind: z.string(),
  by: z.union([z.string(), AuthorObject]).nullish(),
  at: optString,
});

// The city's final dashboard contract (topics-report.md): status is
// open|paused|resolved|rejected with paused_reason needs_human|human; `mine`
// marks topics and messages written in this city.
const TopicSchema = z.looseObject({
  topic_id: z.string().min(1),
  city: optString,
  peer: optString,
  mine: z.boolean().nullish(),
  title: z.string(),
  status: z.string(),
  paused_reason: optString,
  last_activity_at: optString,
  // owner 15.11: a card conversation is a topic linked to that card
  card: z.looseObject({ city: z.string(), rig: z.string(), id: z.string() }).nullish(),
  opened_by: z.union([z.string(), AuthorObject]).nullish(),
  opened_at: optString,
  resolution: ResolutionSchema.nullish(),
  resolved_at: optString,
  ticket: optString,
  messages: z.array(z.unknown()).nullish(),
  reactions: z.array(z.unknown()).nullish(),
  unread_count: z.number().nullish(),
});

export type AuthorKind = 'person' | 'mayor' | 'agent';

export interface CommentAuthor {
  kind: AuthorKind;
  /** The author's city (a people.json login); null when the service did not say. */
  city: string | null;
  name: string;
  agent: string | null;
  /** The Discord display name, when the city supplies it. */
  displayName: string | null;
  /** Same-origin path to the cached Discord avatar, when the city supplies it. */
  avatarUrl: string | null;
}

export type CommentState = 'queued' | 'queued_local' | 'delivered' | 'rejected';

export interface PeerComment {
  id: string;
  /** Written in this city (our outbox; `state` is ours). */
  mine: boolean;
  author: CommentAuthor;
  text: string;
  /** ≤ 80 characters, for list previews (topics). */
  summary: string | null;
  createdAt: string;
  state: CommentState | null;
  reason: string | null;
  reopened: boolean;
}

export interface PeerThread {
  rig: string;
  card: string;
  comments: readonly PeerComment[];
}

export interface TopicResolution {
  reason: string;
  by: CommentAuthor | null;
  at: string | null;
  decidingMessageId: string | null;
  summary: string | null;
}

export interface TopicReaction {
  messageId: string;
  kind: string;
  by: CommentAuthor | null;
}

export type TopicStatus = 'open' | 'paused' | 'resolved' | 'rejected';
/** Why a topic is paused: the rails (6 Mayor messages in a row) or a person. */
export type PausedReason = 'needs_human' | 'human';

export interface PeerTopic {
  topicId: string;
  /** The city that owns the topic (its opener's login). */
  city: string;
  /** Opened in this city. */
  mine: boolean;
  /** The other city of the topic (`peer`: on his topics, that is us). */
  peerCity: string | null;
  title: string;
  pausedReason: PausedReason | null;
  lastActivityAt: string | null;
  /** The card this topic is about: `{city: login, rig, id}`; null for a general topic. */
  card: { city: string; rig: string; id: string } | null;
  status: TopicStatus;
  openedBy: CommentAuthor | null;
  openedAt: string | null;
  resolution: TopicResolution | null;
  resolvedAt: string | null;
  ticket: string | null;
  messages: readonly PeerComment[];
  reactions: readonly TopicReaction[];
  unreadCount: number;
}

const STATES: ReadonlySet<string> = new Set(['queued', 'queued_local', 'delivered', 'rejected']);

function toAuthor(raw: string | z.infer<typeof AuthorObject>, fallbackCity: string | null): CommentAuthor {
  if (typeof raw === 'string') {
    return { kind: 'person', city: fallbackCity, name: raw, agent: null, displayName: null, avatarUrl: null };
  }
  const kind: AuthorKind = raw.kind === 'mayor' || raw.kind === 'agent' ? raw.kind : 'person';
  const displayName = raw.display_name?.trim() ?? '';
  return {
    kind,
    city: raw.city ?? fallbackCity,
    name: raw.name,
    agent: raw.agent ?? null,
    displayName: displayName.length > 0 ? displayName : null,
    avatarUrl: safeAvatarUrl(raw.avatar_url),
  };
}

function toComments(raw: readonly unknown[], peerLogin: string): PeerComment[] {
  const out: PeerComment[] = [];
  for (const entry of raw) {
    const parsed = CommentSchema.safeParse(entry);
    if (!parsed.success) continue;
    const c = parsed.data;
    const mine = c.mine ?? false;
    const author = toAuthor(c.author, mine ? null : peerLogin);
    out.push({
      id: c.id,
      mine: c.mine ?? (author.city !== null && author.city !== peerLogin),
      author,
      text: c.text,
      summary: c.summary ?? null,
      createdAt: c.created_at,
      state: c.state != null && STATES.has(c.state) ? (c.state as CommentState) : null,
      reason: c.reason ?? null,
      reopened: c.reopened ?? false,
    });
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

function toThreads(raw: readonly unknown[] | null | undefined, peerLogin: string): PeerThread[] {
  const out: PeerThread[] = [];
  for (const entry of raw ?? []) {
    const parsed = ThreadSchema.safeParse(entry);
    if (!parsed.success) continue;
    out.push({
      rig: parsed.data.rig ?? PEER_DEFAULT_RIG,
      card: parsed.data.card,
      comments: toComments(parsed.data.comments, peerLogin),
    });
  }
  return out;
}

function toTopics(raw: readonly unknown[] | null | undefined, peerLogin: string): PeerTopic[] {
  const out: PeerTopic[] = [];
  for (const entry of raw ?? []) {
    const parsed = TopicSchema.safeParse(entry);
    if (!parsed.success) continue;
    const tp = parsed.data;
    // Revision 2 drafts said `status: needs_human`; the final contract says
    // `status: paused` + `paused_reason`. Both read the same.
    const status: TopicStatus =
      tp.status === 'paused' || tp.status === 'needs_human'
        ? 'paused'
        : tp.status === 'resolved' || tp.status === 'rejected'
          ? tp.status
          : 'open';
    const pausedReason: PausedReason | null =
      status !== 'paused'
        ? null
        : tp.status === 'needs_human' || tp.paused_reason === 'needs_human'
          ? 'needs_human'
          : 'human';
    const reactions: TopicReaction[] = [];
    for (const r of tp.reactions ?? []) {
      const pr = ReactionSchema.safeParse(r);
      if (!pr.success) continue;
      reactions.push({
        messageId: pr.data.message_id,
        kind: pr.data.kind,
        by: pr.data.by == null ? null : toAuthor(pr.data.by, null),
      });
    }
    const res = tp.resolution;
    out.push({
      topicId: tp.topic_id,
      city: tp.city ?? peerLogin,
      mine: tp.mine ?? (tp.city != null && tp.city !== peerLogin),
      peerCity: tp.peer ?? null,
      title: tp.title,
      status,
      pausedReason,
      lastActivityAt: tp.last_activity_at ?? null,
      card: tp.card == null ? null : { city: tp.card.city, rig: tp.card.rig, id: tp.card.id },
      openedBy: tp.opened_by == null ? null : toAuthor(tp.opened_by, null),
      openedAt: tp.opened_at ?? null,
      resolution:
        res == null
          ? null
          : {
              reason: res.reason,
              by: res.by == null ? null : toAuthor(res.by, null),
              at: res.at ?? null,
              decidingMessageId: res.deciding_message_id ?? null,
              summary: res.summary ?? null,
            },
      resolvedAt: tp.resolved_at ?? res?.at ?? null,
      ticket: tp.ticket ?? null,
      messages: toComments(tp.messages ?? [], peerLogin),
      reactions,
      unreadCount: Math.max(0, Math.floor(tp.unread_count ?? 0)),
    });
  }
  return out;
}

const ResponseSchema = z.looseObject({
  schema: optString,
  heartbeat_seconds: z.number().nullish(),
  stale_after_seconds: z.number().positive().nullish(),
  // our own people.json login, from OUR city service (trusted; never taken
  // from peer-supplied topics) — security scan 15.11
  own_login: optString,
  peers: z.array(PeerSchema),
});

export interface PeerCard {
  rig: string;
  bead: SupervisorBead;
}

export interface PeerBoard {
  login: string;
  person: { name: string; genitive: string; initial: string; dative: string | null };
  city: string | null;
  /** The snapshot's time: `generated_at`, else `snapshot_at`. */
  asOf: string;
  rigs: readonly string[] | null;
  fetchError: string | null;
  cards: readonly PeerCard[];
  /** Card comment threads, one per (rig, card) (vk-final part 4). */
  threads: readonly PeerThread[];
  /** Mayor-to-Mayor topics with this peer (COMMENTS-PLAN Revision 2). */
  topics: readonly PeerTopic[];
}

export interface PeerBoardsResult {
  peers: readonly PeerBoard[];
  /** Our own login as our city service states it (`own_login`); null until it does. */
  ownLogin: string | null;
  heartbeatSeconds: number | null;
  staleAfterSeconds: number;
}

export class PeerBoardsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PeerBoardsError';
  }
}

const EMPTY: PeerBoardsResult = {
  peers: [],
  ownLogin: null,
  heartbeatSeconds: null,
  staleAfterSeconds: DEFAULT_STALE_AFTER_SECONDS,
};

function toBead(card: z.infer<typeof CardSchema>, fallbackCreated: string): SupervisorBead {
  const bead: SupervisorBead = {
    id: card.id,
    title: card.title,
    status: card.status,
    issue_type: card.issue_type ?? 'task',
    created_at: card.created_at ?? fallbackCreated,
  };
  if (card.priority != null) bead.priority = card.priority;
  if (card.labels != null) bead.labels = card.labels;
  if (card.parent != null && card.parent !== '') bead.parent = card.parent;
  if (card.updated_at != null) bead.updated_at = card.updated_at;
  if (card.description != null) bead.description = card.description;
  if (card.metadata != null) bead.metadata = card.metadata;
  if (card.needs != null) bead.needs = card.needs;
  return bead;
}

export function peerBoardsUrl(city: string): string {
  return `/v0/city/${encodeURIComponent(city)}/svc/peer-boards/v1/boards`;
}

/** Parses a `/v1/boards` body; throws PeerBoardsError when it is not the contract. */
export function parsePeerBoards(body: unknown): PeerBoardsResult {
  const parsed = ResponseSchema.safeParse(body);
  if (!parsed.success) throw new PeerBoardsError(`peer-boards: ${parsed.error.issues[0]?.message ?? 'bad body'}`);
  const res = parsed.data;
  return {
    ownLogin: res.own_login != null && LOGIN_RE.test(res.own_login) ? res.own_login : null,
    heartbeatSeconds: res.heartbeat_seconds ?? null,
    staleAfterSeconds: res.stale_after_seconds ?? DEFAULT_STALE_AFTER_SECONDS,
    peers: res.peers.map((p) => {
      const asOf = p.generated_at ?? p.snapshot_at;
      return {
        login: p.login,
        person: { name: p.person.name, genitive: p.person.genitive, initial: p.person.initial, dative: p.person.dative ?? null },
        city: p.city ?? null,
        asOf,
        rigs: p.rigs ?? null,
        fetchError: p.fetch_error ?? null,
        cards: p.cards.map((c) => ({ rig: c.rig ?? PEER_DEFAULT_RIG, bead: toBead(c, asOf) })),
        threads: toThreads(p.threads, p.login),
        topics: toTopics(p.topics, p.login),
      };
    }),
  };
}

/** The peers' boards. 404/503 (the service is not running) is no peers. */
export async function listPeerBoards(signal?: AbortSignal): Promise<PeerBoardsResult> {
  const city = getActiveCity();
  if (city === null) return EMPTY;
  const res = await fetch(withApiBase(peerBoardsUrl(city)), {
    method: 'GET',
    headers: { ...authHeaders(), Accept: 'application/json' },
    ...(signal ? { signal } : {}),
  });
  if (res.status === 404 || res.status === 503) return EMPTY;
  if (!res.ok) throw new PeerBoardsError(`peer-boards: HTTP ${res.status}`);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new PeerBoardsError('peer-boards: not JSON');
  }
  return parsePeerBoards(body);
}
