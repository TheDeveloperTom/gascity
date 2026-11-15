import { createContext, useContext, useMemo, type ReactNode } from 'react';
import {
  composeAttention,
  type AttentionContributor,
  type AttentionModel,
  type OwnerReadiness,
} from './compose';
import type { BeadSnapshot } from './liveContributors';

// Without a provider nothing has been read, so the owner slice is loading —
// never an all-clear (R12).
const EMPTY_ATTENTION = composeAttention([], { ownerReadiness: { state: 'loading' } });
const AttentionContext = createContext<AttentionModel>(EMPTY_ATTENTION);
const BeadSnapshotContext = createContext<BeadSnapshot | undefined>(undefined);

const READY: OwnerReadiness = { state: 'ready' };

export function AttentionProvider({
  contributors,
  topLimit,
  ownerReadiness = READY,
  beadSnapshot,
  children,
}: {
  contributors: readonly AttentionContributor[];
  topLimit?: number;
  ownerReadiness?: OwnerReadiness;
  beadSnapshot?: BeadSnapshot;
  children: ReactNode;
}) {
  const model = useMemo(
    () =>
      composeAttention(contributors, {
        ownerReadiness,
        ...(topLimit === undefined ? {} : { topLimit }),
      }),
    [contributors, topLimit, ownerReadiness],
  );

  return (
    <AttentionContext.Provider value={model}>
      <BeadSnapshotContext.Provider value={beadSnapshot}>{children}</BeadSnapshotContext.Provider>
    </AttentionContext.Provider>
  );
}

export function useAttentionModel(): AttentionModel {
  return useContext(AttentionContext);
}

/** The attention bead read (tasks + route beads), shared with Home (R6). */
export function useBeadSnapshot(): BeadSnapshot | undefined {
  return useContext(BeadSnapshotContext);
}
