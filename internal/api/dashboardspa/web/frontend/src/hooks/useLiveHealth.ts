import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { LiveHealth } from 'gas-city-dashboard-shared';
import { api, formatApiError } from '../api/client';
import {
  LIVE_POLL_MS,
  liveHistory,
  liveHistoryVersion,
  recordLiveSample,
  sampleFromLive,
  seedLiveHistory,
  subscribeLiveHistory,
  type LiveSample,
} from '../lib/hostLive';
import { useVisibleRefresh } from './useVisibleRefresh';

export interface LiveHealthState {
  latest: LiveHealth | null;
  error: string | null;
  history: LiveSample[];
  /** The right edge of the charts: the latest poll's wall time. */
  now: number;
}

// Polls GET /api/health/live every LIVE_POLL_MS while the tab is visible and
// appends each reading to the tab's ring buffer (lib/hostLive), which outlives
// the route so the last half hour survives a visit elsewhere. On mount it also
// reads GET /api/health/history once and seeds the ring, so the charts show
// the last 30 minutes at once; a failed history read leaves the live polls.
let lastLive: LiveHealth | null = null;

export function useLiveHealth(): LiveHealthState {
  const [latest, setLatest] = useState<LiveHealth | null>(lastLive);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useSyncExternalStore(subscribeLiveHistory, liveHistoryVersion);

  const poll = useCallback(async () => {
    try {
      const live = await api.liveHealth();
      lastLive = live;
      setLatest(live);
      setError(null);
      recordLiveSample(sampleFromLive(live));
    } catch (err) {
      setError(formatApiError(err, 'live host reading unavailable'));
      throw err;
    } finally {
      setNow(Date.now());
    }
  }, []);

  useEffect(() => {
    api
      .hostHistory()
      .then((h) => seedLiveHistory(h.points.map(sampleFromLive)))
      .catch(() => undefined);
    poll().catch(() => undefined);
  }, [poll]);
  useVisibleRefresh(poll, LIVE_POLL_MS);

  return { latest, error, history: liveHistory(), now };
}
