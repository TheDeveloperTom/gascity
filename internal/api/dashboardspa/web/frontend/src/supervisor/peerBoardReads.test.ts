import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setActiveCity } from '../api/cityBase';
import { peerBody } from '../test/fixtures/peerBoards';
import {
  DEFAULT_STALE_AFTER_SECONDS,
  listPeerBoards,
  PeerBoardsError,
  PEER_DEFAULT_RIG,
} from './peerBoardReads';

// vk-final part 3 (SYNC-PLAN Task 5, sync/rigs 27457ed0): the city service
// `peer-boards` serves the peers' boards read-only. The zod schema accepts
// every optional field the city adds (changed_at, rig, heartbeat_seconds,
// stale_after_seconds, dropped_cards, board_schema, rigs, skipped_rigs …).

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const fetchMock = vi.fn();

beforeEach(() => {
  setActiveCity('my-city');
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('listPeerBoards', () => {
  it('reads /v0/city/<active>/svc/peer-boards/v1/boards with a GET', async () => {
    fetchMock.mockResolvedValue(json(peerBody()));
    await listPeerBoards();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/v0/city/my-city/svc/peer-boards/v1/boards');
    expect(init.method ?? 'GET').toBe('GET');
    expect((init.headers as Record<string, string>).Accept).toBe('application/json');
  });

  it('parses the service body, keeping the thresholds and every card field', async () => {
    fetchMock.mockResolvedValue(json(peerBody()));
    const res = await listPeerBoards();
    expect(res.heartbeatSeconds).toBe(900);
    expect(res.staleAfterSeconds).toBe(1500);
    expect(res.peers).toHaveLength(1);
    const peer = res.peers[0]!;
    expect(peer.login).toBe('rich');
    expect(peer.person.genitive).toBe('Ричарда');
    expect(peer.asOf).toBe('2026-11-15T18:52:00Z');
    expect(peer.rigs).toEqual(['crm-api', 'devwork']);
    const card = peer.cards[0]!;
    expect(card.rig).toBe('crm-api');
    expect(card.bead).toMatchObject({
      id: 'dw-ab12',
      title: 'Изменение схемы users',
      status: 'in_progress',
      issue_type: 'task',
      labels: ['needs/operator'],
      metadata: { 'devwork.pr_number': '12' },
    });
    // null in the snapshot is absent on the bead
    expect('parent' in card.bead).toBe(false);
  });

  it('a /1 peer card without rig is treated as devwork', async () => {
    const body = peerBody({ cards: [{ id: 'dw-1', title: 'old', status: 'open' }] });
    const peer = body.peers[0] as Record<string, unknown>;
    peer.board_schema = 'devwork.board/1';
    peer.rigs = null;
    fetchMock.mockResolvedValue(json(body));
    const res = await listPeerBoards();
    expect(PEER_DEFAULT_RIG).toBe('devwork');
    expect(res.peers[0]!.cards[0]!.rig).toBe('devwork');
  });

  it('missing thresholds fall back to the 25-minute default; snapshot_at stands in for generated_at', async () => {
    const bare = {
      peers: [
        {
          login: 'rich',
          person: { name: 'Ричард', genitive: 'Ричарда', initial: 'Р' },
          snapshot_at: '2026-11-15T18:00:00Z',
          cards: [{ id: 'dw-1', title: 't', status: 'open' }],
        },
      ],
    };
    fetchMock.mockResolvedValue(json(bare));
    const res = await listPeerBoards();
    expect(DEFAULT_STALE_AFTER_SECONDS).toBe(1500);
    expect(res.staleAfterSeconds).toBe(1500);
    expect(res.heartbeatSeconds).toBeNull();
    expect(res.peers[0]!.asOf).toBe('2026-11-15T18:00:00Z');
    expect(res.peers[0]!.cards[0]!.bead.issue_type).toBe('task');
  });

  it('404 and 503 (service not running) resolve to no peers', async () => {
    fetchMock.mockResolvedValueOnce(json({ status: 404 }, 404));
    expect((await listPeerBoards()).peers).toEqual([]);
    fetchMock.mockResolvedValueOnce(json({ status: 503 }, 503));
    expect((await listPeerBoards()).peers).toEqual([]);
  });

  it('a body that is not the contract throws PeerBoardsError', async () => {
    fetchMock.mockResolvedValue(json({ items: [], total: 0 }));
    await expect(listPeerBoards()).rejects.toBeInstanceOf(PeerBoardsError);
  });

  it('a crafted card id is rejected', async () => {
    fetchMock.mockResolvedValue(json(peerBody({ cards: [{ id: '../x', title: 't', status: 'open' }] })));
    await expect(listPeerBoards()).rejects.toBeInstanceOf(PeerBoardsError);
  });
});
