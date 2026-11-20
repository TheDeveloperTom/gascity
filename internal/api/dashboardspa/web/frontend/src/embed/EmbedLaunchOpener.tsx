import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { withApiBase } from '../lib/apiBase';
import { createLaunchPoller, LAUNCH_POLL_MS, launchTarget } from './launch';
import { isEmbedded } from './mode';
import { gatedFetch, subscribeDenied } from './session';

// Discord mode: opens the card or graph the owner tapped «📱 Открыть в
// Discord» for (launch.ts). Mounted inside the city router, so navigation is
// client-side under the city basename (no reload: a reload inside the frame
// would lose the SDK handshake). Renders nothing, and outside Discord does
// nothing at all: no timer, no request.

async function readLaunch(after: number, resync: boolean): Promise<unknown> {
  const q = new URLSearchParams({ after: String(after) });
  if (resync) q.set('resync', '1');
  const res = await gatedFetch(fetch, withApiBase(`/api/activity/launch?${q.toString()}`), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
  });
  if (res.status !== 200) return null;
  return res.json();
}

export function EmbedLaunchOpener() {
  const navigate = useNavigate();
  const location = useLocation();
  const searchRef = useRef(location.search);
  searchRef.current = location.search;
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  useEffect(() => {
    if (!isEmbedded()) return;
    let cancelled = false;
    const poller = createLaunchPoller({
      read: readLaunch,
      open: (launch) => {
        if (cancelled) return;
        void navigateRef.current(launchTarget(launch, searchRef.current));
      },
      isHidden: () => document.visibilityState === 'hidden',
    });
    void poller.tick();
    const interval = window.setInterval(() => void poller.tick(), LAUNCH_POLL_MS);
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      poller.becameVisible();
      void poller.tick();
    };
    document.addEventListener('visibilitychange', onVisibility);
    const stop = () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // no access (review M1): the launch poll stops for good
    const unsubscribe = subscribeDenied(stop);
    return () => {
      unsubscribe();
      stop();
    };
  }, []);
  return null;
}
