// I2 (REVIEW 16.11): the card avatar names the bead's real assignee.
// Live assignee values (16.11): agent sessions (`gcg-session-…`), pool or
// agent names (`devwork/worker`, `mayor`), the people's GitHub logins from
// assets/board-sync/people.json, or nothing.
//
// owner 16.11: «me» and «the peer» come from the city's identity
// (lib/selfIdentity), so Richard's city sees his cards as his own. Without
// an identity (the login did not read) a person gets no avatar, never a guess.

import type { SelfIdentity } from '../../lib/selfIdentity';

export type AssigneeTone = 'owner' | 'executor' | 'peer';

export interface CardAssignee {
  tone: AssigneeTone;
  letter: string;
  /** The peer's name («Ричард») for the label; null for me, an agent or unknown. */
  who: string | null;
}

const GENERIC_ME: ReadonlySet<string> = new Set(['owner', 'human']);
// Assignees that name a person, not an agent: shown with no avatar while the
// viewer is unknown (no guess whether it is me or the peer).
const PEOPLE_NAMES: ReadonlySet<string> = new Set([
  'thedevelopertom', 'artem', 'артём', 'артем', 'ricciri', 'richard', 'ричард', ...GENERIC_ME,
]);

const EXECUTOR: CardAssignee = { tone: 'executor', letter: 'И', who: null };

/**
 * Whose avatar a card shows: me (`owner`, my initial), a peer (`peer`, the
 * peer's initial), `executor` «И» for any agent, null when nobody is
 * assigned. `working`: an in-work card with no assignee is still an agent's
 * run, so it keeps «И».
 */
export function cardAssignee(
  assignee: string | null | undefined,
  working: boolean,
  identity: SelfIdentity,
): CardAssignee | null {
  const name = assignee?.trim() ?? '';
  if (name.length === 0) return working ? EXECUTOR : null;
  const key = name.toLowerCase();
  if (identity.login === null) {
    // Unknown viewer: no owner/peer guess for a person; agents keep «И».
    if (PEOPLE_NAMES.has(key)) return null;
    return EXECUTOR;
  }
  const mine =
    GENERIC_ME.has(key) || key === identity.login.toLowerCase() || key === identity.name?.toLowerCase();
  if (mine) return { tone: 'owner', letter: identity.initial, who: null };
  const peer = identity.peers.find((p) => key === p.login.toLowerCase() || key === p.name.toLowerCase());
  if (peer !== undefined) return { tone: 'peer', letter: peer.initial, who: peer.name };
  return EXECUTOR;
}
