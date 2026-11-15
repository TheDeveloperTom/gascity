import { useMemo } from 'react';
import { useNow } from '../contexts/NowContext';
import { peerSourcesOf, type PeerBoardSource } from '../lib/boardOwner';
import { listPeerBoards, type PeerBoardsResult } from '../supervisor/peerBoardReads';
import { useAbortableVisibleRefresh } from './useAbortableVisibleRefresh';

// vk-final part 3: the peers' boards as board sources. One plain GET every
// 30 s while the page is visible (the city syncs in ~30–60 s); no event
// stream, so it never takes one of the browser's six connections.

export const PEER_BOARDS_POLL_MS = 30_000;

export interface PeerBoardsState {
  sources: readonly PeerBoardSource[];
  /** The service answered with something that is not its contract. */
  error: string | null;
  /** The raw result (threads and topics for the comments UI). */
  result: PeerBoardsResult | null;
}

const NONE: readonly PeerBoardSource[] = [];

function load(signal: AbortSignal): Promise<PeerBoardsResult> {
  return listPeerBoards(signal);
}

export function usePeerBoards(enabled = true): PeerBoardsState {
  const state = useAbortableVisibleRefresh({ enabled, intervalMs: PEER_BOARDS_POLL_MS, load });
  const nowMs = useNow();
  const result = state.status === 'ready' ? state.data : null;
  const sources = useMemo(
    () => (result === null ? NONE : peerSourcesOf(result, nowMs)),
    [result, nowMs],
  );
  const error =
    state.status === 'failed' ? state.error : state.status === 'ready' && state.error ? state.error : null;
  return { sources, error, result };
}
