import { describe, expect, it } from 'vitest';
import { cardAssignee } from '../vk/board/cardAssignee';
import { parsePeerBoards } from '../supervisor/peerBoardReads';
import { FALLBACK_IDENTITY, selfIdentityOf } from './selfIdentity';

// owner 16.11: «who am I» comes from the city (own_login + own_person on
// /v1/boards, from $st/login and OUR people.json), not from code. The same
// engine runs in Richard's city (login RicciRi), where Artem is the peer.

const ARTEM = { name: 'Артём', genitive: 'Артёма', initial: 'А', dative: 'Артёму' };
const RICHARD = { name: 'Ричард', genitive: 'Ричарда', initial: 'Р', dative: 'Ричарду' };

function boards(own: string | null, ownPerson: object | null, peer: { login: string; person: object }) {
  return parsePeerBoards({
    schema: 'devwork.peer-boards/1',
    own_login: own,
    own_person: ownPerson,
    stale_after_seconds: 60,
    peers: [{ login: peer.login, person: peer.person, snapshot_at: '2026-11-16T10:00:00Z', cards: [] }],
  });
}

const AT_RICHARD = selfIdentityOf(boards('RicciRi', RICHARD, { login: 'TheDeveloperTom', person: ARTEM }));
const AT_ARTEM = selfIdentityOf(boards('TheDeveloperTom', ARTEM, { login: 'RicciRi', person: RICHARD }));

describe('selfIdentityOf', () => {
  it("in Richard's city: I am «Р» Ричард, the peer is Артём", () => {
    expect(AT_RICHARD.login).toBe('RicciRi');
    expect(AT_RICHARD.initial).toBe('Р');
    expect(AT_RICHARD.name).toBe('Ричард');
    expect(AT_RICHARD.peers.map((p) => [p.login, p.initial, p.genitive])).toEqual([
      ['TheDeveloperTom', 'А', 'Артёма'],
    ]);
  });

  it('in our city: today’s look, «А» Артём', () => {
    expect(AT_ARTEM.initial).toBe('А');
    expect(AT_ARTEM.name).toBe('Артём');
  });

  it('no result or no own_login: the fallback (today’s behaviour)', () => {
    expect(selfIdentityOf(null)).toEqual(FALLBACK_IDENTITY);
    const unknown = selfIdentityOf(boards(null, null, { login: 'RicciRi', person: RICHARD }));
    expect(unknown.login).toBeNull();
    expect(unknown.initial).toBe('А');
  });

  it('own_login without own_person (an older city service): the login’s letter', () => {
    const id = selfIdentityOf(boards('RicciRi', null, { login: 'TheDeveloperTom', person: ARTEM }));
    expect(id.login).toBe('RicciRi');
    expect(id.initial).toBe('R');
  });

  it('a malformed own_person is ignored, never a crash', () => {
    const id = selfIdentityOf(boards('RicciRi', { name: 5 }, { login: 'TheDeveloperTom', person: ARTEM }));
    expect(id.initial).toBe('R');
  });
});

describe('cardAssignee with the city identity', () => {
  it("in Richard's city: his cards are mine, Artem's are the peer's «А»", () => {
    expect(cardAssignee('RicciRi', false, AT_RICHARD)).toEqual({ tone: 'owner', letter: 'Р', who: null });
    expect(cardAssignee('ричард', false, AT_RICHARD)?.tone).toBe('owner');
    expect(cardAssignee('TheDeveloperTom', false, AT_RICHARD)).toEqual({ tone: 'peer', letter: 'А', who: 'Артём' });
    expect(cardAssignee('Артём', false, AT_RICHARD)?.tone).toBe('peer');
  });

  it('in our city: today’s look', () => {
    expect(cardAssignee('TheDeveloperTom', false, AT_ARTEM)).toEqual({ tone: 'owner', letter: 'А', who: null });
    expect(cardAssignee('RicciRi', false, AT_ARTEM)).toEqual({ tone: 'peer', letter: 'Р', who: 'Ричард' });
  });

  it('agents are the executor «И»; nobody is null unless the card is working', () => {
    expect(cardAssignee('devwork/worker', false, AT_RICHARD)).toEqual({ tone: 'executor', letter: 'И', who: null });
    expect(cardAssignee('', false, AT_RICHARD)).toBeNull();
    expect(cardAssignee(null, true, AT_RICHARD)?.tone).toBe('executor');
  });

  it('unknown identity: today’s fixed mapping', () => {
    expect(cardAssignee('TheDeveloperTom', false, FALLBACK_IDENTITY)?.tone).toBe('owner');
    expect(cardAssignee('RicciRi', false, FALLBACK_IDENTITY)).toEqual({ tone: 'peer', letter: 'Р', who: null });
    expect(cardAssignee('human', false, FALLBACK_IDENTITY)?.letter).toBe('А');
  });
});
