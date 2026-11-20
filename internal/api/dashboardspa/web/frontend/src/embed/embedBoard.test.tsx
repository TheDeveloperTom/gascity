// Discord mode, the whole page (DESIGN-discord-activity-return §4.3): the App
// is mounted on the board with an open card, once inside a Discord Activity
// frame and once as the plain web app, over one recording fetch.
//
// Inside Discord every request that leaves the page must be a row of the
// design's allowlist (copied here from the design, NOT imported from
// allowlist.ts, so the two are checked against each other), GET only, no
// X-GC-Request, the A3/A4 query keys only; no EventSource opens; the card's
// chat becomes the «на доске в Tailscale» line; the nav has no Mail, Agents
// or Runs. The plain web app keeps doing exactly what it does today.
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { closeSupervisorBead } from '../supervisor/beadWrites';
import { markSupervisorMailRead } from '../supervisor/mailWrites';
import { invalidate } from '../api/cache';
import { ThemeProvider } from '../contexts/ThemeContext';
import { setLocale } from '../i18n';
import { LocaleProvider } from '../i18n/LocaleProvider';
import { enterDiscordFrame, leaveDiscordFrame } from '../test/discordFrame';
import { embedRequestAllowed } from './allowlist';
import contract from './gateway-contract.json';
import { setAuthHeaders } from './mode';
import { setDenied } from './session';
import { closeCommandBar, openCommandBar } from '../lib/commandBar';
import { TAILSCALE_NOTE } from './TailscaleNote';

// The routes are lazy chunks: the first mount in a worker imports them cold.
vi.setConfig({ testTimeout: 30_000 });

const C = 'test-city';
const SEG = '[A-Za-z0-9._-]{1,64}';
// The gateway <-> page contract, a verbatim copy of the city's
// assets/activity-gw/test/contract.json (lane A, city PR #103 3f1d5a64):
// both sides are pinned to the same file. Change both together.
const toRe = (template: string) =>
  new RegExp(`^${template.replace(/\{c\}|\{id\}/g, SEG).replace(/\*/g, '.*')}$`);
const DESIGN_ALLOWED_GETS = [
  ...contract.reads,
  contract.gateway.whoami.path,
  contract.gateway.launch.path,
].map(toRe);
const BEAD_QUERY_KEYS = new Set(contract.beads_query_keys);
const fill = (template: string) => template.replace('{c}', C).replace('{id}', 'dw-a');

const BEAD = {
  id: 'dw-a',
  title: 'M04 #2 — Первая',
  status: 'open',
  issue_type: 'task',
  created_at: '2026-11-15T08:00:00Z',
  labels: ['milestone:M04'],
  description: 'Text with ![shot](/api/city/test-city/attachments/dw-a/x.png)',
  metadata: { 'devwork.attachments': '["x.png"]' },
};

const CONFIG = {
  cityName: C,
  cityRoot: '',
  useFixtures: false,
  readOnly: false,
  operatorAlias: 'owner',
  operatorWireAlias: 'human',
  decisionLabel: 'x',
  enabledModules: null,
  defaultView: null,
};

const STATUS = {
  name: C,
  path: '/srv',
  agent_count: 0,
  rig_count: 1,
  running: 0,
  suspended: false,
  uptime_sec: 10,
  agents: { total: 0, running: 0, suspended: 0, quarantined: 0 },
  rigs: { total: 1, suspended: 0 },
  work: { open: 1, ready: 1, in_progress: 0 },
  mail: { total: 0, unread: 0 },
};

interface Sent {
  method: string;
  path: string;
  query: string[];
  headers: Record<string, string>;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let sent: Sent[];
let sources: string[];

class RecordingEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) {
    sources.push(new URL(url, window.location.origin).pathname);
  }
  addEventListener(): void {}
  removeEventListener(): void {}
  close(): void {
    this.readyState = 2;
  }
}

function install(): void {
  sent = [];
  sources = [];
  vi.stubGlobal('EventSource', RecordingEventSource);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req =
        input instanceof Request
          ? input
          : new Request(new URL(String(input), window.location.origin), init);
      const url = new URL(req.url);
      const headers: Record<string, string> = {};
      req.headers.forEach((v, k) => {
        headers[k] = v;
      });
      sent.push({
        method: req.method,
        path: url.pathname,
        query: [...url.searchParams.keys()],
        headers,
      });
      const p = url.pathname;
      if (p === '/v0/cities')
        return json({ items: [{ name: C, path: '/srv', running: true }], total: 1 });
      if (p === `/v0/city/${C}/beads`) return json({ items: [BEAD], total: 1 });
      if (p === `/v0/city/${C}/bead/dw-a`) return json(BEAD);
      if (p === `/v0/city/${C}/rigs`)
        return json({ items: [{ name: 'devwork', prefix: 'dw', path: '/r' }], total: 1 });
      if (p === `/api/city/${C}/config`) return json(CONFIG);
      if (p === contract.gateway.launch.path) return json({ launch: null, head: 0 });
      if (p === `/v0/city/${C}/status`) return json(STATUS);
      if (p.startsWith(`/v0/city/${C}/`)) return json({ items: [], total: 0 });
      return json({ error: 'not stubbed' }, 404);
    }),
  );
}

function renderApp(entry: string) {
  act(() => setLocale('en'));
  return render(
    <LocaleProvider>
      <ThemeProvider>
        <MemoryRouter initialEntries={[entry]}>
          <App />
        </MemoryRouter>
      </ThemeProvider>
    </LocaleProvider>,
  );
}

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      addEventListener: vi.fn(),
      addListener: vi.fn(),
      dispatchEvent: vi.fn(),
      matches: false,
      media: query,
      onchange: null,
      removeEventListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  window.localStorage.clear();
  for (const k of ['config', 'cities', 'beads:', 'sessions', 'rigs', 'runs']) invalidate(k);
  install();
});

afterEach(async () => {
  cleanup();
  await new Promise((r) => setTimeout(r, 0));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  leaveDiscordFrame();
});

async function openCard() {
  await screen.findByTestId('task-drawer-footer', {}, { timeout: 15000 });
  // let the page's other first reads settle
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
}

describe('the board inside Discord', () => {
  beforeEach(() => {
    enterDiscordFrame(`/city/${C}/beads`);
    setAuthHeaders({ Authorization: 'Bearer S1', 'X-Activity-Instance': 'inst-1' });
  });

  it('sends only the design allowlist, GET only, with the session and no X-GC-Request', async () => {
    renderApp('/beads?bead=dw-a&frame_id=frame-1&instance_id=inst-1');
    await openCard();
    expect(sent.length).toBeGreaterThan(3);
    const off = sent.filter(
      (s) => s.method !== 'GET' || !DESIGN_ALLOWED_GETS.some((re) => re.test(s.path)),
    );
    expect(off).toEqual([]);
    for (const s of sent) {
      expect(s.headers['x-gc-request'], s.path).toBeUndefined();
      expect(s.headers.authorization, s.path).toBe('Bearer S1');
      for (const h of contract.session_headers) expect(s.headers[h], `${s.path} ${h}`).toBeTruthy();
      expect(s.headers['x-activity-instance'], s.path).toBe('inst-1');
      if (/\/beads(\/ready)?$/.test(s.path)) {
        expect(
          s.query.filter((k) => !BEAD_QUERY_KEYS.has(k)),
          s.path,
        ).toEqual([]);
      }
    }
    // the board, the card and the launch read all went out
    const paths = new Set(sent.map((s) => s.path));
    expect(paths.has(`/v0/city/${C}/beads`)).toBe(true);
    expect(paths.has('/api/activity/launch')).toBe(true);
  });

  it('opens no event stream', async () => {
    renderApp('/beads?bead=dw-a');
    await openCard();
    expect(sources).toEqual([]);
  });

  it('the card shows the Tailscale line instead of its chat and screenshots', async () => {
    renderApp('/beads?bead=dw-a');
    await openCard();
    expect(screen.getByTestId('embed-tailscale-note').textContent).toContain(TAILSCALE_NOTE);
    expect(screen.queryByRole('textbox', { name: /chat|message/i })).toBeNull();
    expect(screen.queryByRole('list', { name: 'Screenshots' })).toBeNull();
  });

  it('the nav has no Mail, Agents or Runs', async () => {
    renderApp('/beads');
    await screen.findByRole('region', { name: 'Board' }, { timeout: 15000 });
    for (const href of ['/mail', '/agents', '/runs']) {
      expect(document.querySelector(`a[href="${href}"]`), href).toBeNull();
    }
  });

  it('every write control renders disabled (read-only), whatever /config says', async () => {
    renderApp('/beads?bead=dw-a');
    await openCard();
    expect(screen.getAllByText('Read-only').length).toBeGreaterThan(0);
  });

  it.each(['/agents', '/agents/mayor', '/runs', '/runs/r1', '/mail', '/health', '/nowhere'])(
    'route guard (review L1): %s stays on the board inside Discord',
    async (path) => {
      renderApp(`${path}?frame_id=frame-1&instance_id=inst-1`);
      await screen.findByRole('region', { name: 'Board' }, { timeout: 15000 });
      expect(sources).toEqual([]);
    },
  );

  it('⌘K is not available inside Discord', async () => {
    renderApp('/beads');
    await screen.findByRole('region', { name: 'Board' }, { timeout: 15000 });
    act(() => openCommandBar());
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => closeCommandBar());
  });

  it('no access (403 on re-sign-in): the board is replaced by «Нет доступа»', async () => {
    renderApp('/beads');
    await screen.findByRole('region', { name: 'Board' }, { timeout: 15000 });
    act(() => setDenied());
    expect(screen.getByText('Нет доступа')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Board' })).toBeNull();
  });

  it('`/` opens the board, keeping the launch params', async () => {
    renderApp('/?frame_id=frame-1&instance_id=inst-1');
    await screen.findByRole('region', { name: 'Board' }, { timeout: 15000 });
  });
});

describe('the plain web app is unchanged (owner 20.11: nothing that works today may break)', () => {
  it('no gateway call, no session headers, the event stream and peer boards as today', async () => {
    renderApp('/beads?bead=dw-a');
    await openCard();
    expect(sent.some((s) => s.path.startsWith('/api/activity'))).toBe(false);
    expect(
      sent.some((s) => 'authorization' in s.headers || 'x-activity-instance' in s.headers),
    ).toBe(false);
    expect(sent.some((s) => s.path === `/v0/city/${C}/svc/peer-boards/v1/boards`)).toBe(true);
    expect(sources).toContain(`/v0/city/${C}/events/stream`);
    // the chat footer, not the Discord line
    expect(screen.queryByTestId('embed-tailscale-note')).toBeNull();
  });

  it('the plain web app keeps every route (no guard outside Discord)', async () => {
    renderApp('/mail');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    expect(screen.queryByRole('region', { name: 'Board' })).toBeNull();
  });

  it('the nav keeps Mail, Agents and Runs', async () => {
    renderApp('/beads');
    await screen.findByRole('region', { name: 'Board' }, { timeout: 15000 });
    for (const href of ['/mail', '/agents', '/runs']) {
      expect(document.querySelector(`a[href="${href}"]`), href).not.toBeNull();
    }
  });
});

describe('the allowlist module matches the shared contract', () => {
  beforeEach(() => enterDiscordFrame());
  const o = 'https://1571490006042939402.discordsays.com';

  it('is the city for this board', () => {
    expect(contract.city).toBe('devwork-platform');
  });

  it.each(contract.reads)('contract read %s is allowed (GET only)', (t) => {
    expect(embedRequestAllowed('GET', `${o}${fill(t)}`)).toBe(true);
    expect(embedRequestAllowed('POST', `${o}${fill(t)}`)).toBe(false);
  });

  it.each(contract.denied_examples)('contract denied %s is never sent', (t) => {
    expect(embedRequestAllowed('GET', `${o}${fill(t)}`)).toBe(false);
  });

  it('the gateway routes, each with its own method', () => {
    const g = contract.gateway;
    expect(embedRequestAllowed(g.token.method, `${o}${g.token.path}`)).toBe(true);
    expect(embedRequestAllowed(g.whoami.method, `${o}${g.whoami.path}`)).toBe(true);
    expect(embedRequestAllowed(g.launch.method, `${o}${g.launch.path}?after=1&resync=1`)).toBe(
      true,
    );
    // read-only v1: the page posts nothing but the token exchange (the sink stays unused)
    expect(embedRequestAllowed(g.client_errors.method, `${o}${g.client_errors.path}`)).toBe(false);
  });

  it('the session headers the page sends are the contract ones', () => {
    expect(contract.session_headers).toEqual(['authorization', 'x-activity-instance']);
  });

  it.each([
    '/v0/cities',
    `/v0/city/${C}/status`,
    `/v0/city/${C}/beads?status=open&limit=200`,
    `/v0/city/${C}/beads/ready`,
    `/v0/city/${C}/bead/dw-a`,
    `/v0/city/${C}/bead/dw-a/deps`,
    `/v0/city/${C}/rigs`,
    `/v0/city/${C}/sessions`,
    `/v0/city/${C}/runs/census`,
    `/api/city/${C}/runs/summary`,
    `/api/city/${C}/config`,
    `/api/city/${C}/supervisor-status`,
    '/api/health',
    '/api/activity/whoami',
    '/api/activity/launch?after=3',
  ])('GET %s is allowed', (p) => {
    expect(embedRequestAllowed('GET', `${o}${p}`)).toBe(true);
  });

  it.each([
    `/v0/city/${C}/mail`,
    `/v0/city/${C}/mail/thread/1`,
    `/v0/city/${C}/extmsg/transcript`,
    `/v0/city/${C}/session/s1/transcript`,
    `/v0/city/${C}/session/s1/stream`,
    `/v0/city/${C}/session/s1/pending`,
    `/v0/city/${C}/svc/board-chat/v1/turns`,
    `/api/city/${C}/attachments/dw-a/x.png`,
    '/v0/events',
    `/v0/city/${C}/events`,
    `/v0/city/${C}/events/stream`,
    `/v0/city/${C}/svc/peer-boards/v1/boards`,
    `/v0/city/${C}/svc/board-live/v1/x`,
    '/api/builds',
    '/api/git/commits',
    '/api/health/local-tools',
    '/api/health/history',
    '/api/health/live',
    '/api/health/system',
    `/api/city/${C}/runs/r1/detail`,
    `/v0/city/${C}/usage`,
    `/api/city/${C}/dolt-noms/trend`,
    `/api/city/${C}/rig-store-health`,
    `/v0/city/${C}/agents`,
    `/v0/city/${C}/session/s1`,
    '/sw.js',
    `/v0/city/${C}/bead/..%2F..%2Fmail`,
  ])('GET %s is denied', (p) => {
    expect(embedRequestAllowed('GET', `${o}${p}`)).toBe(false);
  });

  it.each(['POST', 'PATCH', 'PUT', 'DELETE'])('%s to a board read is denied', (m) => {
    expect(embedRequestAllowed(m, `${o}/v0/city/${C}/bead/dw-a`)).toBe(false);
    expect(embedRequestAllowed(m, `${o}/v0/city/${C}/beads`)).toBe(false);
  });

  it('only the token exchange is a POST; no signout or revoke route exists', () => {
    expect(embedRequestAllowed('POST', `${o}/api/activity/token`)).toBe(true);
    expect(embedRequestAllowed('POST', `${o}/api/activity/signout`)).toBe(false);
    expect(embedRequestAllowed('POST', `${o}/api/activity/revoke`)).toBe(false);
    expect(embedRequestAllowed('POST', `${o}/api/activity/answer`)).toBe(false);
    expect(embedRequestAllowed('POST', `${o}/api/client-errors`)).toBe(false);
  });

  it('another origin is denied', () => {
    expect(embedRequestAllowed('GET', 'https://evil.example/v0/cities')).toBe(false);
    expect(embedRequestAllowed('GET', 'https://macbook.ts.net/v0/cities')).toBe(false);
  });
});

describe('no write path from the page in Discord mode', () => {
  it('a bead close or a mail read-mark never reaches the network', async () => {
    enterDiscordFrame();
    setAuthHeaders({ Authorization: 'Bearer S1', 'X-Activity-Instance': 'inst-1' });
    await expect(closeSupervisorBead('dw-a')).rejects.toBeTruthy();
    await expect(markSupervisorMailRead({ id: 'm1' } as never)).rejects.toBeTruthy();
    expect(sent).toEqual([]);
  });

  it('the same close goes out as today on the plain web path', async () => {
    await closeSupervisorBead('dw-a').catch(() => undefined);
    expect(sent.map((s) => `${s.method} ${s.path}`)).toEqual([
      `POST /v0/city/${C}/bead/dw-a/close`,
    ]);
    expect(sent[0]!.headers['x-gc-request']).toBeTruthy();
  });
});
