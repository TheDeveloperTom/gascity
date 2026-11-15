// Seam stub (vk lane 0b). Owner: lane 4. Other lanes import, never edit.
import type { SupervisorBead } from '../supervisor/beadReads';

export const ALL_EPICS = 'all';
export const NO_EPIC = 'none';

export interface EpicSummary {
  key: string;
  name: string | null;
  done: number;
  total: number;
  approx: boolean;
}

export function epicSummaries(
  _items: readonly SupervisorBead[],
  _opts: { closedCapped?: boolean } = {},
): EpicSummary[] {
  return [];
}
