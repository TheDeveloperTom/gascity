import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setActiveCity } from '../api/cityBase';
import { setReauth } from '../embed/activitySession';
import {
  CommentWriteError,
  commentErrorText,
  markTopicRead,
  postCardMessage,
  postTopicAction,
} from './peerCommentWrites';

// vk-final part 4: the person's writes are Mayor-topic actions only (owner
// 15.11: no human comments on cards), through the city service's /svc route.
// The engine refuses a /svc mutation without `X-GC-Request`.

const fetchMock = vi.fn();
function json(payload: unknown, status = 201): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  setActiveCity('test-city');
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function lastCall(): { url: string; init: RequestInit; body: Record<string, unknown> } {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return { url, init, body: JSON.parse(String(init.body)) as Record<string, unknown> };
}

describe('peer topic writes', () => {
  // The city's final contract (topics-report.md «Final dashboard contract»):
  // one route per action under /v1/topics, the same header gate as comments.
  const BASE = '/v0/city/test-city/svc/peer-boards/v1/topics';

  // sync/topics c664ac8f: a person writes under ANY card with one call; the
  // city opens the card's topic or posts into it (opened true|false).
  it('the card box POSTs /v1/topics/card-message {card, text} with the header gate', async () => {
    fetchMock.mockResolvedValue(json({ opened: true, topic: { topic_id: 'tp-2' }, message: { id: 'te-1' } }));
    const out = await postCardMessage({ city: 'rich', rig: 'crm-api', id: 'dw-ab12' }, 'Когда?');
    const { url, init, body } = lastCall();
    expect(url).toBe(`${BASE}/card-message`);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['X-GC-Request']).toBe('1');
    expect(body).toEqual({ card: { city: 'rich', rig: 'crm-api', id: 'dw-ab12' }, text: 'Когда?' });
    expect(out).toEqual({ opened: true });
  });

  it('`to` picks the peer for our own card', async () => {
    fetchMock.mockResolvedValue(json({ opened: false, topic: {}, message: {} }));
    await postCardMessage({ city: 'me', rig: 'devwork', id: 'dw-1' }, 'Кто возьмёт?', 'bob');
    expect(lastCall().body).toEqual({ card: { city: 'me', rig: 'devwork', id: 'dw-1' }, text: 'Кто возьмёт?', to: 'bob' });
  });

  it('a card not on its owner’s board is bad_card, in plain words', async () => {
    fetchMock.mockResolvedValue(json({ error: 'bad_card' }, 400));
    const err = await postCardMessage({ city: 'rich', rig: 'devwork', id: 'dw-1' }, 'x').catch((e: unknown) => e);
    expect((err as CommentWriteError).code).toBe('bad_card');
    expect(commentErrorText(err)).toBe('The card is no longer on the other board.');
  });

  it('each person action has its own route and body (message, resolve, continue)', async () => {
    fetchMock.mockResolvedValue(json({ topic: {} }));
    const target = { city: 'rich', topicId: 'tp-1' };
    await postTopicAction(target, { action: 'message', text: 'вмешиваюсь' });
    expect(lastCall().url).toBe(`${BASE}/message`);
    expect(lastCall().body).toEqual({ city: 'rich', topic_id: 'tp-1', text: 'вмешиваюсь' });
    await postTopicAction(target, { action: 'resolve', reason: 'resolved', summary: 'договорились' });
    expect(lastCall().url).toBe(`${BASE}/resolve`);
    expect(lastCall().body).toEqual({ city: 'rich', topic_id: 'tp-1', reason: 'resolved', summary: 'договорились' });
    await postTopicAction(target, {
      action: 'resolve',
      reason: 'duplicate',
      summary: 'то же, что tp-0',
      decidingMessageId: 'te-9',
    });
    expect(lastCall().body).toEqual({
      city: 'rich',
      topic_id: 'tp-1',
      reason: 'duplicate',
      summary: 'то же, что tp-0',
      deciding_message_id: 'te-9',
    });
    await postTopicAction(target, { action: 'continue' });
    expect(lastCall().url).toBe(`${BASE}/continue`);
    expect(lastCall().body).toEqual({ city: 'rich', topic_id: 'tp-1' });
  });

  it('a read stamp POSTs /v1/topics/read {city, topic_id, at}', async () => {
    fetchMock.mockResolvedValue(json({ ok: true }, 200));
    await markTopicRead({ city: 'rich', topicId: 'tp-1' }, '2026-11-15T18:52:00Z');
    expect(lastCall().url).toBe(`${BASE}/read`);
    expect(lastCall().body).toEqual({ city: 'rich', topic_id: 'tp-1', at: '2026-11-15T18:52:00Z' });
  });

  it('topic refusals keep their code and get plain text', async () => {
    const target = { city: 'rich', topicId: 'tp-1' };
    for (const [status, code] of [
      [409, 'needs_human'],
      [409, 'resolved'],
      [429, 'too_soon'],
      [429, 'topic_cap'],
      [400, 'too_long'],
    ] as const) {
      fetchMock.mockResolvedValueOnce(json({ error: code }, status));
      const err = await postTopicAction(target, { action: 'message', text: 'x' }).catch((e: unknown) => e);
      expect((err as CommentWriteError).code).toBe(code);
      expect(commentErrorText(err)).not.toBe('Not sent — try again.');
    }
  });

  it('403 forbidden / 405 mean writes are switched off; a bare 404 is not_found', async () => {
    const target = { city: 'rich', topicId: 'tp-1' };
    fetchMock.mockResolvedValueOnce(json({ error: 'forbidden' }, 403));
    const off = await postTopicAction(target, { action: 'continue' }).catch((e: unknown) => e);
    expect(off).toBeInstanceOf(CommentWriteError);
    expect((off as CommentWriteError).code).toBe('disabled');
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 405 }));
    const off2 = await postTopicAction(target, { action: 'continue' }).catch((e: unknown) => e);
    expect((off2 as CommentWriteError).code).toBe('disabled');
    fetchMock.mockResolvedValueOnce(json({ error: 'not_found' }, 404));
    const gone = await postTopicAction(target, { action: 'continue' }).catch((e: unknown) => e);
    expect((gone as CommentWriteError).code).toBe('not_found');
    expect(commentErrorText(new CommentWriteError('topic_cap'))).toBe('Too many messages — try again in a minute.');
  });

  it('inside the Activity, a 401 session_invalid re-signs in once and retries (review M-11)', async () => {
    const reauth = vi.fn(async () => undefined);
    setReauth(reauth);
    fetchMock
      .mockResolvedValueOnce(json({ error: 'session_invalid' }, 401))
      .mockResolvedValueOnce(json({ message: {} }, 201));
    await postTopicAction({ city: 'rich', topicId: 'tp-1' }, { action: 'message', text: 'x' });
    expect(reauth).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    setReauth(null);
  });

  it('an empty text never reaches the network', async () => {
    const out = await postTopicAction({ city: 'rich', topicId: 'tp-1' }, { action: 'message', text: '   ' }).catch(
      (e: unknown) => e,
    );
    expect((out as CommentWriteError).code).toBe('empty');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
