// ACTIVITY-PLAN Task 6 — Discord Embedded App SDK bootstrap. The SDK is
// mocked at its package boundary; the gateway is a stubbed fetch.
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  constructed: [] as string[],
  order: [] as string[],
  instanceId: 'inst-1',
  ready: vi.fn(async () => undefined),
  authorize: vi.fn(async (_a: unknown) => ({ code: 'code-1' })),
  authenticate: vi.fn(async (_a: unknown) => ({ user: { id: 'u' } })),
  openExternalLink: vi.fn(async (_a: unknown) => ({ opened: true })),
}));

vi.mock('@discord/embedded-app-sdk', () => ({
  DiscordSDK: class {
    instanceId = m.instanceId;
    commands = {
      authorize: (a: unknown) => {
        m.order.push('authorize');
        return m.authorize(a);
      },
      authenticate: (a: unknown) => {
        m.order.push('authenticate');
        return m.authenticate(a);
      },
      openExternalLink: (a: unknown) => m.openExternalLink(a),
    };
    constructor(clientId: string) {
      m.constructed.push(clientId);
    }
    ready() {
      m.order.push('ready');
      return m.ready();
    }
  },
}));

import { authHeaders, resetActivityPlumbingForTests } from '../lib/apiBase';
import { openExternal } from '../lib/openExternal';
import { answerQuestion as answerQuestionWire, discussWithMayor } from '../lib/discussWithMayor';
import { answerQuestion as answerQuestionUi } from '../lib/answerQuestion';
import { DiscussButton } from '../vk/DiscussButton';
import { api } from '../api/client';
import { bootActivity, runActivityBoot, ActivityNoAccessError } from './activitySdk';
import { canWrite, getActivityRole } from './activitySession';
import { AnswerRefusedError, answerErrorText } from '../lib/discussWithMayor';
import { fetchOpenQuestions } from './activityQuestions';

const QID = '0123456789abcdef01234567';
const SECRET_TOKEN = 'discord-access-token-SENTINEL';

type Reply = { status: number; body: unknown };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** A fake gateway: token replies come from `tokens` in order, other routes from `routes`. */
function gateway(opts: {
  tokens?: Reply[];
  routes?: Record<string, Reply[]>;
}) {
  const tokens = [...(opts.tokens ?? [tokenOk('S1', 'owner')])];
  const routes: Record<string, Reply[]> = {};
  for (const [k, v] of Object.entries(opts.routes ?? {})) routes[k] = [...v];
  const calls: Array<{ url: string; headers: Record<string, string>; body: unknown; method: string }> = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req =
      input instanceof Request ? input : new Request(new URL(String(input), 'http://127.0.0.1/'), init);
    const url = new URL(req.url, 'http://127.0.0.1/').pathname;
    const headers: Record<string, string> = {};
    req.headers.forEach((v, k) => {
      headers[k] = v;
    });
    const text = req.method === 'GET' ? '' : await req.text();
    calls.push({ url, headers, method: req.method, body: text ? JSON.parse(text) : undefined });
    if (url === '/api/activity/token') {
      m.order.push('token');
      const r = tokens.shift() ?? { status: 500, body: {} };
      return json(r.status, r.body);
    }
    const queue = routes[url];
    const r = queue?.shift() ?? { status: 404, body: {} };
    return json(r.status, r.body);
  });
  return { fetchMock, calls };
}

function tokenOk(session: string, role: 'owner' | 'reader'): Reply {
  return {
    status: 200,
    body: {
      session,
      access_token: SECRET_TOKEN,
      user_id: role === 'owner' ? '942312306421927956' : '555',
      role,
      expires_at: 9_999_999_999,
    },
  };
}

beforeEach(() => {
  m.constructed.length = 0;
  m.order.length = 0;
  m.instanceId = 'inst-1';
  m.ready.mockImplementation(async () => undefined);
  m.authorize.mockImplementation(async () => ({ code: 'code-1' }));
  m.authenticate.mockImplementation(async () => ({ user: { id: 'u' } }));
  m.openExternalLink.mockImplementation(async () => ({ opened: true }));
  m.authorize.mockClear();
  m.authenticate.mockClear();
  m.openExternalLink.mockClear();
  window.history.replaceState(null, '', '/?frame_id=f&instance_id=inst-1');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetActivityPlumbingForTests();
  window.history.replaceState(null, '', '/');
});

describe('bootActivity', () => {
  it('boot calls authorize then token then authenticate in order', async () => {
    const gw = gateway({});
    const who = await bootActivity('client-1', gw.fetchMock);
    expect(who).toEqual({ userId: '942312306421927956', role: 'owner' });
    expect(m.constructed).toEqual(['client-1']);
    expect(m.order).toEqual(['ready', 'authorize', 'token', 'authenticate']);
    expect(m.authorize).toHaveBeenCalledWith({
      client_id: 'client-1',
      response_type: 'code',
      state: '',
      prompt: 'none',
      scope: ['identify'],
    });
    expect(gw.calls[0]).toMatchObject({
      url: '/api/activity/token',
      method: 'POST',
      body: { code: 'code-1', instance_id: 'inst-1' },
    });
    expect(gw.calls[0]?.headers['content-type']).toBe('application/json');
    expect(m.authenticate).toHaveBeenCalledWith({ access_token: SECRET_TOKEN });
  });

  it('sets Bearer and instance headers', async () => {
    const gw = gateway({});
    await bootActivity('client-1', gw.fetchMock);
    expect(authHeaders()).toEqual({
      Authorization: 'Bearer S1',
      'X-Activity-Instance': 'inst-1',
    });
    // The Discord access token never lands in the request headers.
    expect(JSON.stringify(authHeaders())).not.toContain(SECRET_TOKEN);
  });

  it('external opener uses openExternalLink', async () => {
    const gw = gateway({});
    const winOpen = vi.spyOn(window, 'open').mockImplementation(() => null);
    await bootActivity('client-1', gw.fetchMock);
    openExternal('https://discord.com/channels/1/2/3');
    await Promise.resolve();
    expect(m.openExternalLink).toHaveBeenCalledWith({ url: 'https://discord.com/channels/1/2/3' });
    expect(winOpen).not.toHaveBeenCalled();
  });

  it('403 from token renders no-access and sets no headers', async () => {
    const gw = gateway({ tokens: [{ status: 403, body: { error: 'not_allowed' } }] });
    await expect(bootActivity('client-1', gw.fetchMock)).rejects.toBeInstanceOf(ActivityNoAccessError);
    expect(authHeaders()).toEqual({});
    expect(m.authenticate).not.toHaveBeenCalled();
    expect(getActivityRole()).toBeNull();

    resetActivityPlumbingForTests();
    window.history.replaceState(null, '', '/?frame_id=f');
    const gw2 = gateway({ tokens: [{ status: 403, body: { error: 'not_allowed' } }] });
    const root = document.createElement('div');
    await expect(runActivityBoot('client-1', root, gw2.fetchMock)).resolves.toBe(false);
    expect(root.textContent).toBe('Нет доступа');
    expect(authHeaders()).toEqual({});
  });

  it('a gateway failure renders a sign-in error and stops', async () => {
    const gw = gateway({ tokens: [{ status: 502, body: { error: 'discord_exchange_failed' } }] });
    const root = document.createElement('div');
    await expect(runActivityBoot('client-1', root, gw.fetchMock)).resolves.toBe(false);
    expect(root.textContent).toBe('Не удалось войти через Discord');
    expect(authHeaders()).toEqual({});
  });

  it('a missing client id never constructs the SDK', async () => {
    const gw = gateway({});
    const root = document.createElement('div');
    await expect(runActivityBoot('', root, gw.fetchMock)).resolves.toBe(false);
    expect(m.constructed).toEqual([]);
    expect(gw.fetchMock).not.toHaveBeenCalled();
  });

  it('authenticate INVALID_COMMAND does not throw out of boot', async () => {
    m.authenticate.mockImplementation(async () => {
      throw Object.assign(new Error('Invalid command'), { code: 4000 });
    });
    const gw = gateway({});
    await expect(bootActivity('client-1', gw.fetchMock)).resolves.toEqual({
      userId: '942312306421927956',
      role: 'owner',
    });
    expect(authHeaders().Authorization).toBe('Bearer S1');
  });

  it('never logs the access token', async () => {
    const spies = (['log', 'error', 'debug'] as const).map((k) =>
      vi.spyOn(console, k).mockImplementation(() => undefined),
    );
    m.authenticate.mockImplementation(async () => {
      throw new Error('Invalid command');
    });
    const gw = gateway({});
    await bootActivity('client-1', gw.fetchMock);
    for (const s of spies) {
      for (const call of s.mock.calls) expect(JSON.stringify(call)).not.toContain(SECRET_TOKEN);
    }
  });
});

describe('roles', () => {
  it('reader role hides answer and discuss', async () => {
    vi.stubEnv('VITE_MAYOR_DISCORD_URL', 'https://discord.com/channels/1/2');
    const gw = gateway({ tokens: [tokenOk('S1', 'reader')] });
    vi.stubGlobal('fetch', gw.fetchMock);
    await bootActivity('client-1', gw.fetchMock);
    expect(getActivityRole()).toBe('reader');
    expect(canWrite()).toBe(false);

    render(createElement(DiscussButton, { ctx: { kind: 'task', beadId: 'dw-1', title: 'T', summary: 'S' } }));
    expect(screen.queryByRole('button', { name: 'Обсудить в Discord' })).toBeNull();

    const before = gw.fetchMock.mock.calls.length;
    await expect(answerQuestionWire(QID, 0)).rejects.toThrow(/owner only/);
    await expect(
      discussWithMayor({ kind: 'task', beadId: 'dw-1', title: 'T', summary: 'S' }),
    ).rejects.toThrow(/owner only/);
    vi.spyOn(window, 'open').mockImplementation(() => null);
    answerQuestionUi({ questionId: QID, chatUrl: 'https://discord.com/channels/1/2/3' }, 1);
    await Promise.resolve();
    expect(gw.fetchMock.mock.calls.length).toBe(before);
  });

  it('owner sees the discuss button', async () => {
    const gw = gateway({});
    await bootActivity('client-1', gw.fetchMock);
    expect(canWrite()).toBe(true);
    render(createElement(DiscussButton, { ctx: { kind: 'task', beadId: 'dw-1', title: 'T', summary: 'S' } }));
    const btn = screen.getByRole('button', { name: 'Обсудить в Discord' });
    // In the Activity the gateway resolves the channel: no VITE_MAYOR_DISCORD_URL needed.
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('writes through the gateway', () => {
  it('owner answer posts {qid, choice} with the session headers', async () => {
    const gw = gateway({
      routes: { '/api/activity/answer': [{ status: 200, body: { outcome: 'answered', label: 'Да' } }] },
    });
    vi.stubGlobal('fetch', gw.fetchMock);
    await bootActivity('client-1', gw.fetchMock);
    await expect(answerQuestionWire(QID, 1)).resolves.toBeUndefined();
    const call = gw.calls.find((c) => c.url === '/api/activity/answer');
    expect(call).toMatchObject({ method: 'POST', body: { qid: QID, choice: 1 } });
    expect(call?.headers.authorization).toBe('Bearer S1');
    expect(call?.headers['x-activity-instance']).toBe('inst-1');
    expect(call?.headers['content-type']).toBe('application/json');
  });

  it('answer 409 rejects with «Уже отвечено», 403 «Только владелец», 502 an error', async () => {
    const gw = gateway({
      routes: {
        '/api/activity/answer': [
          { status: 409, body: { outcome: 'already_answered' } },
          { status: 403, body: { error: 'owner_only' } },
          { status: 502, body: { error: 'answer_failed' } },
        ],
      },
    });
    vi.stubGlobal('fetch', gw.fetchMock);
    await bootActivity('client-1', gw.fetchMock);
    const e409 = await answerQuestionWire(QID, 1).catch((e: unknown) => e);
    expect(e409).toBeInstanceOf(AnswerRefusedError);
    expect((e409 as AnswerRefusedError).status).toBe(409);
    expect(answerErrorText(e409)).toBe('Уже отвечено');
    const e403 = await answerQuestionWire(QID, 1).catch((e: unknown) => e);
    expect(answerErrorText(e403)).toBe('Только владелец');
    const e502 = await answerQuestionWire(QID, 1).catch((e: unknown) => e);
    expect(answerErrorText(e502)).toBe('Не удалось ответить');
  });

  it('discuss truncates title to 200 and summary to 1000 with «…»', async () => {
    const gw = gateway({
      routes: {
        '/api/activity/discuss': [
          { status: 200, body: { url: 'https://discord.com/channels/1/2/3' } },
          { status: 200, body: { url: 'https://discord.com/channels/1/2/3' } },
        ],
      },
    });
    vi.stubGlobal('fetch', gw.fetchMock);
    await bootActivity('client-1', gw.fetchMock);
    await discussWithMayor({ kind: 'task', beadId: 'dw-1', title: 'T'.repeat(200), summary: 'S'.repeat(1000) });
    await discussWithMayor({ kind: 'task', beadId: 'dw-1', title: 'T'.repeat(201), summary: 'S'.repeat(1500) });
    const [exact, long] = gw.calls.filter((c) => c.url === '/api/activity/discuss');
    expect(exact?.body).toEqual({ kind: 'bead', id: 'dw-1', title: 'T'.repeat(200), summary: 'S'.repeat(1000) });
    expect(long?.body).toEqual({
      kind: 'bead',
      id: 'dw-1',
      title: `${'T'.repeat(199)}…`,
      summary: `${'S'.repeat(999)}…`,
    });
  });

  it('discuss posts {kind, id, title, summary} and resolves to the Discord URL', async () => {
    const gw = gateway({
      routes: {
        '/api/activity/discuss': [
          { status: 200, body: { url: 'https://discord.com/channels/1/2/3' } },
          { status: 200, body: { url: 'https://evil.example/x' } },
        ],
      },
    });
    vi.stubGlobal('fetch', gw.fetchMock);
    await bootActivity('client-1', gw.fetchMock);
    await expect(
      discussWithMayor({ kind: 'need', beadId: 'dw-9', title: 'T'.repeat(300), summary: 'S' }),
    ).resolves.toBe('https://discord.com/channels/1/2/3');
    const call = gw.calls.find((c) => c.url === '/api/activity/discuss');
    expect(call?.body).toEqual({ kind: 'needs', id: 'dw-9', title: `${'T'.repeat(199)}…`, summary: 'S' });
    expect(call?.headers.authorization).toBe('Bearer S1');
    await expect(
      discussWithMayor({ kind: 'task', beadId: 'dw-9', title: 'T', summary: 'S' }),
    ).rejects.toThrow();
  });
});

describe('open questions read', () => {
  it('drops questions whose expires_at is in the past', async () => {
    const now = Date.parse('2026-11-15T12:00:00Z');
    const q = (qid: string, expires_at: unknown) => ({
      qid,
      question: 'Q?',
      choices: ['Да', 'Нет'],
      card: 'dw-1',
      expires_at,
      jump_url: 'https://discord.com/channels/1/2/3',
    });
    const gw = gateway({
      routes: {
        '/api/activity/questions': [
          {
            status: 200,
            body: [
              q('a'.repeat(24), '2026-11-15T13:00:00Z'),
              q('b'.repeat(24), '2026-11-15T11:00:00Z'),
              q('c'.repeat(24), ''), // unknown expiry: kept
              q('d'.repeat(24), '2026-11-15T11:59:59.999Z'),
              q('e'.repeat(24), 'not-a-date'), // unparseable: kept
            ],
          },
        ],
      },
    });
    vi.stubGlobal('fetch', gw.fetchMock);
    await bootActivity('client-1', gw.fetchMock);
    const open = await fetchOpenQuestions(now);
    expect(open.map((x) => x.qid)).toEqual(['a'.repeat(24), 'c'.repeat(24), 'e'.repeat(24)]);
    const call = gw.calls.find((c) => c.url === '/api/activity/questions');
    expect(call?.method).toBe('GET');
    expect(call?.headers.authorization).toBe('Bearer S1');
  });
});

describe('re-auth on session_invalid', () => {
  it('re-runs the silent sign-in once and retries with the new session', async () => {
    const gw = gateway({
      tokens: [tokenOk('S1', 'owner'), tokenOk('S2', 'owner')],
      routes: {
        '/api/activity/answer': [
          { status: 401, body: { error: 'session_invalid' } },
          { status: 200, body: { outcome: 'answered', label: 'Да' } },
        ],
      },
    });
    vi.stubGlobal('fetch', gw.fetchMock);
    await bootActivity('client-1', gw.fetchMock);
    await expect(answerQuestionWire(QID, 0)).resolves.toBeUndefined();
    expect(m.authorize).toHaveBeenCalledTimes(2);
    const answers = gw.calls.filter((c) => c.url === '/api/activity/answer');
    expect(answers.map((c) => c.headers.authorization)).toEqual(['Bearer S1', 'Bearer S2']);
    expect(authHeaders().Authorization).toBe('Bearer S2');
  });

  it('gives up after one retry', async () => {
    const gw = gateway({
      tokens: [tokenOk('S1', 'owner'), tokenOk('S2', 'owner')],
      routes: {
        '/api/activity/answer': [
          { status: 401, body: { error: 'session_invalid' } },
          { status: 401, body: { error: 'session_invalid' } },
        ],
      },
    });
    vi.stubGlobal('fetch', gw.fetchMock);
    await bootActivity('client-1', gw.fetchMock);
    await expect(answerQuestionWire(QID, 0)).rejects.toThrow(/401/);
    expect(m.authorize).toHaveBeenCalledTimes(2);
    expect(gw.calls.filter((c) => c.url === '/api/activity/answer')).toHaveLength(2);
  });

  it('a bare 401 (signature) does not re-auth', async () => {
    const gw = gateway({
      routes: { '/api/activity/answer': [{ status: 401, body: {} }] },
    });
    vi.stubGlobal('fetch', gw.fetchMock);
    await bootActivity('client-1', gw.fetchMock);
    await expect(answerQuestionWire(QID, 0)).rejects.toThrow(/401/);
    expect(m.authorize).toHaveBeenCalledTimes(1);
  });

  it('concurrent session_invalid replies share one sign-in', async () => {
    const gw = gateway({
      tokens: [tokenOk('S1', 'owner'), tokenOk('S2', 'owner')],
      routes: {
        '/api/activity/answer': [
          { status: 401, body: { error: 'session_invalid' } },
          { status: 401, body: { error: 'session_invalid' } },
          { status: 200, body: { outcome: 'answered', label: 'Да' } },
          { status: 200, body: { outcome: 'answered', label: 'Да' } },
        ],
      },
    });
    vi.stubGlobal('fetch', gw.fetchMock);
    await bootActivity('client-1', gw.fetchMock);
    await Promise.all([answerQuestionWire(QID, 0), answerQuestionWire(QID, 1)]);
    expect(m.authorize).toHaveBeenCalledTimes(2);
  });

  it('board reads (api client) re-auth and retry too', async () => {
    const gw = gateway({
      tokens: [tokenOk('S1', 'owner'), tokenOk('S2', 'owner')],
      routes: {
        '/api/health': [
          { status: 401, body: { error: 'session_invalid' } },
          { status: 200, body: { ok: true, ts: 'now' } },
        ],
      },
    });
    vi.stubGlobal('fetch', gw.fetchMock);
    await bootActivity('client-1', gw.fetchMock);
    await expect(api.health()).resolves.toEqual({ ok: true, ts: 'now' });
    const reads = gw.calls.filter((c) => c.url === '/api/health');
    expect(reads.map((c) => c.headers.authorization)).toEqual(['Bearer S1', 'Bearer S2']);
  });
});
