import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectMissing, resetMissing, setLocale } from '../i18n';
import { asOfClock, peerSourcesOf } from '../lib/boardOwner';
import { peerStatusLines } from '../lib/peerLive';
import {
  AVATAR_BASE,
  ownerQuestion,
  peerBody,
  peerTopics,
  QUESTION_JUMP,
  QUESTION_LINE_1,
  QUESTION_LINE_2,
} from '../test/fixtures/peerBoards';
import { parsePeerBoards } from './peerBoardReads';

// BOARD-LIVE L7 (contract C5): `/v1/boards` gains each peer's `live` block
// (C4) and `people`, role captions on authors, `ticket_ref`, `undelivered`
// on our own messages, and the owner's topic questions (L10 question_views).

const NOW = Date.parse('2026-11-15T19:00:00Z');

beforeEach(() => {
  setLocale('ru');
  resetMissing();
});
afterEach(() => setLocale('en'));

function live(over: Record<string, unknown> = {}) {
  return {
    version: 42,
    as_of: '2026-11-15T18:52:00Z',
    connection: { state: 'live', since: '2026-11-15T18:00:00Z' },
    peer_online: true,
    peer_last_seen: null,
    ...over,
  };
}

describe('parsePeerBoards: the live block and people', () => {
  it('reads live (version, as_of, connection, peer_online, peer_last_seen) and fetched_at', () => {
    const res = parsePeerBoards(
      peerBody({
        live: live({ connection: { state: 'offline', since: '2026-11-15T18:30:00Z', error: 'auth' } }),
        fetchedAt: '2026-11-15T18:55:00Z',
      }),
    );
    const peer = res.peers[0]!;
    expect(peer.fetchedAt).toBe('2026-11-15T18:55:00Z');
    expect(peer.live).toEqual({
      version: 42,
      asOf: '2026-11-15T18:52:00Z',
      state: 'offline',
      since: '2026-11-15T18:30:00Z',
      error: 'auth',
      peerOnline: true,
      peerLastSeen: null,
    });
  });

  it('an old peer (no live block) or a malformed one gives live: null, never a lost board', () => {
    expect(parsePeerBoards(peerBody()).peers[0]!.live).toBeNull();
    const bad = parsePeerBoards(peerBody({ live: { connection: { state: 'hacked' } } }));
    expect(bad.peers[0]!.live).toBeNull();
    expect(bad.peers[0]!.cards).toHaveLength(1);
  });

  it('people: display name, role caption, and only a same-origin avatar of the active city', () => {
    const res = parsePeerBoards(
      peerBody({
        people: [
          { login: 'rich', who: 'person', display_name: 'richard.dev', role_caption: 'Ричард', avatar_url: `${AVATAR_BASE}/${'a'.repeat(32)}.webp` },
          { login: 'rich', who: 'mayor', display_name: 'Rich Mayor', role_caption: 'Мэр Ричарда', avatar_url: 'https://cdn.discordapp.com/x.png' },
          { login: 'rich', who: 'robot' },
        ],
      }),
    );
    expect(res.peers[0]!.people).toEqual([
      { login: 'rich', who: 'person', displayName: 'richard.dev', roleCaption: 'Ричард', avatarUrl: `${AVATAR_BASE}/${'a'.repeat(32)}.webp` },
      { login: 'rich', who: 'mayor', displayName: 'Rich Mayor', roleCaption: 'Мэр Ричарда', avatarUrl: null },
    ]);
  });

  it('authors carry role_caption; our messages carry undelivered: peer_offline', () => {
    const topics = peerTopics();
    const msg = (topics[0] as { messages: Record<string, unknown>[] }).messages;
    msg[0]!.author = { kind: 'mayor', city: 'rich', name: 'mayor', display_name: 'Rich Mayor', role_caption: 'Мэр Ричарда' };
    msg[1]!.undelivered = 'peer_offline';
    const tp = parsePeerBoards(peerBody({ topics })).peers[0]!.topics[0]!;
    expect(tp.messages[0]!.author.roleCaption).toBe('Мэр Ричарда');
    expect(tp.messages[1]!.undelivered).toBe('peer_offline');
    expect(tp.messages[0]!.undelivered).toBeNull();
  });
});

describe('parsePeerBoards: tickets (review N-1)', () => {
  it('ticket and ticket_ref are kept only as valid bead ids', () => {
    const topics = peerTopics();
    Object.assign(topics[1] as object, { ticket: 'dw-x1', ticket_ref: { city: 'me', rig: 'devwork', id: 'dw-x1' } });
    Object.assign(topics[0] as object, { ticket: '../../etc', ticket_ref: { city: 'rich', rig: 'crm-api', id: 'x y' } });
    const parsed = parsePeerBoards(peerBody({ topics })).peers[0]!.topics;
    expect(parsed[1]!.ticket).toBe('dw-x1');
    expect(parsed[1]!.ticketRef).toEqual({ city: 'me', rig: 'devwork', id: 'dw-x1' });
    expect(parsed[0]!.ticket).toBeNull();
    expect(parsed[0]!.ticketRef).toBeNull();
  });
});

describe('parsePeerBoards: owner topic questions (L10 question_views)', () => {
  it('top-level owner_questions and topic.owner_question merge into one list by question id', () => {
    const topics = peerTopics();
    (topics[0] as Record<string, unknown>).owner_question = ownerQuestion();
    const res = parsePeerBoards(
      peerBody({
        topics,
        top: {
          owner_questions: [
            ownerQuestion(),
            ownerQuestion({ question_id: 'q-2', topic: 'tp-bbbbbbbbbbbbbbbbbbbb', card: { city: 'me', rig: 'devwork', id: 'dw-ab12' }, status: 'answered', answer: 'Да' }),
          ],
        },
      }),
    );
    expect(res.ownerQuestions.map((q) => q.questionId)).toEqual(['q-7f3a9c', 'q-2']);
    const q = res.ownerQuestions[0]!;
    expect(q.lines).toEqual([QUESTION_LINE_1, QUESTION_LINE_2]);
    expect(q.options).toEqual(['Да', 'Нет', 'Обсудить', 'Сделать задачей']);
    expect(q.status).toBe('pending');
    expect(q.topicId).toBe('tp-aaaaaaaaaaaaaaaaaaaa');
    expect(q.jumpUrl).toBe(QUESTION_JUMP);
    expect(res.peers[0]!.topics[0]!.ownerQuestion?.questionId).toBe('q-7f3a9c');
    expect(res.ownerQuestions[1]!.card).toEqual({ city: 'me', rig: 'devwork', id: 'dw-ab12' });
    expect(res.ownerQuestions[1]!.status).toBe('answered');
  });

  it('only a Discord https jump link is kept; more than two lines are cut to two', () => {
    const res = parsePeerBoards(
      peerBody({
        top: {
          owner_questions: [
            ownerQuestion({ jump_url: 'javascript:alert(1)', text: 'один\nдва\nтри' }),
          ],
        },
      }),
    );
    expect(res.ownerQuestions[0]!.jumpUrl).toBeNull();
    expect(res.ownerQuestions[0]!.lines).toEqual(['один', 'два']);
  });
});

describe('peer status lines (live labels; Review Focus 4: our clock, not his)', () => {
  const lines = (body: ReturnType<typeof peerBody>) => peerStatusLines(peerSourcesOf(parsePeerBoards(body), NOW)[0]!);

  it('offline peer shows «Мак Ричарда не в сети с HH:MM» from peer_last_seen, else fetched_at', () => {
    expect(
      lines(peerBody({ live: live({ connection: { state: 'offline', since: '2026-11-15T18:40:00Z' }, peer_online: false, peer_last_seen: '2026-11-15T18:31:00Z' }) })),
    ).toContain(`Мак Ричарда не в сети с ${asOfClock('2026-11-15T18:31:00Z')}`);
    expect(
      lines(peerBody({ fetchedAt: '2026-11-15T18:44:00Z', live: live({ connection: { state: 'offline', since: '2026-11-15T18:45:00Z' }, peer_online: false }) })),
    ).toContain(`Мак Ричарда не в сети с ${asOfClock('2026-11-15T18:44:00Z')}`);
    expect(collectMissing()).toEqual([]);
  });

  it('peer_last_seen after as_of shows «данные на HH:MM; Ричард был в сети до HH:MM — изменений может не хватать»', () => {
    const out = lines(
      peerBody({
        live: live({ as_of: '2026-11-15T18:20:00Z', connection: { state: 'reconnecting', since: '2026-11-15T18:50:00Z' }, peer_last_seen: '2026-11-15T18:49:00Z' }),
      }),
    );
    expect(out).toContain(
      `данные на ${asOfClock('2026-11-15T18:20:00Z')}; Ричард был в сети до ${asOfClock('2026-11-15T18:49:00Z')} — изменений может не хватать`,
    );
    expect(collectMissing()).toEqual([]);
  });

  it('a live connection shows nothing, whatever the peer’s own clock says', () => {
    expect(lines(peerBody({ snapshotAt: '2026-11-14T01:00:00Z', live: live({ as_of: '2026-11-14T01:00:00Z' }) }))).toEqual([]);
    const src = peerSourcesOf(parsePeerBoards(peerBody({ snapshotAt: '2026-11-14T01:00:00Z', live: live() })), NOW)[0]!;
    expect(src.stale).toBe(false);
  });

  it('a refused pair key says so', () => {
    expect(lines(peerBody({ live: live({ connection: { state: 'reconnecting', since: null, error: 'auth' } }) }))).toContain(
      'Город Ричарда не принимает наш ключ — города нужно связать заново',
    );
    expect(collectMissing()).toEqual([]);
  });

  it('an old peer without live keeps the snapshot-age rule', () => {
    expect(lines(peerBody({ snapshotAt: '2026-11-15T10:00:00Z' }))).toEqual([
      `Мак Ричарда не в сети с ${asOfClock('2026-11-15T10:00:00Z')}`,
    ]);
    expect(lines(peerBody())).toEqual([]);
  });
});
