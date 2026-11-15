// Epics for the board filter and ⌘K (vk lane 4, owner). An epic is a
// milestone: tasks carry a `milestone:M04` label, and an `issue_type: 'epic'`
// bead with the same label gives the epic its name.
import { t } from '../i18n';
import type { SupervisorBead } from '../supervisor/beadReads';
import { beadRole } from './boardRoles';
import { milestoneOf } from './waitReasons';

export const ALL_EPICS = 'all';
export const NO_EPIC = 'none';

export interface EpicSummary {
  key: string;
  name: string | null;
  done: number;
  total: number;
  approx: boolean;
}

function milestoneNumber(key: string): number {
  const m = /\d+/.exec(key);
  return m === null ? Number.POSITIVE_INFINITY : Number(m[0]);
}

function byMilestone(a: string, b: string): number {
  return milestoneNumber(a) - milestoneNumber(b) || a.localeCompare(b);
}

/** The epic title without a leading «M04 ·» (the key is shown beside it). */
function epicName(key: string, title: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const name = title.replace(new RegExp(`^\\s*${escaped}\\s*[·:—–-]?\\s*`), '').trim();
  return name.length > 0 && name !== key ? name : null;
}

function isEpicBead(bead: SupervisorBead): boolean {
  return bead.issue_type === 'epic';
}

function isTask(bead: SupervisorBead): boolean {
  return !isEpicBead(bead) && beadRole(bead) === 'task';
}

/** Epic names by milestone key, from the epic beads. */
export function epicNames(items: readonly SupervisorBead[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const bead of items) {
    if (!isEpicBead(bead)) continue;
    const key = milestoneOf(bead);
    if (key === null || names.has(key)) continue;
    const name = epicName(key, bead.title ?? '');
    if (name !== null) names.set(key, name);
  }
  return names;
}

/**
 * One summary per milestone that has tasks, sorted by milestone number, plus a
 * trailing NO_EPIC entry when any task has no milestone. `closedCapped` means
 * the closed window was cut, so `done` is a lower bound (rendered «≈»).
 */
export function epicSummaries(
  items: readonly SupervisorBead[],
  opts: { closedCapped?: boolean } = {},
): EpicSummary[] {
  const approx = opts.closedCapped === true;
  const names = epicNames(items);
  const counts = new Map<string, { done: number; total: number }>();
  const none = { done: 0, total: 0 };
  for (const bead of items) {
    if (!isTask(bead)) continue;
    const key = milestoneOf(bead);
    const slot = key === null ? none : (counts.get(key) ?? { done: 0, total: 0 });
    if (key !== null) counts.set(key, slot);
    slot.total += 1;
    if (bead.status === 'closed') slot.done += 1;
  }
  const out: EpicSummary[] = [...counts.keys()].sort(byMilestone).map((key) => {
    const c = counts.get(key) ?? { done: 0, total: 0 };
    return { key, name: names.get(key) ?? null, done: c.done, total: c.total, approx };
  });
  if (none.total > 0) {
    out.push({ key: NO_EPIC, name: t('No epic — fixes and small things'), ...none, approx });
  }
  return out;
}

/** Milestones that have an epic bead but no tasks yet («плана ещё нет»). */
export function plannedEmptyMilestones(items: readonly SupervisorBead[]): string[] {
  const withTasks = new Set<string>();
  for (const bead of items) {
    if (!isTask(bead)) continue;
    const key = milestoneOf(bead);
    if (key !== null) withTasks.add(key);
  }
  const empty = new Set<string>();
  for (const bead of items) {
    if (!isEpicBead(bead)) continue;
    const key = milestoneOf(bead);
    if (key !== null && !withTasks.has(key)) empty.add(key);
  }
  return [...empty].sort(byMilestone);
}

/** «M05–M13» for a sorted list of keys, «M07» for one, null for none. */
export function milestoneRangeLabel(keys: readonly string[]): string | null {
  if (keys.length === 0) return null;
  const first = keys[0] ?? '';
  const last = keys[keys.length - 1] ?? '';
  return first === last ? first : `${first}–${last}`;
}

/** «7 из 21», with «≈» when the closed count is a lower bound. */
export function epicProgress(e: Pick<EpicSummary, 'done' | 'total' | 'approx'>): string {
  return t('{done} of {total}', { done: `${e.approx ? '≈' : ''}${e.done}`, total: e.total });
}

/** «M04 · Понимание вакансии», or the bare name for NO_EPIC. */
export function epicLabel(e: Pick<EpicSummary, 'key' | 'name'>): string {
  if (e.key === NO_EPIC) return e.name ?? t('No epic — fixes and small things');
  return e.name === null ? e.key : `${e.key} · ${e.name}`;
}
