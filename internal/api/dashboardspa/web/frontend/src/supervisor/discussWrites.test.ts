import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setActiveCity } from '../api/cityBase';
import { postDiscuss } from './discussWrites';
import { CommentWriteError } from './peerCommentWrites';

// B10 (16.11): «Обсудить с Мэром» tells the Mayor through our own city
// service: POST peer-boards /v1/discuss {kind, id, title, summary}; the city
// runs `gc devwork owner discuss` (mail to mayor, notify, dedup) and answers
// 200 {url}. Same header gate as the topic writes.

const fetchMock = vi.fn();
function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  setActiveCity('test-city');
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const URL_OK = 'https://discord.com/channels/1/2';
const ctx = { kind: 'task' as const, beadId: 'dw-ab12', title: 'T', summary: 'S' };

describe('postDiscuss', () => {
  it('POSTs /v1/discuss {kind:bead, id, title, summary} with X-GC-Request and resolves the url', async () => {
    fetchMock.mockResolvedValue(json({ url: URL_OK }));
    const out = await postDiscuss(ctx);
    const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toBe('/v0/city/test-city/svc/peer-boards/v1/discuss');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['X-GC-Request']).toBe('1');
    expect(JSON.parse(String(init.body))).toEqual({
      kind: 'bead',
      id: 'dw-ab12',
      title: 'T',
      summary: 'S',
    });
    expect(out).toBe(URL_OK);
  });

  it('maps a need to kind "needs"', async () => {
    fetchMock.mockResolvedValue(json({ url: URL_OK }));
    await postDiscuss({ ...ctx, kind: 'need' });
    const [, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect((JSON.parse(String(init.body)) as Record<string, unknown>).kind).toBe('needs');
  });

  it('403 forbidden is disabled', async () => {
    fetchMock.mockResolvedValue(json({ error: 'forbidden' }, 403));
    const err = await postDiscuss(ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CommentWriteError);
    expect((err as CommentWriteError).code).toBe('disabled');
  });

  it('502 discuss_failed is failed', async () => {
    fetchMock.mockResolvedValue(json({ error: 'discuss_failed' }, 502));
    const err = await postDiscuss(ctx).catch((e: unknown) => e);
    expect((err as CommentWriteError).code).toBe('failed');
  });

  it('a 200 {ok, chat_url} also resolves the url; a bare 200 resolves null', async () => {
    fetchMock.mockResolvedValue(json({ ok: true, chat_url: URL_OK }));
    expect(await postDiscuss(ctx)).toBe(URL_OK);
    fetchMock.mockResolvedValue(json({ ok: true }));
    expect(await postDiscuss(ctx)).toBeNull();
  });

  it('a 400 bad_request is failed, not a topic error code', async () => {
    fetchMock.mockResolvedValue(json({ error: 'bad_request' }, 400));
    const err = await postDiscuss(ctx).catch((e: unknown) => e);
    expect((err as CommentWriteError).code).toBe('failed');
  });
});
