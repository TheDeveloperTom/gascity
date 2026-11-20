// Discord mode: which card or graph to open (DESIGN-discord-activity-return
// §2.2 steps 3-5). A «📱 Открыть в Discord» tap is a message-component
// interaction the bridge answers with LAUNCH_ACTIVITY (type 12), which
// carries no item id; the bridge records the wish server-side with a
// per-owner monotonic `seq`, and the gateway serves the newest verified one
// from memory:
//
//   GET /api/activity/launch?after=<seq>[&resync=1]
//   200 {"launch": {"seq": 7, "kind": "bead"|"graph", "bead": "<id>"} | null}
//   (204 = none)
//
// The page asks at boot (after=0, resync=1: the gateway re-reads the record
// once), then every 3 s while visible, and once with resync=1 right after
// the page becomes visible again (the launch event is best-effort). Reads
// are idempotent, so the desktop and the phone in one channel both switch.
// `seq` lives in memory only.

export const LAUNCH_POLL_MS = 3_000;

const BEAD_RE = /^[A-Za-z0-9._-]{1,64}$/;

export interface Launch {
  seq: number;
  kind: 'bead' | 'graph';
  bead: string;
}

/** The gateway's launch reply → a Launch, or null for none or anything malformed. */
export function parseLaunchReply(v: unknown): Launch | null {
  if (typeof v !== 'object' || v === null) return null;
  const l = (v as Record<string, unknown>).launch;
  if (typeof l !== 'object' || l === null) return null;
  const r = l as Record<string, unknown>;
  if (typeof r.seq !== 'number' || !Number.isSafeInteger(r.seq) || r.seq <= 0) return null;
  if (r.kind !== 'bead' && r.kind !== 'graph') return null;
  if (typeof r.bead !== 'string' || !BEAD_RE.test(r.bead) || r.bead.includes('..')) return null;
  return { seq: r.seq, kind: r.kind, bead: r.bead };
}

/**
 * The board location a launch opens, as a client-side navigation under the
 * city basename. The current query is kept (the Activity's launch params
 * stay, as CityBootstrap keeps them); a card opens on the board, the graph
 * opens focused on the card.
 */
export function launchTarget(
  launch: Launch,
  currentSearch: string,
): { pathname: string; search: string } {
  const q = new URLSearchParams(currentSearch);
  if (launch.kind === 'graph') {
    q.delete('bead');
    q.set('view', 'graph');
    q.set('focus', launch.bead);
  } else {
    q.delete('view');
    q.delete('focus');
    q.set('bead', launch.bead);
  }
  return { pathname: '/beads', search: `?${q.toString()}` };
}

export interface LaunchPollerDeps {
  /** One gateway read; resolves to the reply's JSON body, or null (204, error). */
  read: (after: number, resync: boolean) => Promise<unknown>;
  open: (launch: Launch) => void;
  isHidden: () => boolean;
}

/**
 * The launch consumer without timers: `tick()` is one poll, `becameVisible()`
 * marks the next poll as a resync. Only a seq greater than the last one seen
 * (the boot read counts) opens anything, so a stale or repeated launch never
 * reopens a card.
 */
export function createLaunchPoller(deps: LaunchPollerDeps) {
  let lastSeen = 0;
  let resyncNext = true; // the boot read
  let inflight = false;
  return {
    async tick(): Promise<void> {
      if (inflight || deps.isHidden()) return;
      inflight = true;
      const resync = resyncNext;
      resyncNext = false;
      try {
        let body: unknown = null;
        try {
          body = await deps.read(lastSeen, resync);
        } catch {
          body = null;
        }
        const launch = parseLaunchReply(body);
        if (launch !== null && launch.seq > lastSeen) {
          lastSeen = launch.seq;
          deps.open(launch);
        }
      } finally {
        inflight = false;
      }
    },
    becameVisible(): void {
      resyncNext = true;
    },
    lastSeen(): number {
      return lastSeen;
    },
  };
}
