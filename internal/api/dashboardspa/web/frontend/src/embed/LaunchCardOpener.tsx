import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { takeLaunchBead } from './activitySession';

// vk-final part 5 (ACTIVITY-LINKS.md §3 step 2): once the board is mounted
// (after sign-in, inside the city's router, so CityBootstrap has resolved the
// city), open the card the Activity was launched for: a client-side
// navigation to /beads with `bead=<id>` merged into the current query, so
// `frame_id`, `instance_id` and the other launch params stay. The route
// state marks it as a launch, so an unknown id becomes a toast, not an
// error panel.

export interface LaunchState {
  launchBead: string;
}

export function isLaunchState(v: unknown): v is LaunchState {
  return typeof v === 'object' && v !== null && typeof (v as Record<string, unknown>).launchBead === 'string';
}

export function LaunchCardOpener() {
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    const bead = takeLaunchBead();
    if (bead === null) return;
    const search = new URLSearchParams(location.search);
    search.set('bead', bead);
    const state: LaunchState = { launchBead: bead };
    void navigate({ pathname: '/beads', search: `?${search.toString()}` }, { state });
    // once per mount: the launch card is consumed by takeLaunchBead()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
