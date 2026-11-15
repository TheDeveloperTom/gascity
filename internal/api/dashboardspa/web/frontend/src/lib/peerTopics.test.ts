import { describe, expect, it } from 'vitest';
import { parsePeerBoards } from '../supervisor/peerBoardReads';
import { peerBody, peerTopics } from '../test/fixtures/peerBoards';
import {
  RESOLVED_WINDOW_MS,
  topicNeedsOf,
  topicSections,
  topicsForCard,
  topicTarget,
  unreadIdsOf,
  waitingOn,
} from './peerTopics';

// vk-final part 4, topics (COMMENTS-PLAN Revision 2 + coordinator 15.11).

const NOW = Date.parse('2026-11-15T19:00:00Z');
function result(topics: unknown[] = peerTopics()) {
  return parsePeerBoards(peerBody({ topics }));
}

describe('topic sections', () => {
  it('open, paused (needs_human first, then paused by a person) and resolved within 14 days', () => {
    const topics = result().peers[0]!.topics;
    const s = topicSections(topics, NOW);
    expect(s.open.map((x) => x.title)).toEqual(['Перезагрузка общего CI в 22:00']);
    expect(s.paused.map((x) => x.title)).toEqual(['Кто обновляет Node 24', 'Ночная сборка']);
    expect(s.resolved.map((x) => x.title)).toEqual(['Ключ Clerk']);
    expect(RESOLVED_WINDOW_MS).toBe(14 * 86_400_000);
    const late = topicSections(topics, Date.parse('2026-12-01T00:00:00Z'));
    expect(late.resolved).toEqual([]);
  });
});

describe('waitingOn', () => {
  it('the other side owes a reply when the last message is ours', () => {
    const [open, paused] = result().peers[0]!.topics;
    expect(waitingOn(open!)).toEqual({ side: 'peer', kind: 'mayor', since: '2026-11-15T18:40:00Z' });
    expect(waitingOn(paused!)).toEqual({ side: 'peer', kind: 'mayor', since: '2026-11-15T17:00:00Z' });
  });

  it('nobody owes when the last word is theirs, or the topic is resolved', () => {
    const topics = peerTopics();
    (topics[0]!.messages as unknown[]).push({
      id: 'm-3',
      author: { kind: 'mayor', city: 'rich', name: 'mayor' },
      text: 'Ждём.',
      created_at: '2026-11-15T18:52:00Z',
    });
    const [open, , , resolved] = result(topics).peers[0]!.topics;
    expect(waitingOn(open!)).toBeNull();
    expect(waitingOn(resolved!)).toBeNull();
  });
});

describe('unread', () => {
  it('the last unread_count messages from the other side are new', () => {
    const [open] = result().peers[0]!.topics;
    expect([...unreadIdsOf(open!)]).toEqual(['m-1']);
  });
});

// Security scan (15.11): a card's topics are matched only on trusted keys —
// the peer whose board carries the topic, and our own login from the city
// service — never on the city a peer writes into `topic.card`.
describe('topics linked to a card', () => {
  /** Two peers, rich and bob, each with their own board. */
  function twoPeers(richTopics: unknown[], bobTopics: unknown[] = []) {
    const body = peerBody({ topics: richTopics });
    const bob = structuredClone(body.peers[0]!) as Record<string, unknown>;
    bob.login = 'bob';
    bob.person = { name: 'Боб', genitive: 'Боба', initial: 'Б' };
    bob.topics = bobTopics;
    body.peers.push(bob as (typeof body.peers)[number]);
    return parsePeerBoards({ ...body, own_login: 'me' });
  }
  const topic = (id: string, card: unknown) => ({ ...peerTopics()[2]!, topic_id: id, card });

  it('his card: topics from his board whose card is {his login, rig, id}', () => {
    const found = topicsForCard(result(), { mine: false, city: 'rich', rig: 'crm-api', id: 'dw-ab12' });
    expect(found.map((f) => [f.login, f.topic.title])).toEqual([['rich', 'Перезагрузка общего CI в 22:00']]);
    expect(topicsForCard(result(), { mine: false, city: 'rich', rig: 'devwork', id: 'dw-ab12' })).toEqual([]);
  });

  it('a topic from peer A is never shown on peer B’s card', () => {
    // rich's board claims a topic about bob's card
    const res = twoPeers([topic('tp-x', { city: 'bob', rig: 'devwork', id: 'dw-1' })]);
    expect(topicsForCard(res, { mine: false, city: 'bob', rig: 'devwork', id: 'dw-1' })).toEqual([]);
    expect(topicsForCard(res, { mine: false, city: 'rich', rig: 'devwork', id: 'dw-1' })).toEqual([]);
  });

  it('my card: only topics whose card city is OUR login (from the city service)', () => {
    const res = parsePeerBoards({ ...peerBody({ topics: peerTopics() }), own_login: 'me' });
    const found = topicsForCard(res, { mine: true, city: 'me', rig: 'devwork', id: 'dw-ab12' });
    expect(found.map((f) => [f.login, f.topic.title])).toEqual([['rich', 'Кто обновляет Node 24']]);
  });

  it('a hostile peer claiming our card under another city name gets nothing', () => {
    const res = twoPeers([
      topic('tp-evil', { city: 'evil', rig: 'devwork', id: 'dw-ab12' }),
      topic('tp-bob', { city: 'bob', rig: 'devwork', id: 'dw-ab12' }),
    ]);
    expect(topicsForCard(res, { mine: true, city: 'me', rig: 'devwork', id: 'dw-ab12' })).toEqual([]);
  });

  it('our login unknown: our cards show no topics', () => {
    expect(topicsForCard(result(), { mine: true, city: null, rig: 'devwork', id: 'dw-ab12' })).toEqual([]);
  });
});

describe('postable topic', () => {
  it('a topic may be posted to only via the peer whose board carries it, owned by that peer or by us', () => {
    const res = parsePeerBoards({ ...peerBody({ topics: peerTopics() }), own_login: 'me' });
    const [open, ours] = res.peers[0]!.topics;
    expect(topicTarget(open!, 'rich', 'rich', 'me')).toEqual({ city: 'rich', topicId: 'tp-aaaaaaaaaaaaaaaaaaaa' });
    expect(topicTarget(ours!, 'rich', 'rich', 'me')).toEqual({ city: 'me', topicId: 'tp-bbbbbbbbbbbbbbbbbbbb' });
    // the board it came from is not the peer we would post to
    expect(topicTarget(open!, 'rich', 'bob', 'me')).toBeNull();
    // a topic city that is neither the peer nor us
    expect(topicTarget({ ...open!, city: 'evil' }, 'rich', 'rich', 'me')).toBeNull();
    // our login unknown: only the peer's own topics
    expect(topicTarget(ours!, 'rich', 'rich', null)).toBeNull();
  });
});

describe('«Нужно от меня» topics', () => {
  it('a topic paused by a person is not a need; a rejected open shows among the closed', () => {
    const topics = peerTopics();
    (topics[0] as Record<string, unknown>).status = 'rejected';
    const s = topicSections(result(topics).peers[0]!.topics, NOW);
    expect(s.open).toEqual([]);
    expect(s.resolved.map((x) => [x.title, x.status])).toEqual([
      ['Перезагрузка общего CI в 22:00', 'rejected'],
      ['Ключ Clerk', 'resolved'],
    ]);
  });

  it('lists needs_human topics (they count) and topics with unread (they do not)', () => {
    const needs = topicNeedsOf(result(), NOW);
    expect(needs.map((n) => [n.title, n.needsHuman, n.counts])).toEqual([
      ['Кто обновляет Node 24', true, true],
      ['Перезагрузка общего CI в 22:00', false, false],
    ]);
    const unread = needs[1]!;
    expect(unread.preview).toBe('Можно ли в 22:00 перезагрузить CI?');
    expect(unread.unread).toBe(1);
    expect(unread.href).toBe('/beads?topics=rich&topic=tp-aaaaaaaaaaaaaaaaaaaa');
  });
});
