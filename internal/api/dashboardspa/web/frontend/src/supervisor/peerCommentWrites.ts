import { getActiveCity } from '../api/cityBase';
import { fetchWithSessionRetry } from '../embed/activitySession';
import { t } from '../i18n';
import { authHeaders, withApiBase } from '../lib/apiBase';

// vk-final part 4: a person's writes to the other city. They go through our
// own city service `peer-boards` with `X-GC-Request: 1` (the engine refuses a
// /svc mutation without it); the service also checks a loopback Origin and
// `Sec-Fetch-Site: same-origin`, which the browser sends itself. The
// dashboard always writes as our person. Inside the Activity the same routes
// are used with the session headers (the gateway must pass them).
//
// The ONLY person routes (sync/topics c664ac8f, topics-report.md «Final
// dashboard contract»; all POST, body ≤ 16 KiB, `{"error": code}` on refusal):
//   `/v1/topics/card-message` {card:{city,rig,id}, text, to?} → 201 {topic, message, opened}
//   `/v1/topics/message` {city, topic_id, text}
//   `/v1/topics/continue` {city, topic_id}
//   `/v1/topics/resolve` {city, topic_id, reason, summary, deciding_message_id?}
//   `/v1/topics/read` {city, topic_id, at}
// People do not open, react to, pause or reopen topics (those routes are gone).

export type CommentErrorCode =
  | 'empty'
  | 'bad_request'
  | 'own_card'
  | 'unknown_peer'
  | 'card_not_found'
  | 'rate_limited'
  | 'outbox_full'
  // topics
  | 'bad_card'
  | 'bad_reason'
  | 'too_long'
  | 'ack_only'
  | 'not_allowed'
  | 'not_found'
  | 'bad_state'
  | 'resolved'
  | 'needs_human'
  | 'duplicate'
  | 'topic_cap'
  | 'too_soon'
  | 'topic_full'
  | 'own_login_unknown'
  | 'people_unreadable'
  | 'disabled'
  | 'failed';

export class CommentWriteError extends Error {
  constructor(public readonly code: CommentErrorCode) {
    super(`peer comment: ${code}`);
    this.name = 'CommentWriteError';
  }
}

const KNOWN: ReadonlySet<string> = new Set<CommentErrorCode>([
  'bad_request',
  'own_card',
  'unknown_peer',
  'card_not_found',
  'rate_limited',
  'outbox_full',
  'bad_card',
  'bad_reason',
  'too_long',
  'ack_only',
  'not_allowed',
  'not_found',
  'bad_state',
  'resolved',
  'needs_human',
  'duplicate',
  'topic_cap',
  'too_soon',
  'topic_full',
  'own_login_unknown',
  'people_unreadable',
]);

export interface TopicTarget {
  /** The city that owns the topic (`topic.city`). */
  city: string;
  topicId: string;
}

export type ResolutionReason = 'resolved' | 'outdated' | 'duplicate';

export type TopicAction =
  | { action: 'message'; text: string }
  | { action: 'resolve'; reason: ResolutionReason; summary: string; decidingMessageId?: string }
  | { action: 'continue' };

function serviceUrl(route: string): string {
  const city = getActiveCity();
  if (city === null) throw new CommentWriteError('failed');
  return withApiBase(`/v0/city/${encodeURIComponent(city)}/svc/peer-boards/v1/${route}`);
}

async function post(route: string, body: unknown): Promise<unknown> {
  const url = serviceUrl(route);
  const requestBody = JSON.stringify(body);
  // review M-11: inside the Activity a 401 session_invalid re-signs in once and
  // retries; the headers are read afresh on each try.
  const res = await fetchWithSessionRetry(() =>
    fetch(url, {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'X-GC-Request': '1',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      credentials: 'same-origin',
      body: requestBody,
    }),
  );
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  if (res.ok) return payload;
  const code =
    typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>).error : undefined;
  if (typeof code === 'string' && KNOWN.has(code)) throw new CommentWriteError(code as CommentErrorCode);
  // 403 `forbidden` (headers) or 405 (write-auth on): writes are switched off here
  if (res.status === 403 || res.status === 405) throw new CommentWriteError('disabled');
  if (res.status === 429) throw new CommentWriteError('rate_limited');
  if (res.status === 404) throw new CommentWriteError('not_found');
  throw new CommentWriteError('failed');
}

function clean(text: string): string {
  const out = text.trim();
  if (out.length === 0) throw new CommentWriteError('empty');
  return out;
}

export interface CardRefBody {
  /** The card's city (its owner's people.json login). */
  city: string;
  rig: string;
  id: string;
}

/**
 * The comment box under any card (owner 15.11): one call; the city posts into
 * the card's open or paused topic with that peer, or opens a topic linked to
 * the card (`opened`). `to` picks the peer for OUR card when there are
 * several (the city defaults it for a peer card, and for our card with one peer).
 */
export async function postCardMessage(card: CardRefBody, text: string, to?: string): Promise<{ opened: boolean }> {
  const payload = await post('topics/card-message', {
    card: { city: card.city, rig: card.rig, id: card.id },
    text: clean(text),
    ...(to === undefined ? {} : { to }),
  });
  const opened =
    typeof payload === 'object' && payload !== null && (payload as Record<string, unknown>).opened === true;
  return { opened };
}

/**
 * BOARD-LIVE C5 (round 2): `continue` / `resolve` on a needs_human pause do
 * not act; the city asks the owner and answers
 * `202 {"pending":"owner_question","question_id","jump_url"}`.
 */
export interface PendingOwnerQuestion {
  questionId: string;
  /** The question's Discord message (https Discord only); null if absent. */
  jumpUrl: string | null;
}

export interface TopicActionResult {
  /** Set when the city is waiting for the owner's answer instead. */
  pending: PendingOwnerQuestion | null;
}

const DISCORD_JUMP = /^https:\/\/(?:discord\.com|discordapp\.com)\/channels\/\d+\/\d+(?:\/\d+)?$/;

function pendingOf(payload: unknown): PendingOwnerQuestion | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const p = payload as Record<string, unknown>;
  if (p.pending !== 'owner_question' || typeof p.question_id !== 'string' || p.question_id.length === 0) return null;
  const jump = typeof p.jump_url === 'string' && DISCORD_JUMP.test(p.jump_url) ? p.jump_url : null;
  return { questionId: p.question_id, jumpUrl: jump };
}

/** One person action on a topic: message, resolve or continue. */
export async function postTopicAction(target: TopicTarget, action: TopicAction): Promise<TopicActionResult> {
  const base = { city: target.city, topic_id: target.topicId };
  switch (action.action) {
    case 'message':
      await post('topics/message', { ...base, text: clean(action.text) });
      return { pending: null };
    case 'resolve':
      return {
        pending: pendingOf(
          await post('topics/resolve', {
            ...base,
            reason: action.reason,
            summary: clean(action.summary),
            ...(action.decidingMessageId === undefined ? {} : { deciding_message_id: action.decidingMessageId }),
          }),
        ),
      };
    case 'continue':
      return { pending: pendingOf(await post('topics/continue', base)) };
  }
}

/** The per-reader last-read stamp: only for messages actually seen on screen. */
export async function markTopicRead(target: TopicTarget, at: string): Promise<void> {
  await post('topics/read', { city: target.city, topic_id: target.topicId, at });
}

export function commentErrorText(err: unknown): string {
  const code = err instanceof CommentWriteError ? err.code : 'failed';
  switch (code) {
    case 'empty':
      return t('Write something first.');
    case 'rate_limited':
    case 'outbox_full':
    case 'topic_cap':
    case 'topic_full':
      return t('Too many messages — try again in a minute.');
    case 'too_soon':
      return t('Too soon after the last message — try again in two minutes.');
    case 'too_long':
      return t('The text is too long.');
    case 'ack_only':
      return t('A bare «ok» is an acknowledgement, not a message.');
    case 'needs_human':
      return t('The topic is paused — press «Continue» first.');
    case 'resolved':
      return t('The topic is already resolved.');
    case 'bad_state':
    case 'duplicate':
      return t('The topic changed meanwhile — refresh and try again.');
    case 'not_allowed':
      return t('Only the opener or a person may do this.');
    case 'card_not_found':
    case 'bad_card':
    case 'not_found':
      return t('The card is no longer on the other board.');
    case 'disabled':
      return t('Comments are switched off on this city.');
    case 'own_login_unknown':
    case 'people_unreadable':
      return t('The city service is not ready yet.');
    case 'bad_request':
    case 'bad_reason':
    case 'own_card':
    case 'unknown_peer':
    case 'failed':
      return t('Not sent — try again.');
  }
}
