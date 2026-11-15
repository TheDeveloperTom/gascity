import { getActiveCity } from '../api/cityBase';
import { t } from '../i18n';
import { authHeaders, withApiBase } from '../lib/apiBase';

// vk-final part 4: writes to the other city go through our own city service
// `peer-boards` (COMMENTS-PLAN «Write»): `POST /v0/city/<city>/svc/peer-boards/v1/comments`
// with `X-GC-Request: 1` (the engine refuses a /svc mutation without it). The
// service queues the entry in our outbox; the board sync carries it over.
// Inside the Activity the same route is used with the session headers: the
// plan defines no separate gateway route (COMMENTS-PLAN row 3).
//
// Topic events follow Revision 2 («Events … with target {kind: "topic",
// city: <topic owner city>, topic_id}»); the exact request body for topics is
// not pinned in the plan yet, so this is the one place to adjust.

export type CommentErrorCode =
  | 'empty'
  | 'bad_request'
  | 'own_card'
  | 'unknown_peer'
  | 'card_not_found'
  | 'rate_limited'
  | 'outbox_full'
  | 'disabled'
  | 'failed';

export class CommentWriteError extends Error {
  constructor(public readonly code: CommentErrorCode) {
    super(`peer comment: ${code}`);
    this.name = 'CommentWriteError';
  }
}

const KNOWN: ReadonlySet<string> = new Set([
  'bad_request',
  'own_card',
  'unknown_peer',
  'card_not_found',
  'rate_limited',
  'outbox_full',
]);

export interface CardTarget {
  /** The peer's people.json login. */
  city: string;
  rig: string;
  id: string;
}

export interface TopicTarget {
  /** The city that owns the topic (for a new topic: the peer we open it with). */
  city: string;
  topicId?: string;
}

export type TopicEvent =
  | { event: 'topic_open'; title: string; text: string }
  | { event: 'topic_message'; text: string }
  | { event: 'topic_resolve'; reason: 'resolved' | 'outdated' | 'duplicate' }
  | { event: 'topic_continue' };

export interface QueuedComment {
  id: string;
  text: string;
  createdAt: string;
  state: string;
}

function commentsUrl(): string {
  const city = getActiveCity();
  if (city === null) throw new CommentWriteError('failed');
  return withApiBase(`/v0/city/${encodeURIComponent(city)}/svc/peer-boards/v1/comments`);
}

async function post(body: unknown): Promise<unknown> {
  const res = await fetch(commentsUrl(), {
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
  if (res.status === 403 || res.status === 405) throw new CommentWriteError('disabled');
  const code =
    typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>).error : undefined;
  if (typeof code === 'string' && KNOWN.has(code)) throw new CommentWriteError(code as CommentErrorCode);
  if (res.status === 429) throw new CommentWriteError('rate_limited');
  if (res.status === 404) throw new CommentWriteError('card_not_found');
  throw new CommentWriteError('failed');
}

function clean(text: string): string {
  const out = text.trim();
  if (out.length === 0) throw new CommentWriteError('empty');
  return out;
}

/** Queues a comment on a peer's card; resolves to the queued entry. */
export async function postCardComment(target: CardTarget, text: string): Promise<QueuedComment> {
  const body = clean(text);
  const payload = await post({ target: { kind: 'card', city: target.city, rig: target.rig, id: target.id }, text: body });
  const raw =
    typeof payload === 'object' && payload !== null
      ? ((payload as Record<string, unknown>).comment as Record<string, unknown> | undefined)
      : undefined;
  return {
    id: typeof raw?.id === 'string' ? raw.id : `local-${Date.now()}`,
    text: typeof raw?.text === 'string' ? raw.text : body,
    createdAt: typeof raw?.created_at === 'string' ? raw.created_at : new Date().toISOString(),
    state: typeof raw?.state === 'string' ? raw.state : 'queued',
  };
}

/** One topic event (open, message, resolve, continue). */
export async function postTopicEvent(target: TopicTarget, event: TopicEvent): Promise<void> {
  const tgt: Record<string, string> = { kind: 'topic', city: target.city };
  if (target.topicId !== undefined) tgt.topic_id = target.topicId;
  const body: Record<string, unknown> = { target: tgt, event: event.event };
  if (event.event === 'topic_open') {
    body.title = clean(event.title);
    body.text = clean(event.text);
  } else if (event.event === 'topic_message') {
    body.text = clean(event.text);
  } else if (event.event === 'topic_resolve') {
    body.resolution = { reason: event.reason };
  }
  await post(body);
}

/** The per-reader last-read stamp (Revision 2 «Serve»): only for messages seen on screen. */
export async function markTopicRead(topicId: string, at: string): Promise<void> {
  await post({ kind: 'read', topic_id: topicId, at });
}

export function commentErrorText(err: unknown): string {
  const code = err instanceof CommentWriteError ? err.code : 'failed';
  switch (code) {
    case 'empty':
      return t('Write something first.');
    case 'rate_limited':
    case 'outbox_full':
      return t('Too many messages — try again in a minute.');
    case 'card_not_found':
      return t('The card is no longer on the other board.');
    case 'disabled':
      return t('Comments are switched off on this city.');
    default:
      return t('Not sent — try again.');
  }
}
