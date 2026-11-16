import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidate } from '../api/cache';
import { listSupervisorBeads } from '../supervisor/beadReads';
import { listSupervisorRigs } from '../supervisor/rigReads';
import { listSupervisorSessions } from '../supervisor/sessionReads';
import { readRigStore, sharedRead, useBoardData } from './useBoardData';

vi.mock('../supervisor/beadReads', () => ({ listSupervisorBeads: vi.fn() }));
vi.mock('../supervisor/rigReads', () => ({ listSupervisorRigs: vi.fn() }));
vi.mock('../supervisor/sessionReads', () => ({ listSupervisorSessions: vi.fn() }));
// Records each render's subscription: prefixes plus the onMatch it would fire.
const subs = vi.hoisted(() => ({ last: new Map<number, { prefixes: string; onMatch: () => void }>(), seq: 0 }));
vi.mock('./useGcEvents', async () => {
  const React = await import('react');
  return {
    useGcEventRefresh: (prefixes: readonly string[], onMatch: () => void) => {
      const id = React.useRef(0);
      if (id.current === 0) id.current = ++subs.seq;
      subs.last.set(id.current, { prefixes: prefixes.join(','), onMatch });
      React.useEffect(() => {
        const mine = id.current;
        return () => {
          subs.last.delete(mine);
        };
      }, []);
      return 'open';
    },
  };
});
const activeStreams = () => [...subs.last.values()].filter((s) => s.prefixes !== '');

const beads = vi.mocked(listSupervisorBeads);
const rigs = vi.mocked(listSupervisorRigs);
const sessions = vi.mocked(listSupervisorSessions);

function Consumer({ name }: { name: string }) {
  const board = useBoardData();
  return (
    <p data-testid={name}>
      {board.error !== null
        ? `error:${board.error}`
        : board.data === undefined
          ? 'loading'
          : `${board.data.items.length}/${board.data.routeItems.length}/${board.data.serviceItems.length}/${String(board.data.routesComplete)}/${board.rigs.length}/${board.sessions.length}`}
    </p>
  );
}

beforeEach(() => {
  invalidate('');
  beads.mockReset();
  rigs.mockReset();
  sessions.mockReset();
  beads.mockResolvedValue({
    items: [
      {
        id: 'dw-1',
        title: 'a',
        status: 'open',
        issue_type: 'task',
        created_at: '2026-11-15T08:00:00Z',
      },
    ],
    route_items: [],
    service_items: [],
    routes_complete: true,
    total: 1,
    upstream_fetched: 1,
    fetch_limit: 1000,
  });
  rigs.mockResolvedValue({ items: [{ name: 'devwork', prefix: 'dw' }] } as never);
  sessions.mockResolvedValue({
    items: [{ id: 'gc-1', session_name: 'worker', state: 'active' }],
  } as never);
});

afterEach(cleanup);

describe('sharedRead', () => {
  it('a fresh read never joins one that started before it was asked for', async () => {
    let calls = 0;
    let release: () => void = () => undefined;
    const fetch = () =>
      new Promise<number>((resolve) => {
        calls += 1;
        const n = calls;
        release = () => resolve(n);
      });
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValue(1_000);
    const first = sharedRead('k-fresh', fetch);
    const joined = sharedRead('k-fresh', fetch);
    expect(calls).toBe(1);
    nowSpy.mockReturnValue(20_000);
    const fresh = sharedRead('k-fresh', fetch, { fresh: true });
    expect(calls).toBe(2);
    const again = sharedRead('k-fresh', fetch, { fresh: true });
    expect(calls).toBe(2);
    release();
    await expect(fresh).resolves.toBe(2);
    await expect(again).resolves.toBe(2);
    expect(first).toBe(joined);
    nowSpy.mockRestore();
  });
});

describe('useBoardData', () => {
  it('Beads and Home share one read', async () => {
    render(
      <>
        <Consumer name="beads" />
        <Consumer name="home" />
      </>,
    );
    await waitFor(() => expect(screen.getByTestId('beads').textContent).toBe('1/0/0/true/1/1'));
    expect(screen.getByTestId('home').textContent).toBe('1/0/0/true/1/1');
    // One unscoped board read, plus (REVIEW 16.11) one open-store read per rig
    // for the owner model; both shared by every consumer. The rig-store read
    // skips its own Live in-progress leg while its window is complete: the
    // board read's city-wide leg covers every rig (BOARD-LOAD 16.11).
    await waitFor(() =>
      expect(beads).toHaveBeenCalledWith({ rigFilter: 'devwork', inProgressLeg: 'when-truncated' }),
    );
    expect(beads).toHaveBeenCalledTimes(2);
    expect(beads).toHaveBeenCalledWith({
      withRoutes: true,
      recentClosed: { limit: 100, rigNames: expect.any(Function) },
    });
    expect(rigs).toHaveBeenCalledTimes(1);
    expect(sessions).toHaveBeenCalledTimes(1);
  });

  // BOARD-LOAD 16.11: the closed legs' rig list joins the board's own /rigs
  // read in flight instead of sending a second /rigs request beside it.
  it('the closed legs read their rigs from the shared rigs read', async () => {
    let releaseRigs: () => void = () => undefined;
    rigs.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseRigs = () => resolve({ items: [{ name: 'devwork', prefix: 'dw' }, { name: 'east' }] } as never);
        }),
    );
    render(<Consumer name="beads" />);
    await waitFor(() => expect(beads).toHaveBeenCalledTimes(1));
    const options = beads.mock.calls[0]?.[0];
    const rigNames = options?.recentClosed?.rigNames;
    expect(options?.recentClosed?.limit).toBe(100);
    expect(rigNames).toBeTypeOf('function');
    const names = rigNames!();
    expect(rigs).toHaveBeenCalledTimes(1);
    releaseRigs();
    await expect(names).resolves.toEqual(['devwork', 'east']);
  });

  // BOARD-LOAD × REVIEW 16.11: the Beads page's fast first paint reads the
  // same rig store the board read takes for the owner model; one request per
  // rig serves both while it is in flight.
  it('a second reader of a rig store joins the board read of that store', async () => {
    let releaseStore: () => void = () => undefined;
    beads.mockImplementation(async (options) =>
      options?.rigFilter === 'devwork'
        ? new Promise((resolve) => {
            releaseStore = () =>
              resolve({ items: [], total: 0, upstream_fetched: 0, fetch_limit: 1000 } as never);
          })
        : ({ items: [], route_items: [], service_items: [], routes_complete: true, total: 0, upstream_fetched: 0, fetch_limit: 1000 } as never),
    );
    render(<Consumer name="beads" />);
    await waitFor(() =>
      expect(beads).toHaveBeenCalledWith({ rigFilter: 'devwork', inProgressLeg: 'when-truncated' }),
    );
    const joined = readRigStore('devwork');
    const storeCalls = () => beads.mock.calls.filter(([o]) => o?.rigFilter === 'devwork').length;
    expect(storeCalls()).toBe(1);
    releaseStore();
    await expect(joined).resolves.toMatchObject({ items: [] });
    expect(storeCalls()).toBe(1);
  });

  // vk integration: TopNav, BottomTabs, the drawer and ⌘K each read the board.
  // One EventSource per consumer used up Chrome's 6 HTTP/1.1 connections per
  // host and stalled every other request; the board now holds ONE bead stream
  // however many consumers mount, and its events refresh all of them.
  it('many consumers hold one bead-event stream; an event refreshes them all', async () => {
    const view = render(
      <>
        <Consumer name="beads" />
        <Consumer name="nav" />
        <Consumer name="tabs" />
      </>,
    );
    await waitFor(() => expect(screen.getByTestId('tabs').textContent).toBe('1/0/0/true/1/1'));
    await waitFor(() => expect(beads).toHaveBeenCalledTimes(2));
    expect(activeStreams()).toHaveLength(1);
    expect(activeStreams()[0]?.prefixes).toBe('bead.');

    beads.mockResolvedValue({
      items: [],
      route_items: [],
      service_items: [],
      routes_complete: true,
      total: 0,
      upstream_fetched: 0,
      fetch_limit: 1000,
    });
    activeStreams()[0]?.onMatch();
    await waitFor(() => {
      for (const name of ['beads', 'nav', 'tabs']) {
        expect(screen.getByTestId(name).textContent).toBe('0/0/0/true/1/1');
      }
    });
    // the event refreshes the board read and the rig store read once each
    await waitFor(() => expect(beads).toHaveBeenCalledTimes(4));

    // The leader leaving hands the stream to another consumer.
    view.rerender(
      <>
        <Consumer name="nav" />
        <Consumer name="tabs" />
      </>,
    );
    await waitFor(() => expect(activeStreams()).toHaveLength(1));
  });

  it('a failed read reports its error and keeps no data', async () => {
    beads.mockRejectedValue(new Error('timed out after 2500ms'));
    render(<Consumer name="home" />);
    await waitFor(() =>
      expect(screen.getByTestId('home').textContent).toBe('error:timed out after 2500ms'),
    );
  });
});
