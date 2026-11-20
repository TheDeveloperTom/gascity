// Discord mode sign-in (DESIGN-discord-activity-return §4.2). The SDK is
// mocked at its package boundary; the gateway is a stubbed fetch.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../api/client';
import { openExternal } from '../lib/openExternal';
import { supervisorApi } from '../supervisor/client';
import { APP_ID, enterDiscordFrame, leaveDiscordFrame } from '../test/discordFrame';
import { bootActivity, READY_TIMEOUT_MS, runActivityBoot } from './activitySdk';
import { isDenied } from './session';
import { authHeaders, embedClientId, tailscaleCardUrl } from './mode';
import contract from './gateway-contract.json';

const m = vi.hoisted(() => ({
  constructed: [] as string[],
  order: [] as string[],
  instanceId: 'inst-1',
  authorize: vi.fn(async (_a: unknown) => ({ code: 'code-1' })),
  authenticate: vi.fn(async (_a: unknown) => ({ user: { id: 'u' } })),
  openExternalLink: vi.fn(async (_a: unknown) => ({ opened: true })),
  ready: vi.fn(() => Promise.resolve()),
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

const OWNER = '942312306421927956';
const SECRET_TOKEN = 'discord-access-token-SENTINEL';

type Reply = { status: number; body: unknown };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function tokenOk(session: string): Reply {
  return {
    status: 200,
    body: {
      session,
      access_token: SECRET_TOKEN,
      user_id: OWNER,
      board_url: 'https://mac.tail.ts.net',
    },
  };
}

interface Call {
  path: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A fake gateway: token replies from `tokens` in order, other routes from `routes`. */
function gateway(opts: { tokens?: Reply[]; routes?: Record<string, Reply[]> }) {
  const tokens = [...(opts.tokens ?? [tokenOk('S1')])];
  const routes: Record<string, Reply[]> = {};
  for (const [k, v] of Object.entries(opts.routes ?? {})) routes[k] = [...v];
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req =
      input instanceof Request
        ? input
        : new Request(new URL(String(input), window.location.origin), init);
    const path = new URL(req.url).pathname;
    const headers: Record<string, string> = {};
    req.headers.forEach((v, k) => {
      headers[k] = v;
    });
    const text = req.method === 'GET' ? '' : await req.text();
    calls.push({ path, method: req.method, headers, body: text ? JSON.parse(text) : undefined });
    if (path === '/api/activity/token') {
      m.order.push('token');
      const r = tokens.shift() ?? { status: 500, body: {} };
      return json(r.status, r.body);
    }
    const r = routes[path]?.shift() ?? { status: 404, body: {} };
    return json(r.status, r.body);
  });
  return { fetchMock, calls };
}

const CONFIG = {
  cityName: 'test-city',
  cityRoot: '',
  useFixtures: false,
  readOnly: true,
  operatorAlias: 'owner',
  operatorWireAlias: 'human',
  decisionLabel: 'x',
  enabledModules: null,
  defaultView: null,
};

beforeEach(() => {
  enterDiscordFrame();
  m.constructed.length = 0;
  m.order.length = 0;
  m.instanceId = 'inst-1';
  m.authorize.mockClear();
  m.authenticate.mockClear();
  m.openExternalLink.mockClear();
  m.ready.mockClear();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  leaveDiscordFrame();
});

describe('bootActivity', () => {
  it('runs the SDK flow in order: ready → authorize(identify, prompt none) → token → authenticate', async () => {
    const gw = gateway({});
    await bootActivity(APP_ID, gw.fetchMock);
    expect(m.constructed).toEqual([APP_ID]);
    expect(m.order).toEqual(['ready', 'authorize', 'token', 'authenticate']);
    expect(m.authorize).toHaveBeenCalledWith({
      client_id: APP_ID,
      response_type: 'code',
      state: '',
      prompt: 'none',
      scope: ['identify'],
    });
    expect(gw.calls[0]).toMatchObject({
      path: '/api/activity/token',
      method: 'POST',
      body: { code: 'code-1', instance_id: 'inst-1' },
    });
    expect(m.authenticate).toHaveBeenCalledWith({ access_token: SECRET_TOKEN });
  });

  it('the client id is the proxy host label, never a build value', () => {
    expect(embedClientId()).toBe(APP_ID);
  });

  it('sends only the gateway session afterwards; the Discord token is never stored or sent', async () => {
    const gw = gateway({
      routes: { '/api/city/test-city/config': [{ status: 200, body: CONFIG }] },
    });
    await bootActivity(APP_ID, gw.fetchMock);
    expect(authHeaders()).toEqual({ Authorization: 'Bearer S1', 'X-Activity-Instance': 'inst-1' });
    vi.stubGlobal('fetch', gw.fetchMock);
    await api.config();
    const read = gw.calls.at(-1)!;
    expect(read.path).toBe('/api/city/test-city/config');
    expect(read.headers.authorization).toBe('Bearer S1');
    expect(read.headers['x-activity-instance']).toBe('inst-1');
    expect(read.headers['x-gc-request']).toBeUndefined();
    const everything = JSON.stringify(gw.calls.slice(1)) + document.cookie + window.location.href;
    expect(everything).not.toContain(SECRET_TOKEN);
    for (const store of [window.localStorage, window.sessionStorage]) {
      for (let i = 0; i < store.length; i += 1) {
        expect(store.getItem(store.key(i) ?? '') ?? '').not.toContain(SECRET_TOKEN);
      }
    }
  });

  it('links leave through the SDK openExternalLink, not window.open', async () => {
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);
    await bootActivity(APP_ID, gateway({}).fetchMock);
    openExternal('https://discord.com/channels/1/2/3');
    expect(m.openExternalLink).toHaveBeenCalledWith({ url: 'https://discord.com/channels/1/2/3' });
    expect(opened).not.toHaveBeenCalled();
  });

  it('keeps the Tailscale board origin from the token reply for the card link', async () => {
    await bootActivity(APP_ID, gateway({}).fetchMock);
    expect(tailscaleCardUrl('test-city', 'dw-1')).toBe(
      'https://mac.tail.ts.net/city/test-city/beads?bead=dw-1',
    );
  });
});

describe('the shared contract (city PR #103 assets/activity-gw/test/contract.json)', () => {
  const t = contract.gateway.token;
  it('the token exchange sends exactly the contract request fields', async () => {
    const gw = gateway({});
    await bootActivity(APP_ID, gw.fetchMock);
    const call = gw.calls[0]!;
    expect([call.method, call.path]).toEqual([t.method, t.path]);
    expect(Object.keys(call.body as object).sort()).toEqual([...t.request].sort());
  });

  it('a reply with only the required fields signs in; board_url absent → no Tailscale button', async () => {
    const body = Object.fromEntries(
      t.reply_required.map((f) => [f, f === 'user_id' ? OWNER : `v-${f}`]),
    );
    await bootActivity(APP_ID, gateway({ tokens: [{ status: 200, body }] }).fetchMock);
    expect(authHeaders()).toEqual({
      Authorization: 'Bearer v-session',
      'X-Activity-Instance': 'inst-1',
    });
    expect(tailscaleCardUrl('test-city', 'dw-1')).toBeNull();
  });

  it('the optional fields do not break sign-in', async () => {
    const body = {
      session: 'S9',
      access_token: SECRET_TOKEN,
      user_id: OWNER,
      board_url: 'https://mac.tail.ts.net',
      role: 'owner',
      expires_at: 1,
      instance_confirmed: false,
    };
    expect(
      Object.keys(body).every((k) => [...t.reply_required, ...t.reply_optional].includes(k)),
    ).toBe(true);
    await bootActivity(APP_ID, gateway({ tokens: [{ status: 200, body }] }).fetchMock);
    expect(authHeaders().Authorization).toBe('Bearer S9');
  });

  it('session headers are the contract ones', async () => {
    await bootActivity(APP_ID, gateway({}).fetchMock);
    expect(Object.keys(authHeaders()).map((h) => h.toLowerCase())).toEqual(
      contract.session_headers,
    );
  });
});

describe('runActivityBoot', () => {
  it('403 renders «Нет доступа» and does not mount', async () => {
    const root = document.createElement('div');
    const ok = await runActivityBoot(
      APP_ID,
      root,
      gateway({ tokens: [{ status: 403, body: {} }] }).fetchMock,
    );
    expect(ok).toBe(false);
    expect(root.textContent).toBe('Нет доступа');
    expect(authHeaders()).toEqual({});
  });

  it('a failed sign-in renders the sign-in error and leaves no headers', async () => {
    const root = document.createElement('div');
    m.authorize.mockRejectedValueOnce(new Error('user closed the modal'));
    const ok = await runActivityBoot(APP_ID, root, gateway({}).fetchMock);
    expect(ok).toBe(false);
    expect(root.textContent).toBe('Не удалось войти через Discord');
    expect(authHeaders()).toEqual({});
  });

  it('no client id renders the sign-in error without touching the SDK', async () => {
    const root = document.createElement('div');
    expect(await runActivityBoot(null, root, gateway({}).fetchMock)).toBe(false);
    expect(m.constructed).toEqual([]);
  });
});

describe('re-sign-in (gateway 401 session_invalid)', () => {
  const invalid: Reply = { status: 401, body: { error: 'session_invalid' } };

  it('re-runs the silent sign-in once and retries the read with the new session', async () => {
    const gw = gateway({
      tokens: [tokenOk('S1'), tokenOk('S2')],
      routes: { '/api/city/test-city/config': [invalid, { status: 200, body: CONFIG }] },
    });
    await bootActivity(APP_ID, gw.fetchMock);
    vi.stubGlobal('fetch', gw.fetchMock);
    await expect(api.config()).resolves.toMatchObject({ cityName: 'test-city' });
    const reads = gw.calls.filter((c) => c.path === '/api/city/test-city/config');
    expect(reads.map((c) => c.headers.authorization)).toEqual(['Bearer S1', 'Bearer S2']);
    expect(m.order.filter((s) => s === 'authorize')).toHaveLength(2);
  });

  it('concurrent 401s share one sign-in (supervisor client too)', async () => {
    const gw = gateway({
      tokens: [tokenOk('S1'), tokenOk('S2')],
      routes: {
        '/v0/city/test-city/rigs': [invalid, { status: 200, body: { items: [], total: 0 } }],
        '/v0/cities': [invalid, { status: 200, body: { items: [], total: 0 } }],
      },
    });
    await bootActivity(APP_ID, gw.fetchMock);
    vi.stubGlobal('fetch', gw.fetchMock);
    await Promise.all([supervisorApi().listRigs('test-city'), supervisorApi().listCities()]);
    expect(gw.calls.filter((c) => c.path === '/api/activity/token')).toHaveLength(2);
  });

  it('a plain 401 (not session_invalid) is not retried', async () => {
    const gw = gateway({
      routes: { '/api/city/test-city/config': [{ status: 401, body: { error: 'nope' } }] },
    });
    await bootActivity(APP_ID, gw.fetchMock);
    vi.stubGlobal('fetch', gw.fetchMock);
    await expect(api.config()).rejects.toMatchObject({ status: 401 });
    expect(gw.calls.filter((c) => c.path === '/api/activity/token')).toHaveLength(1);
  });

  it('a 403 on re-sign-in (no longer the owner) clears the session', async () => {
    const gw = gateway({
      tokens: [tokenOk('S1'), { status: 403, body: {} }],
      routes: { '/api/city/test-city/config': [invalid] },
    });
    await bootActivity(APP_ID, gw.fetchMock);
    vi.stubGlobal('fetch', gw.fetchMock);
    await expect(api.config()).rejects.toMatchObject({ status: 401 });
    expect(authHeaders()).toEqual({});
    // review M1: no access is final; nothing leaves the frame any more
    expect(isDenied()).toBe(true);
    const before = gw.calls.length;
    await expect(api.config()).rejects.toMatchObject({ status: 403 });
    expect(gw.calls.length).toBe(before);
  });
});

describe('SDK failures are visible (review L2)', () => {
  it('authenticate() failing is a sign-in error, not a silent half-signed-in board', async () => {
    m.authenticate.mockRejectedValueOnce(new Error('INVALID_COMMAND'));
    const root = document.createElement('div');
    expect(await runActivityBoot(APP_ID, root, gateway({}).fetchMock)).toBe(false);
    expect(root.textContent).toBe('Не удалось войти через Discord');
    expect(authHeaders()).toEqual({});
  });

  it('authenticate() answering null is a sign-in error too', async () => {
    m.authenticate.mockResolvedValueOnce(null as never);
    const root = document.createElement('div');
    expect(await runActivityBoot(APP_ID, root, gateway({}).fetchMock)).toBe(false);
    expect(authHeaders()).toEqual({});
  });

  it('ready() that never answers times out into the sign-in error', async () => {
    vi.useFakeTimers();
    try {
      m.ready.mockImplementationOnce(() => new Promise<void>(() => {}));
      const root = document.createElement('div');
      const boot = runActivityBoot(APP_ID, root, gateway({}).fetchMock);
      await vi.advanceTimersByTimeAsync(READY_TIMEOUT_MS);
      expect(await boot).toBe(false);
      expect(root.textContent).toBe('Не удалось войти через Discord');
      expect(m.authorize).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
