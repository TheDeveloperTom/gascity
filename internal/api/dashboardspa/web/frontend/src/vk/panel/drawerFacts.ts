import { t } from '../../i18n';
import { milestoneOf } from '../../lib/waitReasons';
import type { SupervisorBead } from '../../supervisor/beadReads';

// The open-task panel's short facts (vk-1to1 drawer lane, canvas Main right
// panel): the breadcrumb label «M04 #3», the PR «#580», the kind «Подзадача
// M04». Never the raw bead id when anything shorter is known.

function meta(bead: SupervisorBead, key: string): string {
  return bead.metadata?.[key]?.trim() ?? '';
}

/** Trailing number of a step name or title («… раунд 3», «шаг 3»), else null. */
function ordinal(bead: SupervisorBead): string | null {
  const step = meta(bead, 'devwork.step') || meta(bead, 'step');
  if (/^\d+$/.test(step)) return step;
  return null;
}

/**
 * The drawer's short label (canvas «M04 #3»): the milestone plus the step
 * number when known, the milestone alone otherwise; with no milestone, the
 * id's short tail («1baxx4») so the crumb is never the full raw id.
 */
export function taskShortLabel(bead: SupervisorBead): string {
  const tag = milestoneOf(bead);
  const n = ordinal(bead);
  if (tag !== null) return n === null ? tag : `${tag} #${n}`;
  const id = typeof bead.id === 'string' ? bead.id : '';
  const dash = id.lastIndexOf('-');
  return dash >= 0 && dash < id.length - 1 ? id.slice(dash + 1) : id;
}

export interface TaskPr {
  number: string;
  url: string | null;
}

function safeHttps(raw: string): string | null {
  if (raw.length === 0) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function prOf(bead: SupervisorBead): TaskPr | null {
  const number = (meta(bead, 'devwork.pr_number') || meta(bead, 'pr_number')).replace(/^#/, '');
  if (number.length === 0) return null;
  return { number, url: safeHttps(meta(bead, 'devwork.pr_url') || meta(bead, 'pr_url')) };
}

const LAND_TASK_KEYS = ['land_source', 'gc.source_bead_id', 'devwork.task'] as const;

/** The task's PR: its own, else its land bead's (same rule as the board). */
export function taskPr(bead: SupervisorBead, items: readonly SupervisorBead[]): TaskPr | null {
  const own = prOf(bead);
  if (own !== null) return own;
  const landId = meta(bead, 'devwork.land_bead');
  for (const other of items) {
    if (other.id === bead.id) continue;
    const isLand = other.id === landId || LAND_TASK_KEYS.some((k) => meta(other, k) === bead.id);
    if (!isLand) continue;
    const pr = prOf(other);
    if (pr !== null) return pr;
  }
  return null;
}

/** «Подзадача» when the task has a parent, «Эпик» for an epic, else «Задача». */
export function taskKind(bead: SupervisorBead): string {
  if (bead.issue_type === 'epic') return t('Epic');
  const hasParent =
    (typeof bead.parent === 'string' && bead.parent.length > 0) ||
    (bead.dependencies ?? []).some((d) => d.type === 'parent-child' && d.issue_id === bead.id);
  return hasParent ? t('Subtask') : t('Task');
}

/** First letter of the assignee's role for the avatar chip («И»). */
export function assigneeInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase();
}

/** Status dot colour (canvas: «В работе» #F59E0B). */
export function statusDot(status: string): string {
  switch (status) {
    case 'in_progress':
      return '#F59E0B';
    case 'blocked':
      return '#EF4444';
    case 'closed':
      return '#22C55E';
    case 'deferred':
      return '#64748B';
    default:
      return '#94A3B8';
  }
}
