import type { ConversationTranscriptRecord } from 'gas-city-dashboard-shared/gc-supervisor';
import { withApiBase } from '../lib/apiBase';
import { supervisorApi } from './client';

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

export type BoardChatErrorCode = 'bad_request' | 'too_long' | 'not_owner' | 'not_own_card' | 'no_peer' | 'failed';

const KNOWN: ReadonlySet<string> = new Set<BoardChatErrorCode>([
  'bad_request',
  'too_long',
  'not_owner',
  'not_own_card',
  'no_peer',
]);

export class BoardChatError extends Error {
  constructor(public readonly code: BoardChatErrorCode) {
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
  const code = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>).error : undefined;
  throw new BoardChatError(typeof code === 'string' && KNOWN.has(code) ? (code as BoardChatErrorCode) : 'failed');
}

/** C2 `POST /v1/send`: the service answers 202 once the turn is in its outbox. */
export async function sendTurn(city: string, card: ChatCard, text: string, clientId: string, replyTo?: string): Promise<void> {
  await call(city, 'send', {
    method: 'POST',
    body: JSON.stringify({
      card: { rig: card.rig, id: card.id },
      text,
      client_id: clientId,
      ...(replyTo !== undefined ? { reply_to: replyTo } : {}),
    }),
  });
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
  if (at >= 0) return { ownerText: text.slice(0, at).trimEnd() };
  if (text.startsWith(MARKER)) return { ownerText: '' };
  return { ownerText: text };
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
  const reply = parseReply(r.Text);
  return { ...base, who: reply.who, text: reply.text, ask: reply.ask };
}

/** The card's conversation (C1) from `/extmsg/transcript`, oldest first. */
export async function readThread(city: string, cardId: string, afterSequence?: number): Promise<ThreadEntry[]> {
  const body = await supervisorApi().extmsgTranscript(city, {
    scope_id: city,
    provider: BOARD_PROVIDER,
    account_id: BOARD_ACCOUNT,
    conversation_id: cardId,
    kind: BOARD_KIND,
    ...(afterSequence !== undefined ? { after_sequence: afterSequence } : {}),
    limit: 500,
    order: 'asc',
  });
  return (body.items ?? []).map(entryOf).sort((a, b) => a.seq - b.seq);
}
