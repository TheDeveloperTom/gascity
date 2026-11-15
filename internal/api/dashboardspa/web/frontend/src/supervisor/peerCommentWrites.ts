import { getActiveCity } from '../api/cityBase';
import { t } from '../i18n';
import { authHeaders, withApiBase } from '../lib/apiBase';

// vk-final part 4: the person's writes to the other city — Mayor topics only
// (owner 15.11: no human comments on cards; a card conversation is a topic
// linked to the card). They go through our own city service `peer-boards`
// with `X-GC-Request: 1` (the engine refuses a /svc mutation without it); the
// service also checks a loopback Origin and `Sec-Fetch-Site: same-origin`,
// which the browser sends itself. The dashboard always writes as our person.
// Inside the Activity the same routes are used with the session headers (the
// gateway must pass them).
//
// Routes (all POST, body ≤ 16 KiB, answers `{"error": code}` on refusal),
// topics-report.md «Final dashboard contract»:
//   `/v1/topics` {to,title,text}; `/v1/topics/message` {city,topic_id,text};
//   `/v1/topics/react` {city,topic_id,message_id};
//   `/v1/topics/resolve` {city,topic_id,reason,summary,deciding_message_id?};
//   `/v1/topics/pause|continue|reopen` {city,topic_id}; `/v1/topics/read` {city,topic_id,at}.

export type CommentErrorCode =
  | 'empty'
  | 'bad_request'
  | 'own_card'
  | 'unknown_peer'
  | 'card_not_found'
  | 'rate_limited'
  | 'outbox_full'
  // topics
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
  | { action: 'pause' }
  | { action: 'continue' }
  | { action: 'reopen' }
  | { action: 'react'; messageId: string };

function serviceUrl(route: string): string {
  const city = getActiveCity();
  if (city === null) throw new CommentWriteError('failed');
  return withApiBase(`/v0/city/${encodeURIComponent(city)}/svc/peer-boards/v1/${route}`);
}

async function post(route: string, body: unknown): Promise<unknown> {
  const res = await fetch(serviceUrl(route), {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'X-GC-Request': '1',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });
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

/** Opens a topic with a peer city (`to` is its people.json login). */
export async function openTopic(to: string, title: string, text: string): Promise<void> {
  await post('topics', { to, title: clean(title), text: clean(text) });
}

export interface CardRefBody {
  /** The card's city (its people.json login). */
  city: string;
  rig: string;
  id: string;
}

const TITLE_MAX = 120;

function oneLineTitle(raw: string): string {
  const line = raw.replace(/\s+/g, ' ').trim();
  return line.length <= TITLE_MAX ? line : `${line.slice(0, TITLE_MAX - 1)}…`;
}

/**
 * A person's first comment on a card with no thread yet: it opens a Mayor
 * topic linked to the card, and the message becomes its first post (owner,
 * 15.11). PROVISIONAL: the city lane is adding this call; until its exact
 * shape lands this sends `/v1/topics` {to, title, text, card}, with the
 * card's title as the topic title (one line, ≤ 120). Only this function
 * changes when the final shape arrives.
 */
export async function openCardTopic(to: string, card: CardRefBody, title: string, text: string): Promise<void> {
  await post('topics', {
    to,
    title: oneLineTitle(clean(title)),
    text: clean(text),
    card: { city: card.city, rig: card.rig, id: card.id },
  });
}

/** One action on a topic: message, resolve, pause, continue, reopen or react. */
export async function postTopicAction(target: TopicTarget, action: TopicAction): Promise<void> {
  const base = { city: target.city, topic_id: target.topicId };
  switch (action.action) {
    case 'message':
      await post('topics/message', { ...base, text: clean(action.text) });
      return;
    case 'resolve':
      await post('topics/resolve', {
        ...base,
        reason: action.reason,
        summary: clean(action.summary),
        ...(action.decidingMessageId === undefined ? {} : { deciding_message_id: action.decidingMessageId }),
      });
      return;
    case 'react':
      await post('topics/react', { ...base, message_id: action.messageId });
      return;
    case 'pause':
    case 'continue':
    case 'reopen':
      await post(`topics/${action.action}`, base);
      return;
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
