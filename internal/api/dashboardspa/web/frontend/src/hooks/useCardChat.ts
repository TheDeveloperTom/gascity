import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BOARD_PROVIDER,
  getPending,
  readThread,
  retryTurn,
  sendTurn,
  type ChatCard,
  type PendingItem,
  type ThreadEntry,
} from '../supervisor/boardChat';
import { useGcEventRefresh, type GcEventEnvelope } from './useGcEvents';
import { useStructuredSessionStream } from './useStructuredSessionStream';

// BOARD-CHAT Task C3 (plan BOARD-CHAT-PLAN.md; contract C6; DOCCHECK DC#24-26).
//
// The card chat's rows and their states come from native signals only:
//  - history: the conversation's transcript (`/extmsg/transcript`, DC#23);
//  - new entries: the city event stream's `extmsg.inbound` / `extmsg.outbound`
//    / `extmsg.bound` for provider `board` and this card (DC#24), each one a
//    transcript read after the last seen Sequence;
//  - «читает»: the bound agent's session stream `activity` (DC#25);
//  - delivered: the turn's client_id appears as a ProviderMessageID (DC#26).
// Only the abnormal path asks the board-chat service (`/v1/pending`, C2):
// a turn not delivered 15 s after the service accepted it.

export type ChatRowState = 'sending' | 'queued' | 'delivered' | 'reading' | 'failed';

export interface ChatRow {
  key: string;
  who: 'owner' | 'desk' | 'mayor';
  text: string;
  state?: ChatRowState;
  ask?: { entryId: string; answered: boolean };
  at: string;
}

export interface CardChat {
  rows: ChatRow[];
  send(text: string): void;
  retry(clientId: string): void;
  answer(entryId: string, yes: boolean): void;
  status: 'loading' | 'ready' | 'error';
  who: 'desk' | 'mayor';
  agentActivity: 'idle' | 'in-turn' | 'unknown';
}

/** A turn this tab sent (or the service still holds) that the transcript does not show yet. */
interface LocalTurn {
  clientId: string;
  text: string;
  replyTo?: string;
  at: string;
  state: 'sending' | 'queued' | 'failed';
  /** `local`: the service never accepted it (re-send); `service`: its outbox gave up (`/v1/retry`). */
  origin: 'local' | 'service';
}

/** Owner 19.11 point 5: the check that asks the service about a turn not delivered yet. */
export const DELIVERY_CHECK_MS = 15_000;
/** Reply visible ≤ 1 s after `extmsg.outbound` (plan D3 scenario 1). */
const EVENT_COALESCE_MS = 250;
const CHAT_EVENTS: ReadonlySet<string> = new Set(['extmsg.inbound', 'extmsg.outbound', 'extmsg.bound']);

// The text of a turn by its client_id, for this tab's lifetime: `/v1/pending`
// carries no text (C2), so a remounted drawer still shows what was typed.
const sentTexts = new Map<string, string>();

function newClientId(): string {
  return crypto.randomUUID();
}

function mergeThread(prev: readonly ThreadEntry[], next: readonly ThreadEntry[]): ThreadEntry[] {
  if (next.length === 0) return prev as ThreadEntry[];
  const byId = new Map(prev.map((e) => [e.id, e]));
  for (const e of next) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

function pendingState(item: PendingItem): LocalTurn['state'] {
  return item.state === 'failed' ? 'failed' : 'queued';
}

function boundWho(payload: Record<string, unknown> | undefined): 'desk' | 'mayor' | null {
  const name = payload?.agent_name;
  if (typeof name !== 'string' || name === '') return null;
  return name === 'mayor' || name.endsWith('/mayor') ? 'mayor' : 'desk';
}

export function useCardChat(city: string, card: ChatCard): CardChat {
  const [thread, setThread] = useState<ThreadEntry[]>([]);
  const [local, setLocal] = useState<LocalTurn[]>([]);
  const [status, setStatus] = useState<CardChat['status']>('loading');
  const [who, setWho] = useState<'desk' | 'mayor'>('desk');
  const lastSeq = useRef<number | undefined>(undefined);
  const reading = useRef(false);
  const readAgain = useRef(false);
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const live = useRef(true);
  const threadRef = useRef(thread);
  threadRef.current = thread;
  const localRef = useRef(local);
  localRef.current = local;
  const cardRef = useRef(card);
  cardRef.current = card;

  const applyThread = useCallback((entries: readonly ThreadEntry[]) => {
    for (const e of entries) {
      if (lastSeq.current === undefined || e.seq > lastSeq.current) lastSeq.current = e.seq;
    }
    setThread((prev) => mergeThread(prev, entries));
  }, []);

  // One read at a time; an event during a read asks for one more after it.
  const refresh = useCallback(() => {
    if (reading.current) {
      readAgain.current = true;
      return;
    }
    reading.current = true;
    readThread(city, card.id, lastSeq.current).then(
      (entries) => {
        reading.current = false;
        if (!live.current) return;
        applyThread(entries);
        if (readAgain.current) {
          readAgain.current = false;
          refresh();
        }
      },
      () => {
        reading.current = false;
        readAgain.current = false;
      },
    );
  }, [city, card.id, applyThread]);

  // Mount (and card change): history from the transcript, unsent turns from pending.
  useEffect(() => {
    live.current = true;
    lastSeq.current = undefined;
    reading.current = true;
    readAgain.current = false;
    setThread([]);
    setLocal([]);
    setStatus('loading');
    setWho('desk');
    Promise.all([readThread(city, card.id), getPending(city, card.id).catch(() => [] as PendingItem[])]).then(
      ([entries, pending]) => {
        reading.current = false;
        if (!live.current) return;
        applyThread(entries);
        const seen = new Set(entries.map((e) => e.providerMessageId).filter((id): id is string => id !== undefined));
        setLocal(
          pending
            .filter((p) => !seen.has(p.clientId))
            .map((p) => ({
              clientId: p.clientId,
              text: sentTexts.get(p.clientId) ?? '',
              at: '',
              state: pendingState(p),
              origin: 'service' as const,
            })),
        );
        setStatus('ready');
        if (readAgain.current) {
          readAgain.current = false;
          refresh();
        }
      },
      () => {
        reading.current = false;
        if (live.current) setStatus('error');
      },
    );
    return () => {
      live.current = false;
      if (checkTimer.current !== null) clearTimeout(checkTimer.current);
      checkTimer.current = null;
    };
    // refresh/applyThread are stable for a given city and card
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city, card.id]);

  const matches = useCallback((event: GcEventEnvelope) => {
    if (!CHAT_EVENTS.has(event.type)) return false;
    const payload = event.payload;
    if (payload?.provider !== BOARD_PROVIDER || payload.conversation_id !== cardRef.current.id) return false;
    if (event.type === 'extmsg.bound') {
      const next = boundWho(payload);
      if (next !== null) setWho(next);
    }
    return true;
  }, []);

  useGcEventRefresh(['extmsg.'], refresh, { matches, coalesceMs: EVENT_COALESCE_MS });

  const delivered = useMemo(
    () => new Set(thread.map((e) => e.providerMessageId).filter((id): id is string => id !== undefined)),
    [thread],
  );

  // The abnormal path: a turn accepted by the service but not in the transcript after 15 s.
  const check = useCallback(() => {
    checkTimer.current = null;
    const seen = new Set(threadRef.current.map((e) => e.providerMessageId));
    const waiting = localRef.current.filter((l) => l.state === 'queued' && !seen.has(l.clientId));
    if (waiting.length === 0) return;
    getPending(city, cardRef.current.id).then(
      (items) => {
        if (!live.current) return;
        const byId = new Map(items.map((i) => [i.clientId, i]));
        // not pending any more: delivered, the transcript will show it
        const gone = waiting.some((l) => !byId.has(l.clientId));
        setLocal((prev) =>
          prev.map((l) => {
            const item = l.state === 'queued' ? byId.get(l.clientId) : undefined;
            return item === undefined ? l : { ...l, state: pendingState(item), origin: 'service' };
          }),
        );
        if (gone) refresh();
      },
      () => {},
    );
  }, [city, refresh]);

  const scheduleCheck = useCallback(() => {
    if (checkTimer.current !== null) return;
    checkTimer.current = setTimeout(check, DELIVERY_CHECK_MS);
  }, [check]);

  const setTurn = (clientId: string, patch: Partial<LocalTurn>) =>
    setLocal((prev) => prev.map((l) => (l.clientId === clientId ? { ...l, ...patch } : l)));

  const deliver = useCallback(
    (turn: Pick<LocalTurn, 'clientId' | 'text' | 'replyTo'>) => {
      sendTurn(city, cardRef.current, turn.text, turn.clientId, turn.replyTo).then(
        () => {
          if (!live.current) return;
          setTurn(turn.clientId, { state: 'queued' });
          scheduleCheck();
        },
        () => {
          if (!live.current) return;
          setTurn(turn.clientId, { state: 'failed', origin: 'local' });
        },
      );
    },
    [city, scheduleCheck],
  );

  const sendWith = useCallback(
    (text: string, replyTo?: string) => {
      const clientId = newClientId();
      sentTexts.set(clientId, text);
      const turn: LocalTurn = {
        clientId,
        text,
        ...(replyTo !== undefined ? { replyTo } : {}),
        at: new Date().toISOString(),
        state: 'sending',
        origin: 'local',
      };
      setLocal((prev) => [...prev, turn]);
      deliver(turn);
    },
    [deliver],
  );

  const send = useCallback((text: string) => sendWith(text), [sendWith]);

  const answer = useCallback((entryId: string, yes: boolean) => sendWith(yes ? 'Да' : 'Нет', entryId), [sendWith]);

  const retry = useCallback(
    (clientId: string) => {
      const turn = localRef.current.find((l) => l.clientId === clientId);
      if (turn === undefined || turn.state !== 'failed') return;
      if (turn.origin === 'local') {
        setTurn(clientId, { state: 'sending' });
        deliver(turn);
        return;
      }
      retryTurn(city, clientId).then(
        () => {
          if (!live.current) return;
          setTurn(clientId, { state: 'queued' });
          scheduleCheck();
        },
        () => {},
      );
    },
    [city, deliver, scheduleCheck],
  );

  const sessionState = useStructuredSessionStream(who, true);
  const activity = sessionState.status === 'ready' ? sessionState.result.activity : 'unknown';
  const agentActivity: CardChat['agentActivity'] =
    activity === 'in-turn' ? 'in-turn' : activity === 'idle' ? 'idle' : 'unknown';

  const rows = useMemo(() => {
    const answered = new Set<string>();
    for (const e of thread) if (e.who === 'owner' && e.replyTo !== undefined) answered.add(e.replyTo);
    for (const l of local) if (l.replyTo !== undefined && !delivered.has(l.clientId)) answered.add(l.replyTo);

    // the owner's last turn awaits a reply when nothing was written after it
    const last = thread.at(-1);
    const awaiting = last !== undefined && last.who === 'owner' ? last.id : null;

    const out: ChatRow[] = thread.map((e) => {
      if (e.who === 'owner') {
        return {
          key: e.id,
          who: 'owner',
          text: e.text,
          state: e.id === awaiting && agentActivity === 'in-turn' ? 'reading' : 'delivered',
          at: e.at,
        };
      }
      return {
        key: e.id,
        who: e.who,
        text: e.text,
        ...(e.ask ? { ask: { entryId: e.id, answered: answered.has(e.id) } } : {}),
        at: e.at,
      };
    });
    for (const l of local) {
      if (delivered.has(l.clientId)) continue;
      out.push({ key: l.clientId, who: 'owner', text: l.text, state: l.state, at: l.at });
    }
    return out;
  }, [thread, local, delivered, agentActivity]);

  return { rows, send, retry, answer, status, who, agentActivity };
}
