import { z } from 'zod';
import { getActiveCity } from '../api/cityBase';
import { withApiBase } from '../lib/apiBase';
import { discordChannelOrNull } from '../lib/mayorLink';
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
  // BOARD-LIVE C4/C5: the live block (checked on its own; malformed = null)
  // and the peer's people rows (PeopleEntry without b64, plus avatar_url).
  live: z.unknown().nullish(),
  people: z.array(z.unknown()).nullish(),
});

// ---- BOARD-LIVE: the live block (C4) and people (C5) ----------------------

const ISO = z.string().min(1).nullish();

const LiveSchema = z.looseObject({
  version: z.number().nullish(),
  as_of: ISO,
  connection: z.looseObject({
    state: z.enum(['live', 'reconnecting', 'offline']),
    since: ISO,
    error: optString,
  }),
  peer_online: z.boolean().nullish(),
  peer_last_seen: ISO,
  error: optString,
});

export type LiveState = 'live' | 'reconnecting' | 'offline';

/** One peer's live connection, as OUR client wrote it (C4 `peers/<login>.json` `live`). */
export interface PeerLive {
  version: number | null;
  /** The frame's `as_of` (the peer's clock: a label only, never for staleness). */
  asOf: string | null;
  state: LiveState;
  /** Since when, on our clock. */
  since: string | null;
  /** `auth` when the peer refused our pair token. */
  error: string | null;
  /** Tailscale's view of the peer node; null when unknown. */
  peerOnline: boolean | null;
  /** Tailscale `LastSeen` of the peer node (our tailnet's clock). */
  peerLastSeen: string | null;
}

function toLive(raw: unknown): PeerLive | null {
  const parsed = LiveSchema.safeParse(raw);
  if (!parsed.success) return null;
  const l = parsed.data;
  return {
    version: l.version ?? null,
    asOf: l.as_of ?? null,
    state: l.connection.state,
    since: l.connection.since ?? null,
    error: l.connection.error ?? l.error ?? null,
    peerOnline: l.peer_online ?? null,
    peerLastSeen: l.peer_last_seen ?? null,
  };
}

const PersonEntrySchema = z.looseObject({
  login: z.string().regex(LOGIN_RE),
  who: z.enum(['person', 'mayor']),
  display_name: optString,
  role_caption: optString,
  avatar_url: optString,
});

/** A peer's person or Mayor (BOARD-LIVE L5 PeopleEntry, as our service passes it on). */
export interface PeerPerson {
  login: string;
  who: 'person' | 'mayor';
  displayName: string | null;
  roleCaption: string | null;
  avatarUrl: string | null;
}

function toPeople(raw: readonly unknown[] | null | undefined): PeerPerson[] {
  const out: PeerPerson[] = [];
  for (const entry of raw ?? []) {
    const parsed = PersonEntrySchema.safeParse(entry);
    if (!parsed.success) continue;
    const p = parsed.data;
    out.push({
      login: p.login,
      who: p.who,
      displayName: nonEmpty(p.display_name),
      roleCaption: nonEmpty(p.role_caption),
      avatarUrl: safeAvatarUrl(p.avatar_url),
    });
  }
  return out;
}

function nonEmpty(raw: string | null | undefined): string | null {
  const v = raw?.trim() ?? '';
  return v.length > 0 ? v : null;
}

// ---- BOARD-LIVE L10: the owner's plain topic questions --------------------

const QID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DISCORD_HOSTS: ReadonlySet<string> = new Set(['discord.com', 'discordapp.com']);
/** owner_q.TOPIC_OPTIONS: the command fixes these four, in this order. */
export const TOPIC_OPTIONS: readonly string[] = ['Да', 'Нет', 'Обсудить', 'Сделать задачей'];
const QUESTION_LINES = 2;
const QUESTION_LINE_MAX = 160;
/** U+2028 / U+2029 end a line too (the city's cleaner turns them into lines). */
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

const CardRefSchema = z.looseObject({
  city: z.string().regex(LOGIN_RE),
  rig: z.string().regex(RIG_RE),
  id: z.string().regex(ID_RE),
});

const QuestionSchema = z.looseObject({
  question_id: z.string().regex(QID_RE),
  text: z.string(),
  options: z.array(z.string()).nullish(),
  status: z.enum(['pending', 'answered']),
  answer: optString,
  topic: optString,
  card: z.unknown().nullish(),
  jump_url: optString,
});

/** One owner question about a topic (L10 `owner_q.question_views`; from OUR city service). */
export interface TopicQuestion {
  questionId: string;
  /** The plain question: one or two lines, nothing else (owner Q-B). */
  lines: readonly string[];
  /** The answer buttons, in order (TOPIC_OPTIONS). */
  options: readonly string[];
  status: 'pending' | 'answered';
  answer: string | null;
  /** The topic id (`tp-…`) the question is about; null when not said. */
  topicId: string | null;
  /** Our card the question is about (`owner ask --bead`); null otherwise. */
  card: { city: string; rig: string; id: string } | null;
  /** The question's Discord message (https Discord only). */
  jumpUrl: string | null;
}

function discordJumpUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '') return null;
    return DISCORD_HOSTS.has(url.hostname) ? url.href : null;
  } catch {
    return null;
  }
}

function toQuestion(raw: unknown): TopicQuestion | null {
  const parsed = QuestionSchema.safeParse(raw);
  if (!parsed.success) return null;
  const q = parsed.data;
  const lines = q.text
    .split(/\r\n|[\n\r]/)
    .flatMap((line) => line.split(LINE_SEPARATOR))
    .flatMap((line) => line.split(PARAGRAPH_SEPARATOR))
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, QUESTION_LINES)
    .map((line) => ([...line].length <= QUESTION_LINE_MAX ? line : `${[...line].slice(0, QUESTION_LINE_MAX - 1).join('')}…`));
  if (lines.length === 0) return null;
  const options = q.options ?? [];
  const sameOptions = options.length === TOPIC_OPTIONS.length && options.every((o, i) => o === TOPIC_OPTIONS[i]);
  const topicRef = q.topic?.trim() ?? '';
  const topicId = topicRef.length > 0 ? (topicRef.split('/').at(-1) ?? null) : null;
  const card = CardRefSchema.safeParse(q.card);
  return {
    questionId: q.question_id,
    lines,
    options: sameOptions ? options : TOPIC_OPTIONS,
    status: q.status,
    answer: q.answer ?? null,
    topicId: topicId !== null && ID_RE.test(topicId) ? topicId : null,
    card: card.success ? { city: card.data.city, rig: card.data.rig, id: card.data.id } : null,
    jumpUrl: discordJumpUrl(q.jump_url),
  };
}

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
  // BOARD-LIVE L5: «Мэр Артёма» (= «Мэр » + genitive), built by OUR city from
  // OUR people.json; for a person it is the person's name.
  role_caption: optString,
});

// Only a root-relative path into our own peer-boards service's avatar cache:
// `/v0/city/<city>/svc/peer-boards/v1/avatars/<id>.<png|webp|jpg|gif>`. Any
// other origin (Discord's own image host included) or a climbing path is dropped,
// so the board never loads a third-party image (and needs no extra CSP).
// Review M-2: the city segment is pinned to the ACTIVE city, so neither `..`
// nor another city's service passes.
const AVATAR_FILE_RE = /^[A-Za-z0-9_-]{1,80}\.(?:png|webp|jpg|jpeg|gif)$/;

function safeAvatarUrl(raw: string | null | undefined): string | null {
  const city = getActiveCity();
  if (typeof raw !== 'string' || city === null) return null;
  const prefix = `/v0/city/${encodeURIComponent(city)}/svc/peer-boards/v1/avatars/`;
  if (!raw.startsWith(prefix)) return null;
  return AVATAR_FILE_RE.test(raw.slice(prefix.length)) ? raw : null;
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
  // BOARD-LIVE C5: our own queued message while the peer's Mac is offline
  undelivered: optString,
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
  // BOARD-LIVE C5 / L11: where the Mayor linked the ticket
  ticket_ref: z.unknown().nullish(),
  // BOARD-LIVE L10: the owner's plain question on this topic (our service)
  owner_question: z.unknown().nullish(),
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
  /** «Мэр Артёма» / the person's name, from OUR city's people.json (L5). */
  roleCaption: string | null;
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
  /** Ours, still queued because the peer's Mac is offline (BOARD-LIVE C5). */
  undelivered: 'peer_offline' | null;
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
  /** The linked ticket's bead id; only a valid bead id is kept (review N-1). */
  ticket: string | null;
  /** Where that ticket lives (`{city, rig, id}`), when the city says. */
  ticketRef: { city: string; rig: string; id: string } | null;
  /** The owner's plain question on this topic (L10), from our city service. */
  ownerQuestion: TopicQuestion | null;
  messages: readonly PeerComment[];
  reactions: readonly TopicReaction[];
  unreadCount: number;
}

const STATES: ReadonlySet<string> = new Set(['queued', 'queued_local', 'delivered', 'rejected']);

function toAuthor(raw: string | z.infer<typeof AuthorObject>, fallbackCity: string | null): CommentAuthor {
  if (typeof raw === 'string') {
    return {
      kind: 'person',
      city: fallbackCity,
      name: raw,
      agent: null,
      displayName: null,
      avatarUrl: null,
      roleCaption: null,
    };
  }
  const kind: AuthorKind = raw.kind === 'mayor' || raw.kind === 'agent' ? raw.kind : 'person';
  return {
    kind,
    city: raw.city ?? fallbackCity,
    name: raw.name,
    agent: raw.agent ?? null,
    displayName: nonEmpty(raw.display_name),
    avatarUrl: safeAvatarUrl(raw.avatar_url),
    roleCaption: nonEmpty(raw.role_caption),
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
      // our service always sends `mine`; absent is not ours (review M-4: no fail-open guess)
      mine,
      author,
      text: c.text,
      summary: c.summary ?? null,
      createdAt: c.created_at,
      state: c.state != null && STATES.has(c.state) ? (c.state as CommentState) : null,
      reason: c.reason ?? null,
      reopened: c.reopened ?? false,
      // only ours can be undelivered
      undelivered: mine && c.undelivered === 'peer_offline' ? 'peer_offline' : null,
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

function ticketRefOf(raw: unknown): { city: string; rig: string; id: string } | null {
  const parsed = CardRefSchema.safeParse(raw);
  return parsed.success ? { city: parsed.data.city, rig: parsed.data.rig, id: parsed.data.id } : null;
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
      mine: tp.mine === true,
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
      ticket: tp.ticket != null && ID_RE.test(tp.ticket) ? tp.ticket : null,
      ticketRef: ticketRefOf(tp.ticket_ref),
      ownerQuestion: toQuestion(tp.owner_question),
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
  // owner 16.11: our owner's Mayor channel (#мэр), from OUR city service
  mayor_url: optString,
  // BOARD-LIVE L10/L12: every owner topic question (owner_q.question_views)
  owner_questions: z.array(z.unknown()).nullish(),
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
  /** When OUR client last received this board (our clock). */
  fetchedAt: string | null;
  /** The live connection (BOARD-LIVE C4); null for a peer not yet upgraded. */
  live: PeerLive | null;
  /** The peer's person and Mayor (BOARD-LIVE L5). */
  people: readonly PeerPerson[];
}

export interface PeerBoardsResult {
  peers: readonly PeerBoard[];
  /** The owner's topic questions, one per question id (top-level and per topic). */
  ownerQuestions: readonly TopicQuestion[];
  /** Our owner's Mayor channel in Discord (a channel URL), when the city sends it. */
  mayorUrl: string | null;
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
  ownerQuestions: [],
  mayorUrl: null,
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
  const peers: PeerBoard[] = res.peers.map((p) => {
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
        fetchedAt: p.fetched_at ?? null,
        live: toLive(p.live),
        people: toPeople(p.people),
      };
  });
  return {
    ownerQuestions: mergeQuestions(res.owner_questions, peers),
    mayorUrl: discordChannelOrNull(res.mayor_url),
    ownLogin: ownLoginFrom(res.own_login, peers),
    heartbeatSeconds: res.heartbeat_seconds ?? null,
    staleAfterSeconds: res.stale_after_seconds ?? DEFAULT_STALE_AFTER_SECONDS,
    peers,
  };
}

/**
 * Every owner question once (by question id): the service's top-level list
 * first, then each topic's own `owner_question` (which also names its topic).
 */
function mergeQuestions(raw: readonly unknown[] | null | undefined, peers: readonly PeerBoard[]): TopicQuestion[] {
  const byId = new Map<string, TopicQuestion>();
  for (const entry of raw ?? []) {
    const q = toQuestion(entry);
    if (q !== null && !byId.has(q.questionId)) byId.set(q.questionId, q);
  }
  for (const peer of peers) {
    for (const topic of peer.topics) {
      const q = topic.ownerQuestion;
      if (q === null || byId.has(q.questionId)) continue;
      byId.set(q.questionId, q.topicId === null ? { ...q, topicId: topic.topicId } : q);
    }
  }
  return [...byId.values()];
}

/**
 * Our own login (review I-1). First `own_login`, which our city service sets.
 * Until the city sends it: the city of a topic OUR service marks `mine: true`
 * (it opened in our city, so its `city` is us). Never anything a peer wrote:
 * not `peer`, not an author, not a card.
 */
function ownLoginFrom(raw: string | null | undefined, peers: readonly PeerBoard[]): string | null {
  if (raw != null && LOGIN_RE.test(raw)) return raw;
  for (const peer of peers) {
    for (const topic of peer.topics) {
      if (topic.mine && LOGIN_RE.test(topic.city) && topic.city !== peer.login) return topic.city;
    }
  }
  return null;
}

/** The peers' boards. 404/503 (the service is not running) is no peers. */
export async function listPeerBoards(signal?: AbortSignal): Promise<PeerBoardsResult> {
  const city = getActiveCity();
  if (city === null) return EMPTY;
  const res = await fetch(withApiBase(peerBoardsUrl(city)), {
    method: 'GET',
    headers: { Accept: 'application/json' },
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
