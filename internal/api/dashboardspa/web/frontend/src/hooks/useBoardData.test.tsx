import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidate } from '../api/cache';
import { listSupervisorBeads } from '../supervisor/beadReads';
import { listSupervisorRigs } from '../supervisor/rigReads';
import { listSupervisorSessions } from '../supervisor/sessionReads';
import { sharedRead, useBoardData } from './useBoardData';

vi.mock('../supervisor/beadReads', () => ({ listSupervisorBeads: vi.fn() }));
vi.mock('../supervisor/rigReads', () => ({ listSupervisorRigs: vi.fn() }));
vi.mock('../supervisor/sessionReads', () => ({ listSupervisorSessions: vi.fn() }));
vi.mock('./useGcEvents', () => ({ useGcEventRefresh: () => 'open' }));

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
    expect(beads).toHaveBeenCalledTimes(1);
    expect(beads).toHaveBeenCalledWith({ withRoutes: true, recentClosed: { limit: 100 } });
    expect(rigs).toHaveBeenCalledTimes(1);
    expect(sessions).toHaveBeenCalledTimes(1);
  });

  it('a failed read reports its error and keeps no data', async () => {
    beads.mockRejectedValue(new Error('timed out after 2500ms'));
    render(<Consumer name="home" />);
    await waitFor(() =>
      expect(screen.getByTestId('home').textContent).toBe('error:timed out after 2500ms'),
    );
  });
});
