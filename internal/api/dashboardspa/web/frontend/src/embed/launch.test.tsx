// Discord mode: opening the card or graph the owner tapped
// (DESIGN-discord-activity-return §2.2 steps 3-5).
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enterDiscordFrame, leaveDiscordFrame } from '../test/discordFrame';
import { EmbedLaunchOpener } from './EmbedLaunchOpener';
import {
  createLaunchPoller,
  LAUNCH_POLL_MS,
  launchTarget,
  parseLaunchReply,
  type Launch,
} from './launch';
import { setAuthHeaders } from './mode';
import contract from './gateway-contract.json';

const L = (seq: number, kind: 'bead' | 'graph' = 'bead', bead = `dw-${seq}`) => ({
  launch: { seq, kind, bead },
});

describe('the shared contract (city PR #103 assets/activity-gw/test/contract.json)', () => {
  const g = contract.gateway.launch;
  it('route, method and query keys are the ones the page sends', () => {
    expect([g.method, g.path]).toEqual(['GET', '/api/activity/launch']);
    expect(g.query).toEqual(['after', 'resync']);
  });
  it('a reply with every contract field parses; extra fields are ignored', () => {
    const launch = Object.fromEntries(
      g.launch_fields.map((f) => [
        f,
        f === 'seq' ? 4 : f === 'kind' ? 'graph' : f === 'bead' ? 'dw-q' : '2026-11-20T15:00:00Z',
      ]),
    );
    const reply = Object.fromEntries(g.reply.map((f) => [f, f === 'launch' ? launch : 4]));
    expect(parseLaunchReply(reply)).toEqual({ seq: 4, kind: 'graph', bead: 'dw-q' });
  });
  it('the always-200 «nothing new» reply opens nothing', () => {
    expect(parseLaunchReply({ launch: null, head: 4 })).toBeNull();
  });
  it.each(g.kinds)('kind %s is understood', (kind) => {
    expect(
      parseLaunchReply({ launch: { seq: 1, kind, bead: 'dw-1', at: 'x' }, head: 1 })?.kind,
    ).toBe(kind);
  });
});

describe('parseLaunchReply', () => {
  it('accepts a well-formed launch', () => {
    expect(parseLaunchReply(L(3, 'graph', 'dw-x'))).toEqual({
      seq: 3,
      kind: 'graph',
      bead: 'dw-x',
    });
  });
  it.each([
    null,
    {},
    { launch: null },
    { launch: { seq: 0, kind: 'bead', bead: 'dw-1' } },
    { launch: { seq: 1.5, kind: 'bead', bead: 'dw-1' } },
    { launch: { seq: '2', kind: 'bead', bead: 'dw-1' } },
    { launch: { seq: 2, kind: 'mail', bead: 'dw-1' } },
    { launch: { seq: 2, kind: 'bead', bead: '../etc' } },
    { launch: { seq: 2, kind: 'bead', bead: 'a/b' } },
    { launch: { seq: 2, kind: 'bead', bead: 'x'.repeat(65) } },
  ])('ignores %j', (v) => {
    expect(parseLaunchReply(v)).toBeNull();
  });
});

describe('launchTarget', () => {
  const launchQuery = '?frame_id=f&instance_id=i&platform=mobile';
  it('a card opens on the board and keeps the launch params', () => {
    const t = launchTarget(
      { seq: 1, kind: 'bead', bead: 'dw-9' },
      `${launchQuery}&view=graph&focus=dw-1`,
    );
    expect(t.pathname).toBe('/beads');
    const q = new URLSearchParams(t.search);
    expect(q.get('bead')).toBe('dw-9');
    expect(q.get('view')).toBeNull();
    expect(q.get('focus')).toBeNull();
    expect(q.get('frame_id')).toBe('f');
    expect(q.get('instance_id')).toBe('i');
  });
  it('a graph opens the graph view focused on the card', () => {
    const q = new URLSearchParams(
      launchTarget({ seq: 1, kind: 'graph', bead: 'dw-9' }, `${launchQuery}&bead=dw-1`).search,
    );
    expect(q.get('view')).toBe('graph');
    expect(q.get('focus')).toBe('dw-9');
    expect(q.get('bead')).toBeNull();
    expect(q.get('frame_id')).toBe('f');
  });
});

describe('createLaunchPoller', () => {
  function setup(replies: unknown[]) {
    const reads: Array<{ after: number; resync: boolean }> = [];
    const opened: Launch[] = [];
    let hidden = false;
    const poller = createLaunchPoller({
      read: async (after, resync) => {
        reads.push({ after, resync });
        const r = replies.shift();
        if (r instanceof Error) throw r;
        return r ?? null;
      },
      open: (l) => opened.push(l),
      isHidden: () => hidden,
    });
    return { poller, reads, opened, hide: (v: boolean) => (hidden = v) };
  }

  it('the boot read (after=0, resync) opens the launch the Activity was started for', async () => {
    const s = setup([L(4)]);
    await s.poller.tick();
    expect(s.reads).toEqual([{ after: 0, resync: true }]);
    expect(s.opened.map((l) => l.bead)).toEqual(['dw-4']);
  });

  it('only a newer seq switches; a repeat or stale seq never reopens a card', async () => {
    const s = setup([L(4), L(4), L(3), { launch: null }, L(5, 'graph')]);
    for (let i = 0; i < 5; i += 1) await s.poller.tick();
    expect(s.opened.map((l) => `${l.seq}:${l.kind}`)).toEqual(['4:bead', '5:graph']);
    expect(s.reads.map((r) => r.after)).toEqual([0, 4, 4, 4, 4]);
    expect(s.reads.slice(1).every((r) => !r.resync)).toBe(true);
  });

  it('hidden: no read; back to visible: the next read is one resync', async () => {
    const s = setup([L(1), L(2), L(3)]);
    await s.poller.tick();
    s.hide(true);
    await s.poller.tick();
    expect(s.reads).toHaveLength(1);
    s.hide(false);
    s.poller.becameVisible();
    await s.poller.tick();
    await s.poller.tick();
    expect(s.reads.map((r) => r.resync)).toEqual([true, true, false]);
    expect(s.opened.map((l) => l.seq)).toEqual([1, 2, 3]);
  });

  it('a failed read (gateway down, 401) keeps the current view', async () => {
    const s = setup([new Error('down'), null, L(2)]);
    await s.poller.tick();
    await s.poller.tick();
    expect(s.opened).toEqual([]);
    await s.poller.tick();
    expect(s.opened.map((l) => l.seq)).toEqual([2]);
  });

  it('one read at a time', async () => {
    let release: (v: unknown) => void = () => {};
    const reads: number[] = [];
    const poller = createLaunchPoller({
      read: (after) => {
        reads.push(after);
        return new Promise((r) => (release = r));
      },
      open: () => {},
      isHidden: () => false,
    });
    const first = poller.tick();
    await poller.tick();
    expect(reads).toHaveLength(1);
    release(null);
    await first;
  });
});

describe('<EmbedLaunchOpener />', () => {
  const probe = { path: '', search: '' };
  function Probe() {
    const loc = useLocation();
    probe.path = loc.pathname;
    probe.search = loc.search;
    return null;
  }
  function renderAt(entry: string) {
    return render(
      <MemoryRouter initialEntries={[entry]}>
        <Probe />
        <EmbedLaunchOpener />
      </MemoryRouter>,
    );
  }

  let replies: unknown[];
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.useFakeTimers();
    replies = [];
    fetchMock = vi.fn(async (_input: RequestInfo | URL) => {
      const r = replies.shift();
      return r === undefined
        ? new Response(JSON.stringify({ launch: null, head: 0 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        : new Response(JSON.stringify(r), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
    });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    leaveDiscordFrame();
  });

  const flush = () =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

  it('outside Discord: no request and no timer', async () => {
    leaveDiscordFrame();
    renderAt('/beads');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LAUNCH_POLL_MS * 3);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cold launch opens the card; a tap while open switches within one poll; the graph opens focused', async () => {
    enterDiscordFrame();
    setAuthHeaders({ Authorization: 'Bearer S1', 'X-Activity-Instance': 'inst-1' });
    replies.push(L(7, 'bead', 'dw-cold'));
    renderAt('/beads?frame_id=frame-1&instance_id=inst-1');
    await flush();
    expect(probe.path).toBe('/beads');
    expect(new URLSearchParams(probe.search).get('bead')).toBe('dw-cold');
    expect(new URLSearchParams(probe.search).get('instance_id')).toBe('inst-1');

    const first = fetchMock.mock.calls[0]![0] as Request;
    expect(new URL(first.url).pathname).toBe('/api/activity/launch');
    expect(new URL(first.url).search).toBe('?after=0&resync=1');
    expect(first.method).toBe('GET');
    expect(first.headers.get('authorization')).toBe('Bearer S1');

    replies.push(L(8, 'bead', 'dw-second'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LAUNCH_POLL_MS);
    });
    expect(new URLSearchParams(probe.search).get('bead')).toBe('dw-second');
    expect(new URL((fetchMock.mock.calls[1]![0] as Request).url).search).toBe('?after=7');

    replies.push(L(9, 'graph', 'dw-g'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LAUNCH_POLL_MS);
    });
    const q = new URLSearchParams(probe.search);
    expect([q.get('view'), q.get('focus'), q.get('bead')]).toEqual(['graph', 'dw-g', null]);
  });

  it('no launch: the board stays where it is', async () => {
    enterDiscordFrame();
    renderAt('/beads?bead=dw-own');
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LAUNCH_POLL_MS * 2);
    });
    expect(new URLSearchParams(probe.search).get('bead')).toBe('dw-own');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('pauses while hidden and resyncs once on return', async () => {
    enterDiscordFrame();
    let state: DocumentVisibilityState = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => state);
    renderAt('/beads');
    await flush();
    state = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LAUNCH_POLL_MS * 4);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    state = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new URL((fetchMock.mock.calls[1]![0] as Request).url).searchParams.get('resync')).toBe(
      '1',
    );
  });
});
