import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setActiveCity } from '../api/cityBase';
import {
  AVATAR_BASE,
  DEPUTY_DISCORD,
  peerBody,
  peerThread,
  peerTopics,
  RICHARD_DISCORD,
  RICH_MAYOR_DISCORD,
} from '../test/fixtures/peerBoards';
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

  it('our own login comes from the city service (`own_login`), checked', async () => {
    fetchMock.mockResolvedValueOnce(json({ ...peerBody({ topics: peerTopics() }), own_login: 'TheDeveloperTom' }));
    expect((await listPeerBoards()).ownLogin).toBe('TheDeveloperTom');
    fetchMock.mockResolvedValueOnce(json({ ...peerBody(), own_login: '../x' }));
    expect((await listPeerBoards()).ownLogin).toBeNull();
  });

  it('until the city sends own_login: the city of a topic OUR service marks mine:true; never peer data', async () => {
    // tp-b is ours (mine: true, city «me»), set by our own service
    fetchMock.mockResolvedValueOnce(json(peerBody({ topics: peerTopics() })));
    expect((await listPeerBoards()).ownLogin).toBe('me');
    // no explicit mine:true: a peer topic whose `peer`, author or card says «me» proves nothing
    const theirs = peerTopics()
      .filter((tp) => tp.mine === false)
      .map((tp) => ({ ...tp, card: { city: 'me', rig: 'devwork', id: 'dw-1' } }));
    fetchMock.mockResolvedValueOnce(json(peerBody({ topics: theirs })));
    expect((await listPeerBoards()).ownLogin).toBeNull();
    // `mine` absent is NOT mine (M-4: no fail-open fallback)
    const noMine = peerTopics().map((tp) => {
      const copy = { ...tp } as Record<string, unknown>;
      delete copy.mine;
      return copy;
    });
    fetchMock.mockResolvedValueOnce(json(peerBody({ topics: noMine })));
    const res = await listPeerBoards();
    expect(res.ownLogin).toBeNull();
    expect(res.peers[0]!.topics.every((tp) => tp.mine === false)).toBe(true);
  });

  it('a message without `mine` is not ours, whatever its author city says (M-4)', async () => {
    const topics = peerTopics();
    const msgs = topics[0]!.messages as Record<string, unknown>[];
    delete msgs[1]!.mine; // author city «me», but no service mark
    fetchMock.mockResolvedValueOnce(json(peerBody({ topics })));
    const [peer] = (await listPeerBoards()).peers;
    expect(peer!.topics[0]!.messages[1]!.mine).toBe(false);
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

  it('parses card threads: author objects, the name-only form, our delivery state, sorted', async () => {
    fetchMock.mockResolvedValue(json(peerBody({ threads: [peerThread()] })));
    const [peer] = (await listPeerBoards()).peers;
    expect(peer!.threads).toHaveLength(1);
    const thread = peer!.threads[0]!;
    expect([thread.rig, thread.card]).toEqual(['crm-api', 'dw-ab12']);
    const [mayor, mine, , , agent, nameOnly] = thread.comments;
    expect(mayor!.author).toEqual({
      kind: 'mayor',
      city: 'rich',
      name: 'mayor',
      agent: null,
      displayName: null,
      avatarUrl: null,
      roleCaption: null,
    });
    expect(mayor!.mine).toBe(false);
    expect(mine!.mine).toBe(true);
    expect(mine!.state).toBe('delivered');
    expect(agent!.author).toMatchObject({ kind: 'agent', agent: 'deputy' });
    expect(nameOnly!.author).toEqual({
      kind: 'person',
      city: null,
      name: 'Артём',
      agent: null,
      displayName: null,
      avatarUrl: null,
      roleCaption: null,
    });
    expect(nameOnly!.state).toBe('queued');
    expect(thread.comments.map((c) => c.createdAt)).toEqual([...thread.comments.map((c) => c.createdAt)].sort());
  });

  it('an avatar path must name the ACTIVE city (M-2): not `..`, not another city', async () => {
    setActiveCity('test-city');
    const topics = peerTopics();
    const msgs = topics[0]!.messages as Record<string, unknown>[];
    msgs[0]!.author = { ...RICH_MAYOR_DISCORD, avatar_url: '/v0/city/../svc/peer-boards/v1/avatars/1.png' };
    msgs[1]!.author = { ...RICH_MAYOR_DISCORD, avatar_url: '/v0/city/other-city/svc/peer-boards/v1/avatars/1.png' };
    fetchMock.mockResolvedValueOnce(json(peerBody({ topics })));
    const [peer] = (await listPeerBoards()).peers;
    expect(peer!.topics[0]!.messages.map((m) => m.author.avatarUrl)).toEqual([null, null]);
  });

  it('authors carry their Discord identity; only a same-origin avatar path is kept', async () => {
    setActiveCity('test-city');
    const topics = peerTopics();
    const msgs = topics[0]!.messages as Record<string, unknown>[];
    msgs[0]!.author = RICH_MAYOR_DISCORD;
    msgs.push(
      { id: 'm-3', author: RICHARD_DISCORD, text: 'a', created_at: '2026-11-15T18:50:00Z' },
      { id: 'm-4', author: DEPUTY_DISCORD, text: 'b', created_at: '2026-11-15T18:51:00Z' },
      {
        id: 'm-5',
        author: { kind: 'person', city: 'rich', name: 'Ричард', avatar_url: 'https://cdn.discordapp.com/avatars/2/x.png' },
        text: 'c',
        created_at: '2026-11-15T18:52:00Z',
      },
      {
        id: 'm-6',
        author: { kind: 'person', city: 'rich', name: 'Ричард', avatar_url: `${AVATAR_BASE}/../../boards` },
        text: 'd',
        created_at: '2026-11-15T18:53:00Z',
      },
    );
    fetchMock.mockResolvedValue(json(peerBody({ topics })));
    const [peer] = (await listPeerBoards()).peers;
    const byId = new Map(peer!.topics[0]!.messages.map((m) => [m.id, m.author]));
    expect(byId.get('m-1')).toMatchObject({
      kind: 'mayor',
      displayName: 'Richard’s Mayor',
      avatarUrl: `${AVATAR_BASE}/111111111111111111.png`,
    });
    expect(byId.get('m-3')).toMatchObject({ displayName: 'richard.dev', avatarUrl: `${AVATAR_BASE}/222222222222222222.png` });
    expect(byId.get('m-4')).toMatchObject({ kind: 'agent', avatarUrl: `${AVATAR_BASE}/333333333333333333.webp` });
    // never a third-party origin, never a path that climbs out of /avatars/
    expect(byId.get('m-5')!.avatarUrl).toBeNull();
    expect(byId.get('m-6')!.avatarUrl).toBeNull();
    // no identity: both null
    expect(byId.get('m-2')).toMatchObject({ displayName: null, avatarUrl: null });
  });

  it('a malformed thread or comment is skipped, never the board', async () => {
    const bad = peerThread();
    (bad.comments as unknown[]).push({ id: 'x', text: 1 });
    fetchMock.mockResolvedValue(json(peerBody({ threads: [bad, { card: '../x', comments: [] }, 'nope'] })));
    const [peer] = (await listPeerBoards()).peers;
    expect(peer!.cards).toHaveLength(1);
    expect(peer!.threads).toHaveLength(1);
    expect(peer!.threads[0]!.comments).toHaveLength(6);
  });

  it('parses topics in the final contract: status, paused_reason, mine, resolution, reactions', async () => {
    fetchMock.mockResolvedValue(json(peerBody({ topics: peerTopics() })));
    const [peer] = (await listPeerBoards()).peers;
    const [open, paused, pausedByHuman, resolved] = peer!.topics;
    expect(open).toMatchObject({
      topicId: 'tp-aaaaaaaaaaaaaaaaaaaa',
      city: 'rich',
      mine: false,
      status: 'open',
      pausedReason: null,
      unreadCount: 1,
      lastActivityAt: '2026-11-15T18:40:00Z',
    });
    expect(open!.messages[0]!.summary).toBe('Можно ли в 22:00 перезагрузить CI?');
    // `mine` on a message comes from the service, not from guessing the city
    expect(open!.messages.map((m) => m.mine)).toEqual([false, true]);
    expect(open!.reactions).toEqual([
      {
        messageId: 'm-1',
        kind: 'ack',
        by: { kind: 'mayor', city: 'me', name: 'mayor', agent: null, displayName: null, avatarUrl: null, roleCaption: null },
      },
    ]);
    expect(paused).toMatchObject({ status: 'paused', pausedReason: 'needs_human', mine: true });
    // a topic may be linked to one card: {city, rig, id}
    expect(open!.card).toEqual({ city: 'rich', rig: 'crm-api', id: 'dw-ab12' });
    expect(paused!.card).toEqual({ city: 'me', rig: 'devwork', id: 'dw-ab12' });
    expect(pausedByHuman!.card).toBeNull();
    expect(pausedByHuman).toMatchObject({ status: 'paused', pausedReason: 'human' });
    expect(resolved!.resolution).toMatchObject({
      reason: 'resolved',
      decidingMessageId: 'c-2',
      summary: 'договорились, решено без задачи',
    });
    expect(resolved!.resolvedAt).toBe('2026-11-14T11:00:00Z');
  });

  it('a peer without threads or topics has empty lists', async () => {
    const body = peerBody();
    delete (body.peers[0] as Record<string, unknown>).threads;
    delete (body.peers[0] as Record<string, unknown>).topics;
    fetchMock.mockResolvedValue(json(body));
    const [peer] = (await listPeerBoards()).peers;
    expect(peer!.threads).toEqual([]);
    expect(peer!.topics).toEqual([]);
  });

  it('a crafted card id is rejected', async () => {
    fetchMock.mockResolvedValue(json(peerBody({ cards: [{ id: '../x', title: 't', status: 'open' }] })));
    await expect(listPeerBoards()).rejects.toBeInstanceOf(PeerBoardsError);
  });
});
