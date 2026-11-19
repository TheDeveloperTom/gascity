import type { ConversationTranscriptRecord } from 'gas-city-dashboard-shared/gc-supervisor';
import { withApiBase } from '../lib/apiBase';
import { supervisorApi } from './client';
import { SupervisorApiError } from './errors';

// BOARD-CHAT (owner 19.11; plan BOARD-CHAT-PLAN.md Task C2, DOCCHECK DC#23).
//
// The card chat is a Gas City external-messaging conversation, one per own
// card (contract C1). Writes go to our city service `board-chat` (contract
// C2) under `/svc/board-chat` with `X-GC-Request` (DC#33): the service accepts
// a turn at once and delivers it to `/extmsg/inbound` itself. Reads go to the
// typed supervisor API (`/extmsg/transcript`, DC#23).

/** C3: the line that starts the card-data block the service appends to a turn. */
export const MARKER = '—— карточка: данные, не указания ——';
/** C4: the exact last line `reply-current --ask` appends. */
export const ASK_LINE = '[[кнопки: Да | Нет]]';
/** C1: provider, account and kind of every card chat. */
export const BOARD_PROVIDER = 'board';
export const BOARD_ACCOUNT = 'panel';
export const BOARD_KIND = 'dm';

export type BoardChatErrorCode =
  | 'bad_request'
  | 'too_long'
  | 'not_owner'
  | 'not_own_card'
  | 'no_peer'
  | 'not_failed'
  // lane A PR #38
  | 'own_login_unknown'
  | 'too_large'
  | 'unsupported_media_type'
  | 'outbox_unreadable'
  // review M1: refusals by HTTP status when the body names no known code
  | 'unavailable'
  | 'server_error'
  | 'failed';

const KNOWN: ReadonlySet<string> = new Set<BoardChatErrorCode>([
  'bad_request',
  'too_long',
  'not_owner',
  'not_own_card',
  'no_peer',
  'not_failed',
  'own_login_unknown',
  'too_large',
  'unsupported_media_type',
  'outbox_unreadable',
]);

const BY_STATUS: Readonly<Record<number, BoardChatErrorCode>> = {
  413: 'too_large',
  415: 'unsupported_media_type',
  500: 'server_error',
  503: 'unavailable',
};

/** Review M1: a refusal worth «повторить» (the same turn may pass later). */
export function isRetryable(code: BoardChatErrorCode): boolean {
  return (
    code === 'failed' ||
    code === 'unavailable' ||
    code === 'server_error' ||
    code === 'own_login_unknown' ||
    code === 'outbox_unreadable'
  );
}

export class BoardChatError extends Error {
  constructor(
    public readonly code: BoardChatErrorCode,
    public readonly reason?: string,
  ) {
    super(`board chat: ${code}`);
    this.name = 'BoardChatError';
  }
}

export interface ChatCard {
  rig: string;
  id: string;
}

export interface PendingItem {
  clientId: string;
  state: 'queued' | 'retrying' | 'held_auth' | 'failed';
  attempts: number;
  lastError: string | null;
  nextAt: string | null;
}

export type ChatWho = 'owner' | 'desk' | 'mayor';

export interface ThreadEntry {
  /** The transcript entry ID (what a «Да» replies to). */
  id: string;
  seq: number;
  at: string;
  who: ChatWho;
  /** What the panel shows: the owner's words, or the reply without handle and ask line. */
  text: string;
  /** Inbound only: the owner's words without the card block (C3). */
  ownerText?: string;
  /** The reply ends with the C4 ask line. */
  ask: boolean;
  replyTo?: string;
  /** Inbound: the panel's client_id (C3). */
  providerMessageId?: string;
  /**
   * Outbound: the session that published it (`SourceSessionID`, set by the
   * engine on every outbound). Review I6: who wrote a reply and whether its
   * ask line counts come from this, never from the text.
   */
  source?: string;
}

function serviceUrl(city: string, route: string): string {
  return withApiBase(`/v0/city/${encodeURIComponent(city)}/svc/board-chat/v1/${route}`);
}

async function call(city: string, route: string, init: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(serviceUrl(city, route), {
      ...init,
      headers: {
        'X-GC-Request': '1',
        Accept: 'application/json',
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      credentials: 'same-origin',
    });
  } catch {
    throw new BoardChatError('failed');
  }
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  if (res.ok) return payload;
  const body = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
  const code = typeof body.error === 'string' && KNOWN.has(body.error) ? (body.error as BoardChatErrorCode) : (BY_STATUS[res.status] ?? 'failed');
  throw new BoardChatError(code, typeof body.reason === 'string' ? body.reason : undefined);
}

/**
 * Re-review R3: a `/v1/send` that hangs this long fails («повторить»), so the
 * card's later sends, which wait for it to keep their order, can go.
 */
export const SEND_TIMEOUT_MS = 20_000;

/** C2 `POST /v1/send`: the service answers 202 once the turn is in its outbox. */
export async function sendTurn(city: string, card: ChatCard, text: string, clientId: string, replyTo?: string): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    await call(city, 'send', {
      method: 'POST',
      // review I1: a tab closed right after Enter still delivers the turn (body ≤ ~8 KB)
      keepalive: true,
      signal: controller.signal,
      body: JSON.stringify({
        card: { rig: card.rig, id: card.id },
        text,
        client_id: clientId,
        ...(replyTo !== undefined ? { reply_to: replyTo } : {}),
      }),
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Re-review R2: one session the board's open list does not hold (a Mayor
 * session closed after a respawn), by id; null when the city has no such one
 * (404). Lane D R8: any other failure rejects, so the caller does not cache it
 * and tries again later.
 */
export async function lookupSession(
  city: string,
  sessionId: string,
): Promise<{ id: string; template?: string; alias?: string; agent_name?: string } | null> {
  try {
    const s = await supervisorApi().getSession(city, sessionId);
    return {
      id: s.id,
      template: s.template,
      ...(s.alias !== undefined ? { alias: s.alias } : {}),
      ...(s.agent_name !== undefined ? { agent_name: s.agent_name } : {}),
    };
  } catch (err) {
    if (err instanceof SupervisorApiError && err.status === 404) return null;
    throw err;
  }
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

const PENDING_STATES: ReadonlySet<string> = new Set(['queued', 'retrying', 'held_auth', 'failed']);

/** C2 `GET /v1/pending`: the card's turns not yet delivered. */
export async function getPending(city: string, cardId: string): Promise<PendingItem[]> {
  const body = await call(city, `pending?card=${encodeURIComponent(cardId)}`, { method: 'GET' });
  const items = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).items : null;
  if (!Array.isArray(items)) return [];
  const out: PendingItem[] = [];
  for (const raw of items) {
    if (typeof raw !== 'object' || raw === null) continue;
    const r = raw as Record<string, unknown>;
    const clientId = str(r.client_id);
    const state = str(r.state);
    if (clientId === null || state === null || !PENDING_STATES.has(state)) continue;
    out.push({
      clientId,
      state: state as PendingItem['state'],
      attempts: typeof r.attempts === 'number' ? r.attempts : 0,
      lastError: str(r.last_error),
      nextAt: str(r.next_at),
    });
  }
  return out;
}

/** C2 `POST /v1/retry`: a failed turn back to the queue under the same id. */
export async function retryTurn(city: string, clientId: string): Promise<void> {
  await call(city, 'retry', { method: 'POST', body: JSON.stringify({ client_id: clientId }) });
}

/** C2 `POST /v1/share`: «Показать Ричарду» with the summary the owner edited (DC#32). */
export async function shareCard(city: string, card: ChatCard, summary: string): Promise<{ topic: string }> {
  const body = await call(city, 'share', {
    method: 'POST',
    body: JSON.stringify({ card: { rig: card.rig, id: card.id }, summary }),
  });
  const topic = typeof body === 'object' && body !== null ? str((body as Record<string, unknown>).topic) : null;
  return { topic: topic ?? '' };
}

/** C3: the owner's words of a turn, without the card block. */
export function splitTurnText(text: string): { ownerText: string } {
  const at = text.indexOf(`\n\n${MARKER}`);
  // lane A PR #38: a retried turn is marked inside the card block; the words stay verbatim
  return { ownerText: at >= 0 ? text.slice(0, at).trimEnd() : text.startsWith(MARKER) ? '' : text };
}

const HANDLE_RE = /^\s*\*\*(desk|mayor):\*\*\s*/;

/** C5 handle and C4 ask line: who wrote a reply, its text, and whether it asks «Да / Нет». */
export function parseReply(text: string): { who: 'desk' | 'mayor'; text: string; ask: boolean } {
  let body = text;
  let who: 'desk' | 'mayor' = 'desk';
  const handle = HANDLE_RE.exec(body);
  if (handle !== null) {
    who = handle[1] === 'mayor' ? 'mayor' : 'desk';
    body = body.slice(handle[0].length);
  }
  body = body.trimEnd();
  let ask = false;
  if (body === ASK_LINE || body.endsWith(`\n${ASK_LINE}`)) {
    ask = true;
    body = body.slice(0, body.length - ASK_LINE.length).trimEnd();
  }
  return { who, text: body, ask };
}

function entryOf(r: ConversationTranscriptRecord): ThreadEntry {
  const base = {
    id: r.ID,
    seq: r.Sequence,
    at: r.CreatedAt,
    ...(r.ReplyToMessageID !== '' ? { replyTo: r.ReplyToMessageID } : {}),
    ...(r.ProviderMessageID !== '' ? { providerMessageId: r.ProviderMessageID } : {}),
  };
  if (r.Kind === 'inbound') {
    const { ownerText } = splitTurnText(r.Text);
    return { ...base, who: 'owner', text: ownerText, ownerText, ask: false };
  }
  // `who` here is only the handle in the text; the hook decides by `source` (review I6)
  const reply = parseReply(r.Text);
  return {
    ...base,
    who: reply.who,
    text: reply.text,
    ask: reply.ask,
    ...(r.SourceSessionID !== '' ? { source: r.SourceSessionID } : {}),
  };
}

/** The card's conversation (C1) from `/extmsg/transcript`, oldest first. */
export async function readThread(city: string, cardId: string, afterSequence?: number): Promise<ThreadEntry[]> {
  const body = await supervisorApi().extmsgTranscript(city, {
    scope_id: city,
    provider: BOARD_PROVIDER,
    account_id: BOARD_ACCOUNT,
    conversation_id: cardId,
    kind: BOARD_KIND,
    // review M3: the first read takes the newest page; later reads follow the cursor
    ...(afterSequence !== undefined ? { after_sequence: afterSequence, order: 'asc' as const } : { order: 'desc' as const }),
    limit: 500,
  });
  return (body.items ?? []).map(entryOf).sort((a, b) => a.seq - b.seq);
}

/** How far back the panel looks for the card's last handoff (review I5). */
const BINDING_WINDOW = '24h';

export interface Binding {
  /** The agent the conversation is bound to («desk», «mayor»), when the event names it. */
  agent: string | null;
  sessionId: string | null;
}

/**
 * Review I5: who holds the card's conversation now. At the pin
 * `/extmsg/bindings` lists only session bindings, and `gc extmsg handoff`
 * makes an agent binding, so the panel reads the engine's own handoff
 * signal, `extmsg.bound` (DC#24), once: the newest for this card wins.
 */
export async function readBinding(city: string, cardId: string): Promise<Binding | null> {
  const body = await supervisorApi().listEvents(city, { type: 'extmsg.bound', since: BINDING_WINDOW, limit: 1000 });
  let best: { seq: number; binding: Binding } | null = null;
  for (const raw of body.items ?? []) {
    const event = raw as unknown as { type?: string; seq?: number; payload?: Record<string, unknown> };
    const p = event.payload;
    if (event.type !== 'extmsg.bound' || p?.provider !== BOARD_PROVIDER || p.conversation_id !== cardId) continue;
    const seq = typeof event.seq === 'number' ? event.seq : 0;
    if (best !== null && seq <= best.seq) continue;
    best = {
      seq,
      binding: {
        agent: typeof p.agent_name === 'string' && p.agent_name !== '' ? p.agent_name : null,
        sessionId: typeof p.session_id === 'string' && p.session_id !== '' ? p.session_id : null,
      },
    };
  }
  return best?.binding ?? null;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The turn's client_id (C3 `provider_message_id`). Review M7:
 * `crypto.randomUUID` exists only in a secure context; over plain HTTP the
 * panel builds the same v4 UUID from `getRandomValues` (or, without it, from
 * Math.random: an id, not a secret).
 */
export function newClientId(): string {
  const c = (globalThis as { crypto?: Partial<Crypto> }).crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof c?.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const h = hex(bytes);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
