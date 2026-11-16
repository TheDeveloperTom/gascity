import { useMemo } from 'react';
import { usePeerBoardsResult } from '../hooks/usePeerBoards';
import type { PeerBoardsResult } from '../supervisor/peerBoardReads';

// owner 16.11: «who am I» comes from the city, not from code. The same engine
// runs in Artem's city (login TheDeveloperTom) and in Richard's (RicciRi).
// Our city service (peer-boards /v1/boards) states `own_login` (the login
// `board-setup --login` recorded) and `own_person` (that login's row of OUR
// people.json); the peers are the other people, from their boards.

export interface Person {
  login: string;
  name: string;
  /** One-letter avatar («Р»). */
  initial: string;
  /** «Ричарда» */
  genitive: string;
}

export interface SelfIdentity {
  /** Our own login; null when the city has not said (fallback look). */
  login: string | null;
  /** Our person's name («Артём»); null when unknown. */
  name: string | null;
  /** The rail avatar letter. */
  initial: string;
  /** The other people (peer cities). */
  peers: readonly Person[];
}

/** Unknown viewer (the login did not read): neutral, never a guess at a person. */
export const FALLBACK_IDENTITY: SelfIdentity = { login: null, name: null, initial: '?', peers: [] };

export function selfIdentityOf(result: PeerBoardsResult | null): SelfIdentity {
  if (result === null) return FALLBACK_IDENTITY;
  const peers: Person[] = result.peers
    .filter((p) => p.login !== result.ownLogin)
    .map((p) => ({ login: p.login, name: p.person.name, initial: p.person.initial, genitive: p.person.genitive }));
  const login = result.ownLogin;
  if (login === null) return { ...FALLBACK_IDENTITY, peers };
  const own = result.ownPerson;
  return {
    login,
    name: own?.name ?? null,
    initial: own?.initial ?? login.charAt(0).toUpperCase(),
    peers,
  };
}

/** The city's identity, from the shared peer-boards reader (no tick re-renders). */
export function useSelfIdentity(): SelfIdentity {
  const result = usePeerBoardsResult();
  return useMemo(() => selfIdentityOf(result), [result]);
}
