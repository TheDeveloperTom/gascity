// I2 (REVIEW 16.11): the card avatar names the bead's real assignee.
// Live assignee values (16.11): agent sessions (`gcg-session-…`), pool or
// agent names (`devwork/worker`, `mayor`), the people's GitHub logins from
// assets/board-sync/people.json (`TheDeveloperTom` — the owner, `RicciRi` —
// Richard), or nothing.

export type AssigneeTone = 'owner' | 'executor' | 'peer';

const OWNER_ASSIGNEES: ReadonlySet<string> = new Set(['thedevelopertom', 'artem', 'артём', 'артем', 'owner', 'human']);
const RICHARD_ASSIGNEES: ReadonlySet<string> = new Set(['ricciri', 'richard', 'ричард']);

/**
 * Whose avatar a card shows: `owner` «А», `peer` «Р» (Richard), `executor`
 * «И» for any agent (the implementer pool and other engine sessions), null
 * when nobody is assigned. `working`: an in-work card with no assignee is
 * still an agent's run, so it keeps «И».
 */
export function assigneeTone(assignee: string | null | undefined, working: boolean): AssigneeTone | null {
  const name = assignee?.trim() ?? '';
  if (name.length === 0) return working ? 'executor' : null;
  const key = name.toLowerCase();
  if (OWNER_ASSIGNEES.has(key)) return 'owner';
  if (RICHARD_ASSIGNEES.has(key)) return 'peer';
  return 'executor';
}
