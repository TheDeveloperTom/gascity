import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLocale } from '../i18n';
import { asOfClock, type PeerBoardSource } from './boardOwner';
import { emptyBoardNote } from './emptyBoardNote';
import type { PeerLive } from '../supervisor/peerBoardReads';

const AT = '2026-11-17T09:05:00Z';

function peer(over: Partial<PeerBoardSource> = {}): PeerBoardSource {
  return {
    owner: 'peer:rich',
    login: 'rich',
    label: 'Ричарда',
    name: 'Ричард',
    dative: null,
    avatar: 'Р',
    available: true,
    asOf: AT,
    stale: false,
    cards: [],
    live: null,
    fetchedAt: AT,
    fetchError: null,
    runs: null,
    ...over,
  };
}

function live(state: PeerLive['state'], error: string | null = null): PeerLive {
  return { version: 3, asOf: AT, state, since: AT, error, peerOnline: null, peerLastSeen: null };
}

beforeEach(() => setLocale('ru'));
afterEach(() => setLocale('en'));

describe('emptyBoardNote', () => {
  it('«Все» / «Мои» empty: the plain filter line', () => {
    expect(emptyBoardNote('all', [peer()])).toBe('В этом фильтре сейчас нет задач');
    expect(emptyBoardNote('me', [peer()])).toBe('В этом фильтре сейчас нет задач');
  });

  it('his board live and empty: «связь живая, обновлено HH:MM»', () => {
    expect(emptyBoardNote('peer:rich', [peer({ live: live('live') })])).toBe(
      `Город Ричарда сейчас не передаёт ни одной задачи · связь живая, обновлено ${asOfClock(AT)}`,
    );
  });

  it('an old peer (no live block): only «обновлено HH:MM», no claim the link is live', () => {
    expect(emptyBoardNote('peer:rich', [peer()])).toBe(
      `Город Ричарда сейчас не передаёт ни одной задачи · обновлено ${asOfClock(AT)}`,
    );
  });

  it('a failed read or a link that is not live: «Нет связи с городом Ричарда: …»', () => {
    expect(emptyBoardNote('peer:rich', [peer({ fetchError: 'timeout' })])).toBe(
      'Нет связи с городом Ричарда: timeout',
    );
    expect(emptyBoardNote('peer:rich', [peer({ live: live('reconnecting') })])).toBe(
      'Нет связи с городом Ричарда: переподключаемся',
    );
    expect(emptyBoardNote('peer:rich', [peer({ live: live('offline') })])).toBe(
      'Нет связи с городом Ричарда: город не в сети',
    );
    expect(emptyBoardNote('peer:rich', [peer({ live: live('offline', 'auth') })])).toBe(
      'Нет связи с городом Ричарда: auth',
    );
  });

  it('his board has cards but other filters emptied it: the plain filter line', () => {
    const card = { rig: 'crm-api', bead: { id: 'x', title: 'x', status: 'open', created_at: AT } };
    expect(emptyBoardNote('peer:rich', [peer({ cards: [card as never] })])).toBe('В этом фильтре сейчас нет задач');
  });
});
