import { describe, expect, it } from 'vitest';
import type { PeerBoardsResult } from '../supervisor/peerBoardReads';
import {
  asOfClock,
  boardSourcesOf,
  DEFAULT_OWNER,
  ownerChoicesEnabled,
  peerSourcesOf,
} from './boardOwner';

const RESULT: PeerBoardsResult = {
  heartbeatSeconds: 900,
  staleAfterSeconds: 1500,
  peers: [
    {
      login: 'rich',
      person: { name: 'Ричард', genitive: 'Ричарда', initial: 'Р' },
      city: 'devwork-platform',
      asOf: '2026-11-15T14:05:00Z',
      rigs: ['crm-api'],
      fetchError: null,
      cards: [{ rig: 'crm-api', bead: { id: 'dw-1', title: 't', status: 'open', issue_type: 'task', created_at: '2026-11-15T10:00:00Z' } }],
    },
  ],
};

describe('board sources (owner seam)', () => {
  it('defaults to one source owned by me', () => {
    const sources = boardSourcesOf([]);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.owner).toBe('me');
    expect(sources[0]?.available).toBe(true);
    expect(DEFAULT_OWNER).toBe('me');
    expect(ownerChoicesEnabled(sources)).toBe(false);
  });

  it('a peer board maps to owner peer:<login>, label «Ричарда», avatar «Р», read-only', () => {
    const now = Date.parse('2026-11-15T14:10:00Z');
    const [peer] = peerSourcesOf(RESULT, now);
    expect(peer).toMatchObject({
      owner: 'peer:rich',
      login: 'rich',
      label: 'Ричарда',
      name: 'Ричард',
      avatar: 'Р',
      available: true,
      asOf: '2026-11-15T14:05:00Z',
      stale: false,
    });
    expect(peer?.cards).toHaveLength(1);
    expect(ownerChoicesEnabled(boardSourcesOf([peer!]))).toBe(true);
  });

  it('stale after stale_after_seconds (from the service), not before', () => {
    const asOf = Date.parse('2026-11-15T14:05:00Z');
    expect(peerSourcesOf(RESULT, asOf + 1500_000)[0]?.stale).toBe(false);
    expect(peerSourcesOf(RESULT, asOf + 1500_001)[0]?.stale).toBe(true);
    const short = { ...RESULT, staleAfterSeconds: 60 };
    expect(peerSourcesOf(short, asOf + 61_000)[0]?.stale).toBe(true);
  });

  it('an unreadable snapshot time counts as stale', () => {
    const broken = { ...RESULT, peers: [{ ...RESULT.peers[0]!, asOf: 'not a time' }] };
    expect(peerSourcesOf(broken, Date.now())[0]?.stale).toBe(true);
  });

  it('asOfClock names the local HH:MM of the last snapshot', () => {
    const [peer] = peerSourcesOf(RESULT, Date.parse('2026-11-15T15:00:00Z'));
    const local = new Date('2026-11-15T14:05:00Z');
    const hhmm = `${String(local.getHours()).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}`;
    expect(asOfClock(peer!.asOf)).toBe(hhmm);
  });
});
