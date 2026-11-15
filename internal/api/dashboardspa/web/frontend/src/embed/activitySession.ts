// ACTIVITY-PLAN Task 6 — Activity session state, kept apart from the SDK so
// the seams (discussWithMayor, the API clients) can read it without pulling
// the Discord SDK into every import graph.
//
// The gateway answers a signed request whose session is missing, expired or
// from another instance with 401 `{"error":"session_invalid"}` (act/auth
// eeafa3c7). On exactly that reply a request re-runs the silent sign-in once
// (one shared run for concurrent replies) and retries once.

import { authHeaders, isEmbedded, onPlumbingReset, withApiBase } from '../lib/apiBase';

export type ActivityRole = 'owner' | 'reader';

type Reauth = () => Promise<void>;

let role: ActivityRole | null = null;
let reauth: Reauth | null = null;
let inflight: Promise<void> | null = null;

onPlumbingReset(() => {
  role = null;
  reauth = null;
  inflight = null;
  launch = null;
  consumedInMemory.clear();
});

// ---- launch card (vk-final part 5, ACTIVITY-LINKS.md §3) ----------------
//
// A Mayor link `https://discord.com/activities/<app>?custom_id=bead:<id>`
// reaches the SDK as `customId`, read once at iframe load. It is consumed
// once per Activity instance (`consumed:<instanceId>` in sessionStorage,
// guarded; an in-memory set backs it when storage throws), so a reload in the
// same instance does not reopen a drawer the user already closed. This is
// also the slot a gateway «pending card» fallback would fill.

const LAUNCH_RE = /^bead:([A-Za-z0-9._-]{1,64})$/;
const CONSUMED_PREFIX = 'gascity:activity:consumed:';
let launch: { bead: string; instanceId: string } | null = null;
const consumedInMemory = new Set<string>();

/** `bead:<id>` → the id; anything else → null (ignored silently). */
export function parseLaunchCustomId(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const match = LAUNCH_RE.exec(raw);
  if (match === null) return null;
  const id = match[1] ?? '';
  return id.includes('..') ? null : id;
}

/** Called by bootActivity right after `new DiscordSDK(clientId)`. */
export function captureLaunch(customId: string | null | undefined, instanceId: string): void {
  const bead = parseLaunchCustomId(customId);
  launch = bead === null ? null : { bead, instanceId };
}

function wasConsumed(instanceId: string): boolean {
  if (consumedInMemory.has(instanceId)) return true;
  try {
    return window.sessionStorage.getItem(CONSUMED_PREFIX + instanceId) !== null;
  } catch {
    return false;
  }
}

function markConsumed(instanceId: string): void {
  consumedInMemory.add(instanceId);
  try {
    window.sessionStorage.setItem(CONSUMED_PREFIX + instanceId, '1');
  } catch {
    // storage blocked: the in-memory mark covers this page load
  }
}

/** The card the Activity was launched for, once per instance; null otherwise. */
export function takeLaunchBead(): string | null {
  const current = launch;
  launch = null;
  if (current === null || wasConsumed(current.instanceId)) return null;
  markConsumed(current.instanceId);
  return current.bead;
}

/** The signed-in Activity role; null outside the Activity or before sign-in. */
export function getActivityRole(): ActivityRole | null {
  return role;
}

/**
 * Whether answer and discuss actions are shown. Outside the Activity nothing
 * changes (the board opens Discord). Inside it, only the owner writes; a
 * reader (Richard) and a not-yet-signed-in board see no write actions.
 */
export function canWrite(): boolean {
  return !isEmbedded() || role === 'owner';
}

/** Set by bootActivity after a successful token exchange. */
export function setActivityRole(r: ActivityRole | null): void {
  role = r;
}

/** Set by bootActivity: re-runs the silent sign-in (authorize → token → headers). */
export function setReauth(fn: Reauth | null): void {
  reauth = fn;
}

async function isSessionInvalid(res: Response): Promise<boolean> {
  if (res.status !== 401) return false;
  try {
    const body: unknown = await res.clone().json();
    return (
      typeof body === 'object' &&
      body !== null &&
      (body as Record<string, unknown>).error === 'session_invalid'
    );
  } catch {
    return false;
  }
}

function reauthOnce(fn: Reauth): Promise<void> {
  if (inflight === null) {
    inflight = fn().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

/**
 * Runs `doFetch`; on 401 `session_invalid` re-runs the silent sign-in once
 * and calls `doFetch` again (it must read authHeaders() afresh). Any other
 * reply, or a failed sign-in, returns the first response unchanged.
 */
export async function fetchWithSessionRetry(doFetch: () => Promise<Response>): Promise<Response> {
  const res = await doFetch();
  const fn = reauth;
  if (fn === null || !(await isSessionInvalid(res))) return res;
  try {
    await reauthOnce(fn);
  } catch {
    return res;
  }
  return doFetch();
}

/** POST JSON to a gateway route with the session headers (and the one re-auth retry). */
export async function activityPost(path: string, body: unknown): Promise<Response> {
  const payload = JSON.stringify(body);
  return fetchWithSessionRetry(() =>
    fetch(withApiBase(path), {
      method: 'POST',
      headers: {
        ...authHeaders(),
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      credentials: 'same-origin',
      body: payload,
    }),
  );
}
