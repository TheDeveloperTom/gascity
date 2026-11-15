import type { SupervisorBead } from '../supervisor/beadReads';
import { isRouteBead } from './stageBoard';

/**
 * What a bead is to the board (RB2): a task (a card), a route bead (folds
 * into its task) or service machinery (never a card; kept aside to name
 * blockers). Each marker is one the engine stamps for this purpose; the id
 * namespace is never read.
 */
export type BeadRole = 'task' | 'route' | 'service';

/** The work types the board fans out and shows as cards. */
export const TASK_TYPES: ReadonlySet<string> = new Set([
  'feature',
  'bug',
  'task',
  'epic',
  'chore',
  'decision',
]);

/** Engine `internal/orders/store.go:39`, stamped by `CreateRun`. */
export const ORDER_TRACKING_LABEL = 'order-tracking';

/** Engine-reserved labels, e.g. `gc:cross-store-gate`. */
export const ENGINE_LABEL_PREFIX = 'gc:';

export function beadRole(bead: SupervisorBead): BeadRole {
  if (isRouteBead(bead)) return 'route';
  if (!TASK_TYPES.has(bead.issue_type)) return 'service';
  const labels = Array.isArray(bead.labels) ? bead.labels : [];
  if (
    labels.some((label) => label.startsWith(ENGINE_LABEL_PREFIX) || label === ORDER_TRACKING_LABEL)
  ) {
    return 'service';
  }
  return 'task';
}
