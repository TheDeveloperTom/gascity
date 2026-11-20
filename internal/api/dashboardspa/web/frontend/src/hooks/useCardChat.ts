import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  BOARD_PROVIDER,
  BoardChatError,
  getPending,
  isRetryable,
  lookupSession,
  newClientId,
  readBinding,
  readThread,
  retryTurn,
  sendTurn,
  type BoardChatErrorCode,
  type ChatCard,
  type PendingItem,
  type ThreadEntry,
} from '../supervisor/boardChat';
import { useHiddenPaused } from '../lib/hiddenPause';
import { useGcEventRefresh, type GcEventEnvelope } from './useGcEvents';
import { useStructuredSessionStream, type StructuredStreamItem } from './useStructuredSessionStream';

// BOARD-CHAT Task C3 (plan BOARD-CHAT-PLAN.md; contract C6; DOCCHECK DC#24-26),
// with the lane C review fixes.
//
// The card chat's rows and their states come from native signals only:
//  - history: the conversation's transcript (`/extmsg/transcript`, DC#23);
//  - new entries: the city event stream's `extmsg.inbound` / `extmsg.outbound`
//    / `extmsg.bound` for provider `board` and this card (DC#24), each one a
//    transcript read after the last seen Sequence; again after the stream
//    reconnects or the page becomes visible (review I3);
//  - who holds the chat: `extmsg.bound` (read once at mount, then live; I5);
//  - who wrote a reply: the entry's source session, never its text (I6);
//  - «читает»: the bound agent's session stream `activity` (DC#25), opened
//    only while a reply is awaited or the Mayor holds the chat, and not in a
//    tab hidden past the grace time (D3 19.11, HOST cause 5: it was a third
//    long-lived connection per tab, and two tabs used up the six HTTP/1.1
//    connections per host, so POST /v1/send never started);
//  - delivered: the turn's client_id appears as a ProviderMessageID (DC#26).
// Only the abnormal path asks the board-chat service (`/v1/pending`, C2):
// every 15 s while a turn it accepted is not in the transcript (I2).
//
// Review I1 (owner point 5, «no message is ever lost»): a turn lives in a
// small registry kept in localStorage from the moment the box clears until
// the transcript shows it. Its send is module-level, so a closed drawer or a
// reload still shows it, and a failure still offers «повторить».

export type ChatRowState = 'sending' | 'queued' | 'delivered' | 'reading' | 'failed';

export interface ChatRow {
  key: string;
  /** `city`: lane D R9, a reply whose session is still being looked up (neutral, no buttons). */
  who: 'owner' | 'desk' | 'mayor' | 'city';
  text: string;
  state?: ChatRowState;
  /** A failed turn: why (review M1), and whether «повторить» can help. */
  error?: BoardChatErrorCode | undefined;
  retryable?: boolean;
  ask?: { entryId: string; answered: boolean };
  at: string;
}

export interface CardChat {
  rows: ChatRow[];
  send(text: string): void;
  retry(clientId: string): void;
  answer(entryId: string, yes: boolean): void;
  /** `no_chat`: the service says this card has no chat (409 not_own_card, review Q3). */
  status: 'loading' | 'ready' | 'error' | 'no_chat';
  who: 'desk' | 'mayor';
  agentActivity: 'idle' | 'in-turn' | 'unknown';
  /**
   * The agent is in a turn that provably serves another card: the prompt that
   * opened it names only other board conversations. False when unknown.
   */
  agentOnOtherCard: boolean;
}

/** The sessions the board already reads; enough to tell the desk from the Mayor (I6). */
export interface SessionLike {
  id: string;
  template?: string;
  alias?: string;
  agent_name?: string;
}

/** A turn from the moment the box cleared until the transcript shows it. */
interface StoredTurn {
  clientId: string;
  city: string;
  cardId: string;
  rig: string;
  text: string;
  replyTo?: string;
  at: string;
  state: 'sending' | 'queued' | 'failed';
  /** `local`: the service never accepted it (re-send); `service`: its outbox gave up (`/v1/retry`). */
  origin: 'local' | 'service';
  error?: BoardChatErrorCode | undefined;
  /** Lane D R10: when the turn failed; a failed turn ages out from here. */
  failedAt?: string | undefined;
}

/** Owner 19.11 point 5: how often to ask the service about a turn not delivered yet. */
export const DELIVERY_CHECK_MS = 15_000;
/** Reply visible ≤ 1 s after `extmsg.outbound` (plan D3 scenario 1). */
const EVENT_COALESCE_MS = 250;
const CHAT_EVENTS: ReadonlySet<string> = new Set(['extmsg.inbound', 'extmsg.outbound', 'extmsg.bound']);
const STORE_KEY = 'gc.board-chat.turns.v1';
const NONE: readonly SessionLike[] = [];

// ---- the turn registry (module + localStorage) ----------------------------

const STATES: ReadonlySet<string> = new Set(['sending', 'queued', 'failed']);

function isStoredTurn(v: unknown): v is StoredTurn {
  if (typeof v !== 'object' || v === null) return false;
  const t = v as Record<string, unknown>;
  return (
    typeof t.clientId === 'string' &&
    typeof t.city === 'string' &&
    typeof t.cardId === 'string' &&
    typeof t.rig === 'string' &&
    typeof t.text === 'string' &&
    typeof t.state === 'string' &&
    STATES.has(t.state) &&
    (t.origin === 'local' || t.origin === 'service')
  );
}

/** Re-review R6: a turn that failed for good and was never retried ages out. */
const FAILED_TTL_MS = 24 * 3600_000;

/** Lane D R10: a failed turn keeps the time it first failed; one without a valid time gets now. */
function withFailedAt(t: StoredTurn): StoredTurn {
  return t.failedAt !== undefined && !Number.isNaN(Date.parse(t.failedAt)) ? t : { ...t, failedAt: new Date().toISOString() };
}

function loadTurns(): StoredTurn[] {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    // re-review R6, lane D R10: drop turns that failed more than a day ago,
    // counted from the failure; a failed turn with no failure time starts now
    return parsed
      .filter(isStoredTurn)
      .map((t) => (t.state === 'failed' ? withFailedAt(t) : t))
      .filter((t) => !(t.state === 'failed' && now - Date.parse(t.failedAt ?? '') > FAILED_TTL_MS));
  } catch {
    return [];
  }
}

let turns: readonly StoredTurn[] = loadTurns();
const listeners = new Set<() => void>();
/** Sends this tab still waits on: a reloaded «sending» turn is not one of them. */
const inFlight = new Set<string>();
/** Review M5: one card's sends go out one after another, in order. */
const chains = new Map<string, Promise<unknown>>();
/**
 * Cards the service said have no chat (409 not_own_card), until when. Re-review
 * R1: a new product card gets this 409 until the live frame catches up, so the
 * mark lasts one mount and at most a minute.
 */
const noChat = new Map<string, number>();
/** Re-review R1: how long a 409 not_own_card hides the chat. */
export const NO_CHAT_MS = 60_000;
/** Re-review R2: sessions looked up by id (closed ones too), once each. */
const looked = new Map<string, SessionLike | null>();
const looking = new Set<string>();

function setTurns(next: readonly StoredTurn[]): void {
  turns = next;
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(next));
  } catch {
    // private window or full storage: the module copy still holds the turn
  }
  for (const l of [...listeners]) l();
}

function patchTurn(clientId: string, patch: Partial<StoredTurn>): void {
  if (!turns.some((t) => t.clientId === clientId)) return;
  setTurns(turns.map((t) => (t.clientId === clientId ? { ...t, ...patch } : t)));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = () => turns;

function cardKey(city: string, cardId: string): string {
  return `${city}\u0000${cardId}`;
}

/** Sends one turn after the card's previous one; the result lands in the registry. */
function deliver(turn: StoredTurn, onAccepted: () => void): void {
  const key = cardKey(turn.city, turn.cardId);
  inFlight.add(turn.clientId);
  patchTurn(turn.clientId, { state: 'sending', failedAt: undefined });
  const next = (chains.get(key) ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => sendTurn(turn.city, { rig: turn.rig, id: turn.cardId }, turn.text, turn.clientId, turn.replyTo))
    .then(
      () => {
        inFlight.delete(turn.clientId);
        patchTurn(turn.clientId, { state: 'queued', origin: 'local' });
        onAccepted();
      },
      (err: unknown) => {
        inFlight.delete(turn.clientId);
        const code: BoardChatErrorCode = err instanceof BoardChatError ? err.code : 'failed';
        // re-review R1: the refused words stay, in a failed row that says why
        if (code === 'not_own_card') noChat.set(key, Date.now() + NO_CHAT_MS);
        patchTurn(turn.clientId, { state: 'failed', origin: 'local', error: code, failedAt: new Date().toISOString() });
      },
    );
  chains.set(key, next);
}

/** Tests only: drop the module state and read localStorage again. */
export function resetCardChatForTests(): void {
  turns = loadTurns();
  inFlight.clear();
  chains.clear();
  noChat.clear();
  looked.clear();
  looking.clear();
}

// ---- helpers -----------------------------------------------------------------

function mergeThread(prev: readonly ThreadEntry[], next: readonly ThreadEntry[]): ThreadEntry[] {
  if (next.length === 0) return prev as ThreadEntry[];
  const byId = new Map(prev.map((e) => [e.id, e]));
  for (const e of next) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

function pendingState(item: PendingItem): StoredTurn['state'] {
  return item.state === 'failed' ? 'failed' : 'queued';
}

function agentOf(name: string | null | undefined): 'desk' | 'mayor' | null {
  if (typeof name !== 'string' || name === '') return null;
  const last = name.split('/').pop() ?? name;
  if (last === 'mayor') return 'mayor';
  if (last === 'desk') return 'desk';
  return null;
}

function sessionWho(session: SessionLike): 'desk' | 'mayor' | null {
  return agentOf(session.alias) ?? agentOf(session.agent_name) ?? agentOf(session.template);
}

// ---- the hook --------------------------------------------------------------

export function useCardChat(city: string, card: ChatCard, sessions: readonly SessionLike[] = NONE): CardChat {
  const [thread, setThread] = useState<ThreadEntry[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [bound, setBound] = useState<'desk' | 'mayor' | null>(null);
  const lastSeq = useRef<number | undefined>(undefined);
  const reading = useRef(false);
  const readAgain = useRef(false);
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const live = useRef(true);
  const threadRef = useRef(thread);
  threadRef.current = thread;
  const cardRef = useRef(card);
  cardRef.current = card;
  const key = cardKey(city, card.id);

  const all = useSyncExternalStore(subscribe, snapshot, snapshot);
  const local = useMemo(() => all.filter((t) => t.city === city && t.cardId === card.id), [all, city, card.id]);
  const localRef = useRef(local);
  localRef.current = local;

  // Review I6: who a session is, from the sessions the board reads.
  const [lookedTick, setLookedTick] = useState(0);
  const whoBySession = useMemo(() => {
    const m = new Map<string, 'desk' | 'mayor'>();
    for (const s of looked.values()) {
      const w = s === null ? null : sessionWho(s);
      if (s !== null && w !== null) m.set(s.id, w);
    }
    for (const s of sessions) {
      const w = sessionWho(s);
      if (w !== null) m.set(s.id, w);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, lookedTick]);
  const whoRef = useRef(whoBySession);
  whoRef.current = whoBySession;

  // Re-review R2: a reply from a session the board no longer lists (a respawned
  // Mayor) is looked up once by id, so its author and buttons stay right.
  useEffect(() => {
    for (const e of thread) {
      const sid = e.source;
      if (e.who === 'owner' || sid === undefined || whoBySession.has(sid) || looked.has(sid) || looking.has(sid)) continue;
      looking.add(sid);
      lookupSession(city, sid).then(
        (s) => {
          looking.delete(sid);
          looked.set(sid, s);
          if (live.current) setLookedTick((n) => n + 1);
        },
        () => {
          // lane D R8: only a 404 is final; a failed lookup is tried again on the next thread change
          looking.delete(sid);
        },
      );
    }
  }, [thread, whoBySession, city]);

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
        setStatus('ready'); // review M4: a good read clears an earlier error
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

  // The abnormal path: turns the service accepted but the transcript does not show.
  const check = useCallback(() => {
    checkTimer.current = null;
    const seen = new Set(threadRef.current.map((e) => e.providerMessageId));
    const waiting = localRef.current.filter((l) => l.state === 'queued' && !seen.has(l.clientId));
    if (waiting.length === 0) return;
    getPending(city, cardRef.current.id).then(
      (items) => {
        if (!live.current) return;
        const byId = new Map(items.map((i) => [i.clientId, i]));
        for (const l of waiting) {
          const item = byId.get(l.clientId);
          if (item !== undefined) patchTurn(l.clientId, { state: pendingState(item), origin: 'service' });
        }
        // not pending any more: delivered, the transcript will show it
        if (waiting.some((l) => !byId.has(l.clientId))) refresh();
        // review I2: keep checking while a turn is still on its way
        if (waiting.some((l) => byId.get(l.clientId)?.state !== 'failed')) scheduleCheck();
      },
      () => {
        if (live.current) scheduleCheck();
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city, refresh]);

  const scheduleCheck = useCallback(() => {
    if (checkTimer.current !== null || !live.current) return;
    checkTimer.current = setTimeout(check, DELIVERY_CHECK_MS);
  }, [check]);

  // Mount (and card change): history, the service's pending turns, who holds the chat.
  useEffect(() => {
    live.current = true;
    noChat.delete(key); // re-review R1: a new mount asks again
    lastSeq.current = undefined;
    reading.current = true;
    readAgain.current = false;
    setThread([]);
    setStatus('loading');
    setBound(null);
    Promise.all([
      readThread(city, card.id),
      getPending(city, card.id).catch(() => null),
      readBinding(city, card.id).catch(() => null),
    ]).then(
      ([entries, pending, binding]) => {
        reading.current = false;
        if (!live.current) return;
        applyThread(entries);
        if (binding !== null) {
          const w = agentOf(binding.agent) ?? (binding.sessionId !== null ? (whoRef.current.get(binding.sessionId) ?? null) : null);
          if (w !== null) setBound(w);
        }
        const seen = new Set(entries.map((e) => e.providerMessageId).filter((id): id is string => id !== undefined));
        if (pending !== null) {
          const byId = new Map(pending.map((p) => [p.clientId, p]));
          let next = turns.filter((t) => !seen.has(t.clientId));
          next = next.map((t) => {
            if (t.city !== city || t.cardId !== card.id) return t;
            const item = byId.get(t.clientId);
            if (item !== undefined) {
              const state = pendingState(item);
              const held: StoredTurn = { ...t, state, origin: 'service' };
              return state === 'failed' ? withFailedAt(held) : { ...held, failedAt: undefined };
            }
            // a reloaded send whose answer never came, and the service does not hold it
            if (t.state === 'sending' && !inFlight.has(t.clientId)) {
              return { ...t, state: 'failed' as const, origin: 'local' as const, failedAt: new Date().toISOString() };
            }
            return t;
          });
          const known = new Set(next.map((t) => t.clientId));
          for (const p of pending) {
            if (seen.has(p.clientId) || known.has(p.clientId)) continue;
            // sent from another tab or device: the service keeps no text
            const turn: StoredTurn = { clientId: p.clientId, city, cardId: card.id, rig: card.rig, text: '', at: '', state: pendingState(p), origin: 'service' };
            next = [...next, turn.state === 'failed' ? withFailedAt(turn) : turn];
          }
          setTurns(next);
        }
        setStatus('ready');
        if (turns.some((t) => t.city === city && t.cardId === card.id && t.state === 'queued')) scheduleCheck();
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
    // refresh/applyThread/scheduleCheck are stable for a given city and card
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city, card.id]);

  // Delivered turns leave the registry.
  useEffect(() => {
    const seen = new Set(thread.map((e) => e.providerMessageId).filter((id): id is string => id !== undefined));
    if (turns.some((t) => seen.has(t.clientId))) setTurns(turns.filter((t) => !seen.has(t.clientId)));
  }, [thread]);

  const matches = useCallback((event: GcEventEnvelope) => {
    if (!CHAT_EVENTS.has(event.type)) return false;
    const payload = event.payload;
    if (payload?.provider !== BOARD_PROVIDER || payload.conversation_id !== cardRef.current.id) return false;
    if (event.type === 'extmsg.bound') {
      const name = typeof payload.agent_name === 'string' ? payload.agent_name : null;
      const sid = typeof payload.session_id === 'string' ? payload.session_id : null;
      const next = agentOf(name) ?? (sid !== null ? (whoRef.current.get(sid) ?? null) : null);
      setBound(next ?? (name !== null && name !== '' ? 'desk' : null));
    }
    return true;
  }, []);

  const conn = useGcEventRefresh(['extmsg.'], refresh, { matches, coalesceMs: EVENT_COALESCE_MS });

  // Review I3: a reconnected stream does not replay the gap; read it.
  const lastConn = useRef(conn);
  const wasOpen = useRef(conn === 'open');
  useEffect(() => {
    const prev = lastConn.current;
    lastConn.current = conn;
    if (conn !== 'open') return;
    if (wasOpen.current && prev !== 'open' && status !== 'loading') refresh();
    wasOpen.current = true;
  }, [conn, refresh, status]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && live.current) refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  const sendWith = useCallback(
    (text: string, replyTo?: string) => {
      const turn: StoredTurn = {
        clientId: newClientId(),
        city,
        cardId: cardRef.current.id,
        rig: cardRef.current.rig,
        text,
        ...(replyTo !== undefined ? { replyTo } : {}),
        at: new Date().toISOString(),
        state: 'sending',
        origin: 'local',
      };
      setTurns([...turns, turn]);
      deliver(turn, () => {
        if (live.current) scheduleCheck();
      });
    },
    [city, scheduleCheck],
  );

  const send = useCallback((text: string) => sendWith(text), [sendWith]);

  const answer = useCallback((entryId: string, yes: boolean) => sendWith(yes ? 'Да' : 'Нет', entryId), [sendWith]);

  const retry = useCallback(
    (clientId: string) => {
      const turn = turns.find((l) => l.clientId === clientId);
      if (turn === undefined || turn.state !== 'failed') return;
      if (turn.origin === 'local') {
        deliver({ ...turn, state: 'sending' }, () => {
          if (live.current) scheduleCheck();
        });
        return;
      }
      retryTurn(city, clientId).then(
        () => {
          patchTurn(clientId, { state: 'queued', error: undefined, failedAt: undefined });
          if (live.current) scheduleCheck();
        },
        (err: unknown) => {
          // not_failed: delivered, unknown or still waiting — the transcript and the check decide
          if (err instanceof BoardChatError && err.code === 'not_failed') {
            patchTurn(clientId, { state: 'queued', error: undefined, failedAt: undefined });
            if (live.current) {
              refresh();
              scheduleCheck();
            }
          }
        },
      );
    },
    [city, refresh, scheduleCheck],
  );

  // Who holds the chat: the bound event, else the Mayor while his ask is open (I5), else the desk.
  // Lane D R9: a source not known yet and not settled by a 404 is neutral until its lookup answers.
  const sourceWho = useCallback(
    (e: ThreadEntry): 'desk' | 'mayor' | 'city' => {
      if (e.source === undefined) return 'desk';
      return whoBySession.get(e.source) ?? (looked.has(e.source) ? 'desk' : 'city');
    },
    [whoBySession],
  );
  const who = useMemo<'desk' | 'mayor'>(() => {
    if (bound !== null) return bound;
    const last = [...thread].reverse().find((e) => e.who !== 'owner');
    if (last !== undefined && last.ask && sourceWho(last) === 'mayor') {
      const answered = thread.some((e) => e.who === 'owner' && e.replyTo === last.id);
      if (!answered) return 'mayor';
    }
    return 'desk';
  }, [bound, thread, sourceWho]);

  // HOST cause 5: the stream is needed only while this card awaits a reply
  // («читает», «другой вопрос») or while the Mayor holds it («Мэр работает»).
  const hidden = useHiddenPaused();
  const awaitingReply =
    thread.at(-1)?.who === 'owner' ||
    local.some((l) => l.state !== 'failed' && !thread.some((e) => e.providerMessageId === l.clientId));
  const sessionState = useStructuredSessionStream(!hidden && (who === 'mayor' || awaitingReply) ? who : null, true);
  const activity = sessionState.status === 'ready' ? sessionState.result.activity : 'unknown';
  const agentActivity: CardChat['agentActivity'] =
    activity === 'in-turn' ? 'in-turn' : activity === 'idle' ? 'idle' : 'unknown';
  // D3 live check 19.11: «busy with another card» is read from the turn's own
  // prompt, never inferred from «busy and nothing here is being read».
  const items = sessionState.status === 'ready' ? sessionState.result.items : null;
  const turnCards = useMemo(() => (items === null ? null : currentTurnCards(items)), [items]);
  const agentOnOtherCard = agentActivity === 'in-turn' && turnCards !== null && !turnCards.includes(card.id);

  const delivered = useMemo(
    () => new Set(thread.map((e) => e.providerMessageId).filter((id): id is string => id !== undefined)),
    [thread],
  );

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
          state: e.id === awaiting && agentActivity === 'in-turn' && !agentOnOtherCard ? 'reading' : 'delivered',
          at: e.at,
        };
      }
      // review I6: the author and the buttons come from the source session only
      const author = sourceWho(e);
      return {
        key: e.id,
        who: author,
        text: e.text,
        ...(e.ask && author === 'mayor' ? { ask: { entryId: e.id, answered: answered.has(e.id) } } : {}),
        at: e.at,
      };
    });
    for (const l of local) {
      if (delivered.has(l.clientId)) continue;
      out.push({
        key: l.clientId,
        who: 'owner',
        text: l.text,
        state: l.state,
        ...(l.state === 'failed'
          ? {
              // not_own_card: a new card may enter the frame (re-review R1)
              retryable: l.origin === 'service' || l.error === 'not_own_card' || isRetryable(l.error ?? 'failed'), ...(l.error !== undefined ? { error: l.error } : {}) }
          : {}),
        at: l.at,
      });
    }
    return out;
  }, [thread, local, delivered, agentActivity, agentOnOtherCard, sourceWho]);

  // re-review R1: the no-chat mark lasts a minute; re-render when it ends
  const until = noChat.get(key) ?? 0;
  const [, setNow] = useState(0);
  useEffect(() => {
    if (until <= Date.now()) return;
    const timer = setTimeout(() => setNow(Date.now()), until - Date.now());
    return () => clearTimeout(timer);
  }, [until]);
  const chatless = all !== null && until > Date.now();

  return { rows, send, retry, answer, status: chatless ? 'no_chat' : status, who, agentActivity, agentOnOtherCard };
}

// The engine delivers a card turn into the agent's session as a reminder that
// names the conversation (api.formatExtmsgNotifyReminder): «New message in
// shared conversation board/<card id>:». Several queued turns can share one
// prompt, so every match counts.
const BOARD_CONVERSATION = new RegExp(`New message in shared conversation ${BOARD_PROVIDER}/([^\\s:]+):`, 'g');

/**
 * The cards the agent's current turn serves: the board conversations named by
 * the newest prompt in its transcript (a user message with text, not a tool
 * result). Null when unknown: no prompt, or a prompt that names no card.
 */
export function currentTurnCards(items: readonly StructuredStreamItem[]): string[] | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item === undefined || item.kind !== 'message' || item.message.role !== 'user') continue;
    const blocks = item.message.blocks;
    if (blocks.some((b) => b.type === 'tool_result')) continue;
    const text = blocks.map((b) => (b.type === 'text' ? (b.text ?? '') : '')).join('\n');
    if (text.trim() === '') continue;
    const cards = [...text.matchAll(BOARD_CONVERSATION)].map((m) => m[1]!);
    return cards.length > 0 ? cards : null;
  }
  return null;
}
