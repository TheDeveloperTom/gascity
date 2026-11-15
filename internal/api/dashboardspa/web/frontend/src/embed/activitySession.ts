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
});

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
