import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { HIDDEN_PAUSE_MS } from '../lib/hiddenPause';
import { BoardChatError, type Binding, type PendingItem, type ThreadEntry } from '../supervisor/boardChat';
import type { GcEventConnState, GcEventEnvelope, GcEventRefreshOptions } from './useGcEvents';

// BOARD-CHAT Task C3: rows and states from native signals (C6, DC#24-26),
// plus the lane C review fixes (I1, I2, I3, I5, I6, M1, M4, M5, Q3).

const api = vi.hoisted(() => ({
  sendTurn: vi.fn(),
  getPending: vi.fn(),
  retryTurn: vi.fn(),
  readThread: vi.fn(),
  readBinding: vi.fn(),
  lookupSession: vi.fn(),
}));

vi.mock('../supervisor/boardChat', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../supervisor/boardChat')>();
  return { ...actual, ...api };
});

const events = vi.hoisted(() => ({
  prefixes: [] as ReadonlyArray<string>,
  onMatch: (() => {}) as () => void,
  options: {} as GcEventRefreshOptions,
  state: 'open' as GcEventConnState,
}));

vi.mock('./useGcEvents', () => ({
  useGcEventRefresh: (prefixes: ReadonlyArray<string>, onMatch: () => void, options: GcEventRefreshOptions = {}) => {
    events.prefixes = prefixes;
    events.onMatch = onMatch;
    events.options = options;
    return events.state;
  },
}));

const stream = vi.hoisted(() => ({ sessions: [] as (string | null)[], activity: 'idle', items: [] as unknown[] }));

vi.mock('./useStructuredSessionStream', () => ({
  useStructuredSessionStream: (sessionId: string | null) => {
    stream.sessions.push(sessionId);
    // as the real hook: no session, no stream, no activity
    if (sessionId === null) return { status: 'idle', stream: { status: 'idle' } };
    return {
      status: 'ready',
      result: { provider: 'claude', template: 'desk', history: null, items: stream.items, activity: stream.activity },
      stream: { status: 'open' },
    };
  },
}));

import { resetCardChatForTests, useCardChat, type SessionLike } from './useCardChat';

const CARD = { rig: 'dw', id: 'dw-1' };
const SESSIONS: SessionLike[] = [
  { id: 's-desk', template: 'desk' },
  { id: 's-mayor', template: 'mayor' },
];
const ID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

function entry(over: Partial<ThreadEntry>): ThreadEntry {
  return { id: 'e1', seq: 1, at: '2026-11-19T15:00:00Z', who: 'owner', text: 'вопрос', ask: false, ...over };
}
const desk = (over: Partial<ThreadEntry>) => entry({ who: 'desk', source: 's-desk', ...over });
const mayor = (over: Partial<ThreadEntry>) => entry({ who: 'mayor', source: 's-mayor', ...over });

function fire(event: GcEventEnvelope) {
  if (!events.prefixes.some((p) => event.type.startsWith(p))) return;
  if (events.options.matches?.(event) ?? true) events.onMatch();
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
}

let uuid = 0;

beforeEach(() => {
  uuid = 0;
  window.localStorage.clear();
  resetCardChatForTests();
  vi.stubGlobal('crypto', { randomUUID: () => ID(++uuid) });
  api.sendTurn.mockReset().mockResolvedValue(undefined);
  api.getPending.mockReset().mockResolvedValue([]);
  api.retryTurn.mockReset().mockResolvedValue(undefined);
  api.readThread.mockReset().mockResolvedValue([]);
  api.readBinding.mockReset().mockResolvedValue(null);
  api.lookupSession.mockReset().mockResolvedValue(null);
  stream.sessions = [];
  stream.activity = 'idle';
  stream.items = [];
  events.state = 'open';
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function mount(thread: ThreadEntry[] = [], pending: PendingItem[] = [], binding: Binding | null = null) {
  api.readThread.mockResolvedValueOnce(thread);
  api.getPending.mockResolvedValueOnce(pending);
  api.readBinding.mockResolvedValueOnce(binding);
  const hook = renderHook(() => useCardChat('devwork', CARD, SESSIONS));
  await flush();
  return hook;
}

describe('useCardChat', () => {
  it('send adds an owner row with state sending synchronously', async () => {
    api.sendTurn.mockReturnValue(new Promise(() => {}));
    const { result } = await mount();
    act(() => result.current.send('что это?'));
    const row = result.current.rows.at(-1)!;
    expect(row).toMatchObject({ who: 'owner', text: 'что это?', state: 'sending' });
    await flush();
    expect(api.sendTurn).toHaveBeenCalledWith('devwork', CARD, 'что это?', ID(1), undefined);
  });

  it('row becomes queued on 202 and delivered when its client_id appears in the thread', async () => {
    const { result } = await mount();
    act(() => result.current.send('что это?'));
    await flush();
    expect(result.current.rows.at(-1)!.state).toBe('queued');
    api.readThread.mockResolvedValueOnce([entry({ id: 'e1', seq: 1, text: 'что это?', providerMessageId: ID(1) })]);
    act(() => fire({ type: 'extmsg.inbound', payload: { provider: 'board', conversation_id: 'dw-1' } }));
    await flush();
    expect(result.current.rows).toHaveLength(1);
    expect(result.current.rows[0]).toMatchObject({ key: 'e1', state: 'delivered', text: 'что это?' });
  });

  it('extmsg.outbound for this card triggers one thread read after last seq', async () => {
    const { result } = await mount([entry({ id: 'e1', seq: 4 })]);
    expect(api.readThread).toHaveBeenCalledTimes(1);
    expect(events.prefixes).toEqual(['extmsg.']);
    api.readThread.mockResolvedValueOnce([desk({ id: 'e2', seq: 5, text: 'Это вход.' })]);
    act(() => fire({ type: 'extmsg.outbound', payload: { provider: 'board', conversation_id: 'dw-1', message_id: 'm' } }));
    await flush();
    expect(api.readThread).toHaveBeenCalledTimes(2);
    expect(api.readThread).toHaveBeenLastCalledWith('devwork', 'dw-1', 4);
    expect(result.current.rows.map((r) => r.text)).toEqual(['вопрос', 'Это вход.']);
    expect(result.current.rows[1]!.who).toBe('desk');
  });

  it('events of other cards or providers are ignored', async () => {
    await mount();
    act(() => fire({ type: 'extmsg.outbound', payload: { provider: 'board', conversation_id: 'dw-2' } }));
    act(() => fire({ type: 'extmsg.outbound', payload: { provider: 'discord', conversation_id: 'dw-1' } }));
    act(() => fire({ type: 'extmsg.adapter_added', payload: { provider: 'board' } }));
    await flush();
    expect(api.readThread).toHaveBeenCalledTimes(1);
  });

  it('reading while bound agent is in-turn and this card awaits a reply', async () => {
    stream.activity = 'in-turn';
    const { result, rerender } = await mount([entry({ id: 'e1', seq: 1, providerMessageId: 'c-1' })]);
    expect(stream.sessions.at(-1)).toBe('desk');
    expect(result.current.agentActivity).toBe('in-turn');
    expect(result.current.rows[0]!.state).toBe('reading');
    api.readThread.mockResolvedValueOnce([desk({ id: 'e2', seq: 2, text: 'ответ' })]);
    act(() => fire({ type: 'extmsg.outbound', payload: { provider: 'board', conversation_id: 'dw-1' } }));
    await flush();
    rerender();
    expect(result.current.rows[0]!.state).toBe('delivered');
  });

  // D3 live check 19.11: «Дежурный отвечает на другой вопрос» was guessed from
  // «busy and nothing here is being read». The current turn's card is in the
  // prompt the engine wrote into the desk's transcript (extmsg reminder:
  // «New message in shared conversation board/<card>:»).
  const prompt = (id: string, text: string) => ({
    kind: 'message',
    message: { id, role: 'user', status: 'final', blocks: [{ type: 'text', text }] },
  });
  const boardPrompt = (id: string, card: string) =>
    prompt(id, `<system-reminder>\nNew message in shared conversation board/${card}:\n\n- Артём (human): вопрос\n</system-reminder>`);
  const toolStep = (id: string) => ({
    kind: 'message',
    message: { id, role: 'assistant', status: 'final', stop_reason: 'tool_use', blocks: [{ type: 'tool_use', name: 'Bash' }] },
  });
  const toolResult = (id: string) => ({
    kind: 'message',
    message: { id, role: 'user', status: 'final', blocks: [{ type: 'tool_result', content: 'board/dw-9 ok' }] },
  });

  it('the desk is on another card only when its current turn names another card', async () => {
    stream.activity = 'in-turn';
    stream.items = [boardPrompt('u1', 'dw-1'), toolStep('a1'), boardPrompt('u2', 'dw-2'), toolStep('a2'), toolResult('t2')];
    const { result } = await mount([entry({ id: 'e1', seq: 1 })]);
    expect(result.current.agentOnOtherCard).toBe(true);
    // this card awaits a reply, but the desk is provably reading another one
    expect(result.current.rows[0]!.state).toBe('delivered');
  });

  it('this card’s own turn is not «another question»', async () => {
    stream.activity = 'in-turn';
    stream.items = [boardPrompt('u1', 'dw-2'), toolStep('a1'), boardPrompt('u2', 'dw-1'), toolStep('a2')];
    const { result } = await mount([
      entry({ id: 'e1', seq: 1 }),
      desk({ id: 'e2', seq: 2, text: 'ответ' }),
      entry({ id: 'e3', seq: 3, text: 'поправка' }),
    ]);
    expect(result.current.agentActivity).toBe('in-turn');
    expect(result.current.agentOnOtherCard).toBe(false);
    expect(result.current.rows.at(-1)!.state).toBe('reading');
  });

  // BOARD-CHAT D3 live check 19.11 (HOST cause 5): each open card held the
  // desk's session stream, a third long-lived connection per tab; with two
  // tabs the six HTTP/1.1 connections per host were gone and POST /v1/send
  // never started. The stream is only needed while a reply is awaited (or
  // the Mayor holds the chat), and never in a tab hidden past the grace time.
  describe('the agent stream only while it is needed', () => {
    it('no session stream while nothing awaits a reply', async () => {
      await mount([entry({ id: 'e1', seq: 1 }), desk({ id: 'e2', seq: 2, text: 'ответ' })]);
      expect(stream.sessions.at(-1)).toBeNull();
      await mount();
      expect(stream.sessions.at(-1)).toBeNull();
    });

    it('a sent turn opens the desk stream; the answer closes it', async () => {
      const { result } = await mount();
      act(() => result.current.send('что это?'));
      await flush();
      expect(stream.sessions.at(-1)).toBe('desk');
      api.readThread.mockResolvedValueOnce([
        entry({ id: 'e1', seq: 1, text: 'что это?', providerMessageId: ID(1) }),
        desk({ id: 'e2', seq: 2, text: 'Это вход.' }),
      ]);
      act(() => fire({ type: 'extmsg.outbound', payload: { provider: 'board', conversation_id: 'dw-1' } }));
      await flush();
      expect(stream.sessions.at(-1)).toBeNull();
    });

    it('a failed turn does not hold the stream', async () => {
      api.sendTurn.mockRejectedValueOnce(new BoardChatError('failed'));
      const { result } = await mount();
      act(() => result.current.send('что это?'));
      await flush();
      expect(result.current.rows.at(-1)!.state).toBe('failed');
      expect(stream.sessions.at(-1)).toBeNull();
    });

    // Review of PR #5 (finding 1): who holds the chat was read only at mount
    // and from live extmsg.bound events; one sent while the tab was paused
    // was lost. Shown again, the card re-reads the binding.
    it('a Mayor take-over or release while hidden is read when the tab is shown', async () => {
      const setVisible = (visible: boolean) => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (visible ? 'visible' : 'hidden') });
        act(() => {
          document.dispatchEvent(new Event('visibilitychange'));
        });
      };
      onTestFinished(() => setVisible(true));
      const { result } = await mount([entry({ id: 'e1', seq: 1 }), desk({ id: 'e2', seq: 2, text: 'ответ' })]);
      expect(result.current.who).toBe('desk');

      setVisible(false);
      api.readBinding.mockResolvedValueOnce({ agent: 'mayor', sessionId: 's-mayor' });
      setVisible(true);
      await flush();
      expect(result.current.who).toBe('mayor');
      expect(stream.sessions.at(-1)).toBe('mayor');

      setVisible(false);
      api.readBinding.mockResolvedValueOnce({ agent: 'desk', sessionId: 's-desk' });
      setVisible(true);
      await flush();
      expect(result.current.who).toBe('desk');
      // nothing awaits a reply: the Mayor's session stream is closed, the desk's is not opened
      expect(stream.sessions.at(-1)).toBeNull();
    });

    it('a tab hidden past the grace time closes it; shown again it reopens', async () => {
      const setHidden = (hidden: boolean) => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
        act(() => {
          document.dispatchEvent(new Event('visibilitychange'));
        });
      };
      onTestFinished(() => setHidden(false));
      const { rerender } = await mount([entry({ id: 'e1', seq: 1 })]);
      expect(stream.sessions.at(-1)).toBe('desk');
      vi.useFakeTimers();
      setHidden(true);
      act(() => {
        vi.advanceTimersByTime(HIDDEN_PAUSE_MS);
      });
      rerender();
      expect(stream.sessions.at(-1)).toBeNull();
      setHidden(false);
      rerender();
      expect(stream.sessions.at(-1)).toBe('desk');
    });
  });

  it('an unknown current turn claims nothing', async () => {
    stream.activity = 'in-turn';
    stream.items = [boardPrompt('u1', 'dw-2'), toolStep('a1'), prompt('u2', 'проверь очередь'), toolStep('a2')];
    const { result } = await mount([entry({ id: 'e1', seq: 1 }), desk({ id: 'e2', seq: 2, text: 'ответ' })]);
    expect(result.current.agentOnOtherCard).toBe(false);
    stream.items = [];
    const empty = await mount([entry({ id: 'e1', seq: 1 }), desk({ id: 'e2', seq: 2, text: 'ответ' })]);
    expect(empty.result.current.agentOnOtherCard).toBe(false);
  });

  it('an idle desk is on no card', async () => {
    stream.items = [boardPrompt('u1', 'dw-2'), toolStep('a1')];
    const { result } = await mount([entry({ id: 'e1', seq: 1 })]);
    expect(result.current.agentOnOtherCard).toBe(false);
  });

  it('extmsg.bound naming mayor switches who and the activity stream', async () => {
    const { result } = await mount();
    expect(result.current.who).toBe('desk');
    act(() =>
      fire({ type: 'extmsg.bound', payload: { provider: 'board', conversation_id: 'dw-1', agent_name: 'mayor', session_id: 's-9' } }),
    );
    await flush();
    expect(result.current.who).toBe('mayor');
    expect(stream.sessions.at(-1)).toBe('mayor');
    act(() =>
      fire({ type: 'extmsg.bound', payload: { provider: 'board', conversation_id: 'dw-1', agent_name: 'desk', session_id: 's-1' } }),
    );
    await flush();
    expect(result.current.who).toBe('desk');
  });

  it('no delivery within 15 s asks getPending and shows retrying or failed', async () => {
    const { result } = await mount();
    vi.useFakeTimers();
    act(() => result.current.send('первый'));
    act(() => result.current.send('второй'));
    await flush();
    expect(result.current.rows.map((r) => r.state)).toEqual(['queued', 'queued']);
    api.getPending.mockResolvedValueOnce([
      { clientId: ID(1), state: 'retrying', attempts: 3, lastError: 'city-not-found', nextAt: null },
      { clientId: ID(2), state: 'failed', attempts: 1, lastError: 'no_route', nextAt: null },
    ]);
    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });
    await flush();
    expect(api.getPending).toHaveBeenLastCalledWith('devwork', 'dw-1');
    expect(result.current.rows.map((r) => r.state)).toEqual(['queued', 'failed']);
    await act(async () => {
      result.current.retry(ID(2));
    });
    await flush();
    expect(api.retryTurn).toHaveBeenCalledWith('devwork', ID(2));
    expect(result.current.rows[1]!.state).toBe('queued');
  });

  it('review I2: the check re-arms while a turn stays undelivered: retrying at 15 s, failed at 30 s', async () => {
    const { result } = await mount();
    vi.useFakeTimers();
    act(() => result.current.send('закрой её'));
    await flush();
    api.getPending
      .mockResolvedValueOnce([{ clientId: ID(1), state: 'retrying', attempts: 2, lastError: 'city-not-found', nextAt: null }])
      .mockResolvedValueOnce([{ clientId: ID(1), state: 'failed', attempts: 5, lastError: 'no_route', nextAt: null }]);
    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });
    await flush();
    expect(result.current.rows[0]!.state).toBe('queued');
    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });
    await flush();
    expect(result.current.rows[0]).toMatchObject({ state: 'failed', retryable: true });
  });

  it('a send the service never accepted is re-sent with the same id on retry', async () => {
    api.sendTurn.mockRejectedValueOnce(new BoardChatError('failed'));
    const { result } = await mount();
    act(() => result.current.send('вопрос'));
    await flush();
    expect(result.current.rows[0]).toMatchObject({ state: 'failed', retryable: true });
    act(() => result.current.retry(ID(1)));
    await flush();
    expect(api.sendTurn).toHaveBeenCalledTimes(2);
    expect(api.sendTurn).toHaveBeenLastCalledWith('devwork', CARD, 'вопрос', ID(1), undefined);
    expect(result.current.rows[0]!.state).toBe('queued');
  });

  it('review I1: unmount during a pending send, the send fails, remount shows the failed row with its text', async () => {
    let reject!: (e: unknown) => void;
    api.sendTurn.mockReturnValueOnce(new Promise((_, rej) => (reject = rej)));
    const first = await mount();
    act(() => first.result.current.send('закрой её'));
    await flush();
    first.unmount();
    await act(async () => {
      reject(new BoardChatError('failed'));
    });
    const { result } = await mount();
    expect(result.current.rows).toHaveLength(1);
    expect(result.current.rows[0]).toMatchObject({ who: 'owner', text: 'закрой её', state: 'failed', retryable: true });
  });

  it('review I1/M2: after a reload a turn the service still holds keeps its text; one that never reached it is failed', async () => {
    window.localStorage.setItem(
      'gc.board-chat.turns.v1',
      JSON.stringify([
        { clientId: 'c-7', city: 'devwork', cardId: 'dw-1', rig: 'dw', text: 'долго ещё?', at: 't', state: 'queued', origin: 'local' },
        { clientId: 'c-8', city: 'devwork', cardId: 'dw-1', rig: 'dw', text: 'закрой её', at: 't', state: 'sending', origin: 'local' },
        { clientId: 'c-9', city: 'devwork', cardId: 'dw-2', rig: 'dw', text: 'другая', at: 't', state: 'queued', origin: 'local' },
      ]),
    );
    resetCardChatForTests();
    const { result } = await mount([], [{ clientId: 'c-7', state: 'retrying', attempts: 2, lastError: null, nextAt: null }]);
    expect(result.current.rows.map((r) => [r.key, r.text, r.state])).toEqual([
      ['c-7', 'долго ещё?', 'queued'],
      ['c-8', 'закрой её', 'failed'],
    ]);
  });

  it('a delivered turn leaves the registry', async () => {
    const { result } = await mount();
    act(() => result.current.send('вопрос'));
    await flush();
    api.readThread.mockResolvedValueOnce([entry({ id: 'e1', seq: 1, providerMessageId: ID(1) })]);
    act(() => fire({ type: 'extmsg.inbound', payload: { provider: 'board', conversation_id: 'dw-1' } }));
    await flush();
    expect(window.localStorage.getItem('gc.board-chat.turns.v1')).toBe('[]');
  });

  it('review M1: a refusal that cannot pass is failed without retry, with its code', async () => {
    api.sendTurn.mockRejectedValueOnce(new BoardChatError('too_long'));
    const { result } = await mount();
    act(() => result.current.send('длинно'));
    await flush();
    expect(result.current.rows[0]).toMatchObject({ state: 'failed', error: 'too_long', retryable: false });
  });

  it('review Q3: not_own_card turns the chat into the plain no-chat state', async () => {
    api.sendTurn.mockRejectedValueOnce(new BoardChatError('not_own_card', 'not_in_frame'));
    const { result } = await mount();
    act(() => result.current.send('что это?'));
    await flush();
    expect(result.current.status).toBe('no_chat');
  });

  it('re-review R1: a 409 not_own_card keeps the refused words in a failed row; the next mount clears no-chat', async () => {
    api.sendTurn.mockRejectedValueOnce(new BoardChatError('not_own_card', 'not_in_frame'));
    const first = await mount();
    act(() => first.result.current.send('что это за карточка?'));
    await flush();
    expect(first.result.current.status).toBe('no_chat');
    expect(first.result.current.rows).toHaveLength(1);
    expect(first.result.current.rows[0]).toMatchObject({
      text: 'что это за карточка?',
      state: 'failed',
      error: 'not_own_card',
      // a new card gets this 409 until the frame catches up: «повторить» may pass then
      retryable: true,
    });
    first.unmount();
    const { result } = await mount();
    expect(result.current.status).toBe('ready');
    expect(result.current.rows[0]).toMatchObject({ text: 'что это за карточка?', state: 'failed', error: 'not_own_card' });
  });

  it('re-review R1: the no-chat state clears after a minute', async () => {
    api.sendTurn.mockRejectedValueOnce(new BoardChatError('not_own_card', 'not_in_frame'));
    const { result } = await mount();
    vi.useFakeTimers();
    act(() => result.current.send('что это?'));
    await flush();
    expect(result.current.status).toBe('no_chat');
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current.status).toBe('ready');
  });

  it('re-review R2: an open ask from a Mayor session the board no longer lists keeps «Мэр» and its buttons', async () => {
    api.lookupSession.mockResolvedValue({ id: 's-old', template: 'mayor' });
    const { result, rerender } = await mount([entry({ id: 'e1', seq: 1 }), entry({ id: 'e2', seq: 2, who: 'desk', source: 's-old', text: 'Закрыть?', ask: true })]);
    await flush();
    expect(api.lookupSession).toHaveBeenCalledWith('devwork', 's-old');
    expect(result.current.rows[1]).toMatchObject({ who: 'mayor', ask: { entryId: 'e2', answered: false } });
    expect(result.current.who).toBe('mayor');
    rerender();
    await flush();
    // once per id
    expect(api.lookupSession).toHaveBeenCalledTimes(1);
  });

  it('lane D R9: while an unknown source is being looked up, the row is neutral and has no buttons', async () => {
    api.lookupSession.mockReturnValue(new Promise(() => {}));
    const { result } = await mount([entry({ id: 'e2', seq: 2, who: 'mayor', source: 's-x', text: 'Закрыть?', ask: true })]);
    expect(api.lookupSession).toHaveBeenCalledWith('devwork', 's-x');
    expect(result.current.rows[0]).toMatchObject({ who: 'city' });
    expect(result.current.rows[0]!.ask).toBeUndefined();
  });

  it('re-review R2: a source the city does not know (404) is labelled «Дежурный» and has no buttons', async () => {
    const { result } = await mount([entry({ id: 'e2', seq: 2, who: 'mayor', source: 's-x', text: 'Закрыть?', ask: true })]);
    expect(api.lookupSession).toHaveBeenCalledWith('devwork', 's-x');
    expect(result.current.rows[0]).toMatchObject({ who: 'desk' });
    expect(result.current.rows[0]!.ask).toBeUndefined();
  });

  it('lane D R8: a lookup that failed (not a 404) is tried again on the next thread change', async () => {
    api.lookupSession.mockRejectedValueOnce(new Error('network')).mockResolvedValue({ id: 's-old', template: 'mayor' });
    const ask = entry({ id: 'e2', seq: 2, who: 'desk', source: 's-old', text: 'Закрыть?', ask: true });
    const { result } = await mount([ask]);
    expect(api.lookupSession).toHaveBeenCalledTimes(1);
    expect(result.current.rows[0]!.ask).toBeUndefined();
    api.readThread.mockResolvedValueOnce([desk({ id: 'e3', seq: 3, text: 'ещё' })]);
    act(() => fire({ type: 'extmsg.outbound', payload: { provider: 'board', conversation_id: 'dw-1' } }));
    await flush();
    expect(api.lookupSession).toHaveBeenCalledTimes(2);
    expect(result.current.rows[0]).toMatchObject({ who: 'mayor', ask: { entryId: 'e2', answered: false } });
  });

  it('lane D R10: a failed turn ages from when it failed, not from when it was written', async () => {
    const day = 24 * 3600_000;
    const old = new Date(Date.now() - 3 * day).toISOString();
    const recent = new Date(Date.now() - 3600_000).toISOString();
    window.localStorage.setItem(
      'gc.board-chat.turns.v1',
      JSON.stringify([
        { clientId: 'c-1', city: 'devwork', cardId: 'dw-1', rig: 'dw', text: 'упало вчера', at: old, failedAt: recent, state: 'failed', origin: 'local' },
        { clientId: 'c-2', city: 'devwork', cardId: 'dw-1', rig: 'dw', text: 'упало давно', at: old, failedAt: old, state: 'failed', origin: 'local' },
        { clientId: 'c-3', city: 'devwork', cardId: 'dw-1', rig: 'dw', text: '', at: '', state: 'failed', origin: 'service' },
      ]),
    );
    resetCardChatForTests();
    const { result } = await mount([], [{ clientId: 'c-3', state: 'failed', attempts: 9, lastError: null, nextAt: null }]);
    expect(result.current.rows.map((r) => r.key)).toEqual(['c-1', 'c-3']);
    // a turn with no failure time (another device, or an older store) starts its day now
    const stored = JSON.parse(window.localStorage.getItem('gc.board-chat.turns.v1')!) as { clientId: string; failedAt?: string }[];
    expect(Date.parse(stored.find((t) => t.clientId === 'c-3')!.failedAt!)).toBeGreaterThan(Date.now() - 60_000);
  });

  it('lane D R10: a send that fails records when it failed', async () => {
    api.sendTurn.mockRejectedValueOnce(new BoardChatError('failed'));
    const { result } = await mount();
    act(() => result.current.send('вопрос'));
    await flush();
    expect(result.current.rows.at(-1)!.state).toBe('failed');
    const stored = JSON.parse(window.localStorage.getItem('gc.board-chat.turns.v1')!) as { failedAt?: string }[];
    expect(Date.parse(stored[0]!.failedAt!)).toBeGreaterThan(Date.now() - 60_000);
  });

  it('re-review R6: a stored turn that failed over a day ago is dropped on load', async () => {
    const old = new Date(Date.now() - 2 * 24 * 3600_000).toISOString();
    const fresh = new Date().toISOString();
    window.localStorage.setItem(
      'gc.board-chat.turns.v1',
      JSON.stringify([
        { clientId: 'c-1', city: 'devwork', cardId: 'dw-1', rig: 'dw', text: 'старое', at: old, failedAt: old, state: 'failed', origin: 'local' },
        { clientId: 'c-2', city: 'devwork', cardId: 'dw-1', rig: 'dw', text: 'свежее', at: fresh, failedAt: fresh, state: 'failed', origin: 'local' },
        { clientId: 'c-3', city: 'devwork', cardId: 'dw-1', rig: 'dw', text: 'в очереди', at: old, state: 'queued', origin: 'local' },
      ]),
    );
    resetCardChatForTests();
    const { result } = await mount([], [{ clientId: 'c-3', state: 'retrying', attempts: 9, lastError: null, nextAt: null }]);
    expect(result.current.rows.map((r) => r.text)).toEqual(['свежее', 'в очереди']);
  });

  it('review M5: two quick sends reach the service in order, one after the other', async () => {
    let resolveFirst!: () => void;
    api.sendTurn.mockReturnValueOnce(new Promise<void>((res) => (resolveFirst = res)));
    const { result } = await mount();
    act(() => result.current.send('вопрос'));
    act(() => result.current.send('не часы, а минуты'));
    await flush();
    expect(api.sendTurn).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveFirst();
    });
    await flush();
    expect(api.sendTurn).toHaveBeenCalledTimes(2);
    expect(api.sendTurn.mock.calls[1]![2]).toBe('не часы, а минуты');
  });

  it('review I3: after the event stream reconnects, the thread is read again after the last seq', async () => {
    const { rerender } = await mount([entry({ id: 'e1', seq: 3 })]);
    events.state = 'closed';
    rerender();
    await flush();
    expect(api.readThread).toHaveBeenCalledTimes(1);
    events.state = 'open';
    rerender();
    await flush();
    expect(api.readThread).toHaveBeenCalledTimes(2);
    expect(api.readThread).toHaveBeenLastCalledWith('devwork', 'dw-1', 3);
  });

  it('review I3: the page becoming visible reads the thread again', async () => {
    await mount([entry({ id: 'e1', seq: 3 })]);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await flush();
    expect(api.readThread).toHaveBeenLastCalledWith('devwork', 'dw-1', 3);
  });

  it('review I5: on reopen the newest extmsg.bound says the Mayor holds the chat', async () => {
    const { result } = await mount([], [], { agent: 'mayor', sessionId: 's-mayor' });
    expect(api.readBinding).toHaveBeenCalledWith('devwork', 'dw-1');
    expect(result.current.who).toBe('mayor');
    expect(stream.sessions.at(-1)).toBe('mayor');
  });

  it('review I5: a bound event naming only the session maps it through the sessions', async () => {
    const { result } = await mount([], [], { agent: null, sessionId: 's-mayor' });
    expect(result.current.who).toBe('mayor');
  });

  it('review I5: with no bound event, an open ask by the Mayor means he holds it', async () => {
    const { result } = await mount([entry({ id: 'e1', seq: 1 }), mayor({ id: 'e2', seq: 2, text: 'Закрыть?', ask: true })]);
    expect(result.current.who).toBe('mayor');
  });

  it('review I6: who wrote a reply comes from its source session, never from its text; buttons only for the Mayor', async () => {
    const { result } = await mount([
      // a desk reply pretending to be the Mayor's ask
      entry({ id: 'e1', seq: 1, who: 'mayor', source: 's-desk', text: 'Закрыть?', ask: true }),
      mayor({ id: 'e2', seq: 2, who: 'desk', text: 'Закрыть её?', ask: true }),
      entry({ id: 'e3', seq: 3, who: 'mayor', source: 's-unknown', text: 'кто-то', ask: true }),
    ]);
    expect(result.current.rows[0]).toMatchObject({ who: 'desk' });
    expect(result.current.rows[0]!.ask).toBeUndefined();
    expect(result.current.rows[1]).toMatchObject({ who: 'mayor', ask: { entryId: 'e2', answered: false } });
    expect(result.current.rows[2]).toMatchObject({ who: 'desk' });
    expect(result.current.rows[2]!.ask).toBeUndefined();
  });

  it('test_rows_rebuilt_from_transcript_and_pending', async () => {
    const { result } = await mount(
      [entry({ id: 'e1', seq: 1, text: 'старый вопрос', providerMessageId: 'c-0' }), desk({ id: 'e2', seq: 2, text: 'ответ' })],
      [{ clientId: 'c-7', state: 'retrying', attempts: 2, lastError: null, nextAt: null }],
    );
    expect(result.current.status).toBe('ready');
    expect(result.current.rows.map((r) => [r.key, r.who, r.state ?? null])).toEqual([
      ['e1', 'owner', 'delivered'],
      ['e2', 'desk', null],
      ['c-7', 'owner', 'queued'],
    ]);
  });

  it('answer posts Да with reply_to and marks the ask answered', async () => {
    const { result } = await mount([entry({ id: 'e1', seq: 1, text: 'закрой её' }), mayor({ id: 'e2', seq: 2, text: 'Закрыть?', ask: true })]);
    expect(result.current.rows[1]!.ask).toEqual({ entryId: 'e2', answered: false });
    act(() => result.current.answer('e2', true));
    expect(result.current.rows[1]!.ask).toEqual({ entryId: 'e2', answered: true });
    expect(result.current.rows.at(-1)).toMatchObject({ who: 'owner', text: 'Да', state: 'sending' });
    await flush();
    expect(api.sendTurn).toHaveBeenCalledWith('devwork', CARD, 'Да', ID(1), 'e2');
  });

  it('an ask already answered in the thread shows no buttons', async () => {
    const { result } = await mount([mayor({ id: 'e2', seq: 2, text: 'Закрыть?', ask: true }), entry({ id: 'e3', seq: 3, text: 'Нет', replyTo: 'e2' })]);
    expect(result.current.rows[0]!.ask).toEqual({ entryId: 'e2', answered: true });
  });

  it('a failed first read is status error; a later good read makes it ready (review M4)', async () => {
    api.readThread.mockRejectedValueOnce(new Error('503'));
    const { result } = renderHook(() => useCardChat('devwork', CARD, SESSIONS));
    await flush();
    expect(result.current.status).toBe('error');
    api.readThread.mockResolvedValueOnce([entry({ id: 'e1', seq: 1 })]);
    act(() => fire({ type: 'extmsg.outbound', payload: { provider: 'board', conversation_id: 'dw-1' } }));
    await flush();
    expect(result.current.status).toBe('ready');
    expect(result.current.rows).toHaveLength(1);
  });
});
