import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setActiveCity } from '../api/cityBase';
import {
  CommentWriteError,
  commentErrorText,
  markTopicRead,
  openTopic,
  postCardComment,
  postTopicAction,
} from './peerCommentWrites';

// vk-final part 4: the one write path, the city service's
// `POST /v0/city/<city>/svc/peer-boards/v1/comments` (COMMENTS-PLAN «Write»).
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

describe('peer comment writes', () => {
  it('a card comment POSTs the target and text with X-GC-Request', async () => {
    fetchMock.mockResolvedValue(
      json({ comment: { id: 'xc-1', text: 'привет', created_at: '2026-11-15T19:00:00Z', state: 'queued' } }),
    );
    const out = await postCardComment({ city: 'rich', rig: 'crm-api', id: 'dw-ab12' }, 'привет');
    const { url, init, body } = lastCall();
    expect(url).toBe('/v0/city/test-city/svc/peer-boards/v1/comments');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['X-GC-Request']).toBe('1');
    expect(headers['Content-Type']).toBe('application/json');
    expect(body).toEqual({ target: { kind: 'card', city: 'rich', rig: 'crm-api', id: 'dw-ab12' }, text: 'привет' });
    expect(out).toMatchObject({ id: 'xc-1', state: 'queued' });
  });

  // The city's final contract (topics-report.md «Final dashboard contract»):
  // one route per action under /v1/topics, the same header gate as comments.
  const BASE = '/v0/city/test-city/svc/peer-boards/v1/topics';

  it('opening a topic POSTs /v1/topics {to, title, text}', async () => {
    fetchMock.mockResolvedValue(json({ topic: { topic_id: 'tp-1' } }));
    await openTopic('rich', 'Тема', 'Первое');
    const { url, init, body } = lastCall();
    expect(url).toBe(BASE);
    expect((init.headers as Record<string, string>)['X-GC-Request']).toBe('1');
    expect(body).toEqual({ to: 'rich', title: 'Тема', text: 'Первое' });
  });

  it('each action has its own route and body', async () => {
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
    for (const action of ['pause', 'continue', 'reopen'] as const) {
      await postTopicAction(target, { action });
      expect(lastCall().url).toBe(`${BASE}/${action}`);
      expect(lastCall().body).toEqual({ city: 'rich', topic_id: 'tp-1' });
    }
    await postTopicAction(target, { action: 'react', messageId: 'te-3' });
    expect(lastCall().url).toBe(`${BASE}/react`);
    expect(lastCall().body).toEqual({ city: 'rich', topic_id: 'tp-1', message_id: 'te-3' });
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

  it('errors carry the service code; 403/405 mean comments are switched off', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'rate_limited' }, 429));
    const limited = await postCardComment({ city: 'rich', rig: 'devwork', id: 'dw-1' }, 'x').catch((e: unknown) => e);
    expect(limited).toBeInstanceOf(CommentWriteError);
    expect((limited as CommentWriteError).code).toBe('rate_limited');
    fetchMock.mockResolvedValueOnce(json({ error: 'forbidden' }, 403));
    const off = await postCardComment({ city: 'rich', rig: 'devwork', id: 'dw-1' }, 'x').catch((e: unknown) => e);
    expect((off as CommentWriteError).code).toBe('disabled');
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 405 }));
    const off2 = await postCardComment({ city: 'rich', rig: 'devwork', id: 'dw-1' }, 'x').catch((e: unknown) => e);
    expect((off2 as CommentWriteError).code).toBe('disabled');
    fetchMock.mockResolvedValueOnce(json({ error: 'card_not_found' }, 404));
    const gone = await postCardComment({ city: 'rich', rig: 'devwork', id: 'dw-1' }, 'x').catch((e: unknown) => e);
    expect((gone as CommentWriteError).code).toBe('card_not_found');
    expect(commentErrorText(new CommentWriteError('rate_limited'))).toBe('Too many messages — try again in a minute.');
  });

  it('an empty text never reaches the network', async () => {
    const out = await postCardComment({ city: 'rich', rig: 'devwork', id: 'dw-1' }, '   ').catch((e: unknown) => e);
    expect((out as CommentWriteError).code).toBe('empty');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
