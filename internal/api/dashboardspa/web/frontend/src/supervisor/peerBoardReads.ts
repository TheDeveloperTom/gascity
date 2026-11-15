import { z } from 'zod';
import { getActiveCity } from '../api/cityBase';
import { authHeaders, withApiBase } from '../lib/apiBase';
import type { SupervisorBead } from './beadReads';

// vk-final part 3 (SYNC-PLAN Task 5): the peers' boards, read-only, from the
// city-pack service `peer-boards` (`/v0/city/<city>/svc/peer-boards/v1/boards`,
// a sanctioned untyped /svc surface the pack process owns). The schema
// follows the service body (sync/b + sync/rigs 27457ed0) and stays loose:
// every object accepts fields the city adds later (changed_at, rig,
// heartbeat_seconds, stale_after_seconds, dropped_cards, board_schema, rigs,
// skipped_rigs, threads …). Only the fields the board reads are checked.

/** A `devwork.board/1` peer's cards have no `rig`; all of them come from devwork. */
export const PEER_DEFAULT_RIG = 'devwork';
/** Used when the service does not send `stale_after_seconds` (25 min). */
export const DEFAULT_STALE_AFTER_SECONDS = 1500;

// The city's own allowlists (common.py ID_RE, RIG_RE, login).
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const RIG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const LOGIN_RE = /^[A-Za-z0-9-]{1,39}$/;

const optString = z.string().nullish();

const CardSchema = z.looseObject({
  id: z.string().regex(ID_RE),
  title: z.string(),
  status: z.string(),
  issue_type: optString,
  priority: z.number().nullish(),
  labels: z.array(z.string()).nullish(),
  parent: optString,
  created_at: optString,
  updated_at: optString,
  closed_at: optString,
  description: optString,
  metadata: z.record(z.string(), z.string()).nullish(),
  needs: z.array(z.string()).nullish(),
  rig: z.string().regex(RIG_RE).nullish(),
});

const PeerSchema = z.looseObject({
  login: z.string().regex(LOGIN_RE),
  person: z.looseObject({ name: z.string(), genitive: z.string(), initial: z.string() }),
  city: optString,
  snapshot_at: z.string(),
  generated_at: optString,
  changed_at: optString,
  fetched_at: optString,
  fetch_error: optString,
  fetch_failed_at: optString,
  board_schema: optString,
  rigs: z.array(z.string()).nullish(),
  skipped_rigs: z.array(z.looseObject({ rig: z.string() })).nullish(),
  dropped_cards: z.number().nullish(),
  cards: z.array(CardSchema),
});

const ResponseSchema = z.looseObject({
  schema: optString,
  heartbeat_seconds: z.number().nullish(),
  stale_after_seconds: z.number().positive().nullish(),
  peers: z.array(PeerSchema),
});

export interface PeerCard {
  rig: string;
  bead: SupervisorBead;
}

export interface PeerBoard {
  login: string;
  person: { name: string; genitive: string; initial: string };
  city: string | null;
  /** The snapshot's time: `generated_at`, else `snapshot_at`. */
  asOf: string;
  rigs: readonly string[] | null;
  fetchError: string | null;
  cards: readonly PeerCard[];
}

export interface PeerBoardsResult {
  peers: readonly PeerBoard[];
  heartbeatSeconds: number | null;
  staleAfterSeconds: number;
}

export class PeerBoardsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PeerBoardsError';
  }
}

const EMPTY: PeerBoardsResult = {
  peers: [],
  heartbeatSeconds: null,
  staleAfterSeconds: DEFAULT_STALE_AFTER_SECONDS,
};

function toBead(card: z.infer<typeof CardSchema>, fallbackCreated: string): SupervisorBead {
  const bead: SupervisorBead = {
    id: card.id,
    title: card.title,
    status: card.status,
    issue_type: card.issue_type ?? 'task',
    created_at: card.created_at ?? fallbackCreated,
  };
  if (card.priority != null) bead.priority = card.priority;
  if (card.labels != null) bead.labels = card.labels;
  if (card.parent != null && card.parent !== '') bead.parent = card.parent;
  if (card.updated_at != null) bead.updated_at = card.updated_at;
  if (card.description != null) bead.description = card.description;
  if (card.metadata != null) bead.metadata = card.metadata;
  if (card.needs != null) bead.needs = card.needs;
  return bead;
}

export function peerBoardsUrl(city: string): string {
  return `/v0/city/${encodeURIComponent(city)}/svc/peer-boards/v1/boards`;
}

/** Parses a `/v1/boards` body; throws PeerBoardsError when it is not the contract. */
export function parsePeerBoards(body: unknown): PeerBoardsResult {
  const parsed = ResponseSchema.safeParse(body);
  if (!parsed.success) throw new PeerBoardsError(`peer-boards: ${parsed.error.issues[0]?.message ?? 'bad body'}`);
  const res = parsed.data;
  return {
    heartbeatSeconds: res.heartbeat_seconds ?? null,
    staleAfterSeconds: res.stale_after_seconds ?? DEFAULT_STALE_AFTER_SECONDS,
    peers: res.peers.map((p) => {
      const asOf = p.generated_at ?? p.snapshot_at;
      return {
        login: p.login,
        person: { name: p.person.name, genitive: p.person.genitive, initial: p.person.initial },
        city: p.city ?? null,
        asOf,
        rigs: p.rigs ?? null,
        fetchError: p.fetch_error ?? null,
        cards: p.cards.map((c) => ({ rig: c.rig ?? PEER_DEFAULT_RIG, bead: toBead(c, asOf) })),
      };
    }),
  };
}

/** The peers' boards. 404/503 (the service is not running) is no peers. */
export async function listPeerBoards(signal?: AbortSignal): Promise<PeerBoardsResult> {
  const city = getActiveCity();
  if (city === null) return EMPTY;
  const res = await fetch(withApiBase(peerBoardsUrl(city)), {
    method: 'GET',
    headers: { ...authHeaders(), Accept: 'application/json' },
    ...(signal ? { signal } : {}),
  });
  if (res.status === 404 || res.status === 503) return EMPTY;
  if (!res.ok) throw new PeerBoardsError(`peer-boards: HTTP ${res.status}`);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new PeerBoardsError('peer-boards: not JSON');
  }
  return parsePeerBoards(body);
}
