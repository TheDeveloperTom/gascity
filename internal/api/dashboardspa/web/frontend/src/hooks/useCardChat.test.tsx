import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingItem, ThreadEntry } from '../supervisor/boardChat';
import type { GcEventEnvelope, GcEventRefreshOptions } from './useGcEvents';

// BOARD-CHAT Task C3: rows and states from native signals (C6, DC#24-26).

const api = vi.hoisted(() => ({
  sendTurn: vi.fn(),
  getPending: vi.fn(),
  retryTurn: vi.fn(),
  readThread: vi.fn(),
}));

vi.mock('../supervisor/boardChat', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../supervisor/boardChat')>();
  return { ...actual, ...api };
});

const events = vi.hoisted(() => ({
  prefixes: [] as ReadonlyArray<string>,
  onMatch: (() => {}) as () => void,
  options: {} as GcEventRefreshOptions,
}));

vi.mock('./useGcEvents', () => ({
  useGcEventRefresh: (prefixes: ReadonlyArray<string>, onMatch: () => void, options: GcEventRefreshOptions = {}) => {
    events.prefixes = prefixes;
    events.onMatch = onMatch;
    events.options = options;
    return 'open';
  },
}));

const stream = vi.hoisted(() => ({ sessions: [] as (string | null)[], activity: 'idle' }));

vi.mock('./useStructuredSessionStream', () => ({
  useStructuredSessionStream: (sessionId: string | null) => {
    stream.sessions.push(sessionId);
    return {
      status: 'ready',
      result: { provider: 'claude', template: 'desk', history: null, items: [], activity: stream.activity },
      stream: { status: 'open' },
    };
  },
}));

import { useCardChat } from './useCardChat';

const CARD = { rig: 'dw', id: 'dw-1' };

function entry(over: Partial<ThreadEntry>): ThreadEntry {
  return { id: 'e1', seq: 1, at: '2026-11-19T15:00:00Z', who: 'owner', text: 'вопрос', ask: false, ...over };
}

function fire(event: GcEventEnvelope) {
  if (!events.prefixes.some((p) => event.type.startsWith(p))) return;
  if (events.options.matches?.(event) ?? true) events.onMatch();
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

let uuid = 0;

beforeEach(() => {
  uuid = 0;
  vi.stubGlobal('crypto', { randomUUID: () => `00000000-0000-4000-8000-00000000000${++uuid}` });
  api.sendTurn.mockReset().mockResolvedValue(undefined);
  api.getPending.mockReset().mockResolvedValue([]);
  api.retryTurn.mockReset().mockResolvedValue(undefined);
  api.readThread.mockReset().mockResolvedValue([]);
  stream.sessions = [];
  stream.activity = 'idle';
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function mount(thread: ThreadEntry[] = [], pending: PendingItem[] = []) {
  api.readThread.mockResolvedValueOnce(thread);
  api.getPending.mockResolvedValueOnce(pending);
  const hook = renderHook(() => useCardChat('devwork', CARD));
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
    expect(api.sendTurn).toHaveBeenCalledWith('devwork', CARD, 'что это?', '00000000-0000-4000-8000-000000000001', undefined);
  });

  it('row becomes queued on 202 and delivered when its client_id appears in the thread', async () => {
    const { result } = await mount();
    act(() => result.current.send('что это?'));
    await flush();
    expect(result.current.rows.at(-1)!.state).toBe('queued');
    api.readThread.mockResolvedValueOnce([
      entry({ id: 'e1', seq: 1, text: 'что это?', providerMessageId: '00000000-0000-4000-8000-000000000001' }),
    ]);
    act(() => fire({ type: 'extmsg.inbound', payload: { provider: 'board', conversation_id: 'dw-1' } }));
    await flush();
    expect(result.current.rows).toHaveLength(1);
    expect(result.current.rows[0]).toMatchObject({ key: 'e1', state: 'delivered', text: 'что это?' });
  });

  it('extmsg.outbound for this card triggers one thread read after last seq', async () => {
    const { result } = await mount([entry({ id: 'e1', seq: 4 })]);
    expect(api.readThread).toHaveBeenCalledTimes(1);
    expect(events.prefixes).toEqual(['extmsg.']);
    api.readThread.mockResolvedValueOnce([entry({ id: 'e2', seq: 5, who: 'desk', text: 'Это вход.' })]);
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
    // once answered, the owner row is plain delivered
    api.readThread.mockResolvedValueOnce([entry({ id: 'e2', seq: 2, who: 'desk', text: 'ответ' })]);
    act(() => fire({ type: 'extmsg.outbound', payload: { provider: 'board', conversation_id: 'dw-1' } }));
    await flush();
    rerender();
    expect(result.current.rows[0]!.state).toBe('delivered');
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
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.rows.map((r) => r.state)).toEqual(['queued', 'queued']);
    api.getPending.mockResolvedValueOnce([
      { clientId: '00000000-0000-4000-8000-000000000001', state: 'retrying', attempts: 3, lastError: 'city-not-found', nextAt: null },
      { clientId: '00000000-0000-4000-8000-000000000002', state: 'failed', attempts: 1, lastError: 'no_route', nextAt: null },
    ]);
    await act(async () => {
      vi.advanceTimersByTime(15_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.getPending).toHaveBeenLastCalledWith('devwork', 'dw-1');
    expect(result.current.rows.map((r) => r.state)).toEqual(['queued', 'failed']);
    // «повторить» on a failed turn asks the service to requeue the same id
    await act(async () => {
      result.current.retry('00000000-0000-4000-8000-000000000002');
      await Promise.resolve();
    });
    expect(api.retryTurn).toHaveBeenCalledWith('devwork', '00000000-0000-4000-8000-000000000002');
    expect(result.current.rows[1]!.state).toBe('queued');
  });

  it('a send the service never accepted is re-sent with the same id on retry', async () => {
    api.sendTurn.mockRejectedValueOnce(new Error('offline'));
    const { result } = await mount();
    act(() => result.current.send('вопрос'));
    await flush();
    expect(result.current.rows[0]!.state).toBe('failed');
    act(() => result.current.retry('00000000-0000-4000-8000-000000000001'));
    expect(api.sendTurn).toHaveBeenCalledTimes(2);
    expect(api.sendTurn).toHaveBeenLastCalledWith('devwork', CARD, 'вопрос', '00000000-0000-4000-8000-000000000001', undefined);
    await flush();
    expect(result.current.rows[0]!.state).toBe('queued');
  });

  it('test_rows_rebuilt_from_transcript_and_pending', async () => {
    const { result } = await mount(
      [entry({ id: 'e1', seq: 1, text: 'старый вопрос', providerMessageId: 'c-0' }), entry({ id: 'e2', seq: 2, who: 'desk', text: 'ответ' })],
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
    const { result } = await mount([
      entry({ id: 'e1', seq: 1, text: 'закрой её' }),
      entry({ id: 'e2', seq: 2, who: 'mayor', text: 'Закрыть?', ask: true }),
    ]);
    expect(result.current.rows[1]!.ask).toEqual({ entryId: 'e2', answered: false });
    act(() => result.current.answer('e2', true));
    expect(api.sendTurn).toHaveBeenCalledWith('devwork', CARD, 'Да', '00000000-0000-4000-8000-000000000001', 'e2');
    expect(result.current.rows[1]!.ask).toEqual({ entryId: 'e2', answered: true });
    expect(result.current.rows.at(-1)).toMatchObject({ who: 'owner', text: 'Да', state: 'sending' });
  });

  it('an ask already answered in the thread shows no buttons', async () => {
    const { result } = await mount([
      entry({ id: 'e2', seq: 2, who: 'mayor', text: 'Закрыть?', ask: true }),
      entry({ id: 'e3', seq: 3, text: 'Нет', replyTo: 'e2' }),
    ]);
    expect(result.current.rows[0]!.ask).toEqual({ entryId: 'e2', answered: true });
  });

  it('a failed first read is status error', async () => {
    api.readThread.mockRejectedValueOnce(new Error('503'));
    const { result } = renderHook(() => useCardChat('devwork', CARD));
    await flush();
    expect(result.current.status).toBe('error');
  });
});
