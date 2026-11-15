import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setActiveCity } from '../api/cityBase';
import {
  CommentWriteError,
  commentErrorText,
  markTopicRead,
  postCardComment,
  postTopicEvent,
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

  it('a topic event names the topic owner city and the event', async () => {
    fetchMock.mockResolvedValue(json({ ok: true }));
    await postTopicEvent({ city: 'rich', topicId: 'tp-1' }, { event: 'topic_message', text: 'вмешиваюсь' });
    expect(lastCall().body).toEqual({
      target: { kind: 'topic', city: 'rich', topic_id: 'tp-1' },
      event: 'topic_message',
      text: 'вмешиваюсь',
    });
    await postTopicEvent({ city: 'rich' }, { event: 'topic_open', title: 'Тема', text: 'Первое' });
    expect(lastCall().body).toEqual({
      target: { kind: 'topic', city: 'rich' },
      event: 'topic_open',
      title: 'Тема',
      text: 'Первое',
    });
  });

  it('a read stamp is {kind: read, topic_id, at}', async () => {
    fetchMock.mockResolvedValue(json({ ok: true }, 200));
    await markTopicRead('tp-1', '2026-11-15T18:52:00Z');
    expect(lastCall().body).toEqual({ kind: 'read', topic_id: 'tp-1', at: '2026-11-15T18:52:00Z' });
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
