import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setActiveCity } from '../api/cityBase';
import { NowProvider } from '../contexts/NowContext';
import { peerBody } from '../test/fixtures/peerBoards';
import { refreshPeerBoards, resetPeerBoardsForTests, usePeerBoards } from './usePeerBoards';

// vk-final: every consumer of the peer boards (board, «Нужно от меня», the
// badge) shares ONE poller, so the page never multiplies the GET.

const PEER_URL = '/v0/city/test-city/svc/peer-boards/v1/boards';
const fetchMock = vi.fn();
const calls = () => fetchMock.mock.calls.filter(([u]) => String(u) === PEER_URL).length;

beforeEach(() => {
  setActiveCity('test-city');
  resetPeerBoardsForTests();
  fetchMock.mockReset();
  fetchMock.mockImplementation(
    async () => new Response(JSON.stringify(peerBody()), { status: 200, headers: { 'content-type': 'application/json' } }),
  );
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

let seen: number[] = [];
function Consumer({ id }: { id: number }) {
  const { sources } = usePeerBoards();
  seen[id] = sources.length;
  return null;
}

describe('usePeerBoards', () => {
  it('three consumers make one request, and all see the peer', async () => {
    seen = [];
    render(
      <NowProvider intervalMs={1_000_000}>
        <Consumer id={0} />
        <Consumer id={1} />
        <Consumer id={2} />
      </NowProvider>,
    );
    await waitFor(() => expect(seen).toEqual([1, 1, 1]));
    expect(calls()).toBe(1);
  });

  it('refreshPeerBoards reads again at once (after a write)', async () => {
    seen = [];
    render(
      <NowProvider intervalMs={1_000_000}>
        <Consumer id={0} />
      </NowProvider>,
    );
    await waitFor(() => expect(seen[0]).toBe(1));
    await act(async () => {
      await refreshPeerBoards();
    });
    expect(calls()).toBe(2);
  });
});
