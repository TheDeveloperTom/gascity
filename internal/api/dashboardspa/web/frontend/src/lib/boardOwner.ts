// The ONE seam for «Мои / Ричарда» (vk lane 4, owner; vk-final part 3 plugs
// in the peer boards). Other lanes import it.

import type { PeerBoardsResult, PeerCard, PeerLive, PeerRuns } from '../supervisor/peerBoardReads';

export type CardOwner = 'me' | `peer:${string}`;
export type OwnerFilter = 'all' | CardOwner;
export const DEFAULT_OWNER: CardOwner = 'me';

/** One board source: mine, or one peer city's read-only board. */
export interface BoardSource {
  owner: CardOwner;
  label: string;
  available: boolean;
}

/** A peer's board (SYNC-PLAN Q4 `ExtraBoardSource`): read-only, with its snapshot time. */
export interface PeerBoardSource extends BoardSource {
  owner: `peer:${string}`;
  login: string;
  /** The person's name («Ричард»); `label` is the genitive («Ричарда»). */
  name: string;
  /** The dative («Ричарду») when people.json carries it; else null. */
  dative: string | null;
  /** One-letter avatar («Р»). */
  avatar: string;
  /** ISO time of the snapshot (`generated_at`, else `snapshot_at`). */
  asOf: string;
  /**
   * Not current. With a live block (BOARD-LIVE): the connection is not live.
   * An old peer: the snapshot is older than the service's `stale_after_seconds`.
   */
  stale: boolean;
  cards: readonly PeerCard[];
  /** BOARD-LIVE C4: the live connection; null for a peer not yet upgraded. */
  live: PeerLive | null;
  /** When our client last received the board (our clock). */
  fetchedAt: string | null;
  /** The service's last read of this board failed (`fetch_error`); null when it read. */
  fetchError: string | null;
  /**
   * PEER-STAGE: the peer's open runs of its shared cards, placed with the same
   * stage rules as ours; null for a city that sends none (status placement).
   */
  runs: PeerRuns | null;
}

const MINE: BoardSource = { owner: 'me', label: 'Mine', available: true };

/** Mine first, then every peer board. */
export function boardSourcesOf(peers: readonly PeerBoardSource[]): readonly BoardSource[] {
  return [MINE, ...peers];
}

/** The service result as sources; `stale` uses the service's own threshold. */
export function peerSourcesOf(result: PeerBoardsResult, nowMs: number): PeerBoardSource[] {
  return result.peers.map((peer) => {
    const at = Date.parse(peer.asOf);
    return {
      owner: `peer:${peer.login}`,
      login: peer.login,
      label: peer.person.genitive,
      name: peer.person.name,
      dative: peer.person.dative,
      avatar: peer.person.initial,
      available: true,
      asOf: peer.asOf,
      // Review Focus 4: with a live block, «current» is our own connection
      // state, never an age measured against the peer's clock.
      stale:
        peer.live !== null
          ? peer.live.state !== 'live'
          : !Number.isFinite(at) || nowMs - at > result.staleAfterSeconds * 1000,
      cards: peer.cards,
      live: peer.live,
      fetchedAt: peer.fetchedAt,
      fetchError: peer.fetchError,
      runs: peer.runs,
    };
  });
}

/** Local «HH:MM» of an ISO time («на 18:52»); '' when it does not parse. */
export function asOfClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** «Мои» and «Ричарда» only mean something once two or more sources answer. */
export function ownerChoicesEnabled(sources: readonly BoardSource[]): boolean {
  return sources.filter((s) => s.available).length >= 2;
}

export function isPeerOwner(owner: CardOwner): owner is `peer:${string}` {
  return owner !== 'me';
}
