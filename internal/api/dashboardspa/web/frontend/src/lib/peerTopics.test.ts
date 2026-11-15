import { describe, expect, it } from 'vitest';
import { parsePeerBoards } from '../supervisor/peerBoardReads';
import { peerBody, peerTopics } from '../test/fixtures/peerBoards';
import {
  ownLoginOf,
  RESOLVED_WINDOW_MS,
  topicNeedsOf,
  topicSections,
  topicsForCard,
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

describe('topics linked to a card', () => {
  it('his card: topics whose card is {his login, rig, id}', () => {
    const found = topicsForCard(result(), { peerLogin: 'rich', rig: 'crm-api', id: 'dw-ab12' });
    expect(found.map((f) => [f.login, f.topic.title])).toEqual([['rich', 'Перезагрузка общего CI в 22:00']]);
    expect(topicsForCard(result(), { peerLogin: 'rich', rig: 'devwork', id: 'dw-ab12' })).toEqual([]);
  });

  it('my card: topics whose card is in a city that is not a peer, same rig and id', () => {
    const found = topicsForCard(result(), { peerLogin: null, rig: 'devwork', id: 'dw-ab12' });
    expect(found.map((f) => [f.login, f.topic.title])).toEqual([['rich', 'Кто обновляет Node 24']]);
  });
});

describe('ownLoginOf', () => {
  it('learns our login from the topics: our topic’s city, or a peer topic’s `peer`', () => {
    expect(ownLoginOf(result())).toBe('me');
    const theirsOnly = peerTopics().filter((tp) => tp.mine === false);
    expect(ownLoginOf(result(theirsOnly))).toBe('me');
  });

  it('no topics: unknown', () => {
    expect(ownLoginOf(result([]))).toBeNull();
    expect(ownLoginOf(null)).toBeNull();
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
