// Discord mode: the one request seam (restored from a03453e1f^
// embed/activitySession.ts, read-only now). The two API clients call
// gatedFetch only when isEmbedded(); the plain web path never reaches it.
//
// - A request off the allowlist (allowlist.ts) is answered here with a local
//   404 and never leaves the iframe, so no write and no denied read exists.
// - Every allowed request carries the gateway session headers, read per
//   attempt (a late sign-in still applies to a cached client).
// - On the gateway's 401 `{"error":"session_invalid"}` (session expired after
//   1 h, gateway restarted) the silent sign-in re-runs once — one shared run
//   for concurrent replies — and the request is retried once.

import { embedRequestAllowed } from './allowlist';
import { authHeaders, onEmbedReset } from './mode';

type Reauth = () => Promise<void>;

/** Review M1: the cool-down after a failed re-sign-in, doubling up to the cap. */
export const REAUTH_BACKOFF_MIN_MS = 30_000;
export const REAUTH_BACKOFF_MAX_MS = 5 * 60_000;

let reauth: Reauth | null = null;
let inflight: Promise<void> | null = null;
let backoffMs = REAUTH_BACKOFF_MIN_MS;
let notBefore = 0;
let denied = false;
const deniedListeners = new Set<() => void>();

onEmbedReset(() => {
  reauth = null;
  inflight = null;
  backoffMs = REAUTH_BACKOFF_MIN_MS;
  notBefore = 0;
  denied = false;
  deniedListeners.clear();
});

/**
 * The gateway refused this Discord user (403 at sign-in or re-sign-in): the
 * page stops for good, no request leaves the frame any more, and the board
 * shows «Нет доступа» (EmbedNoAccess). Idempotent.
 */
export function setDenied(): void {
  if (denied) return;
  denied = true;
  for (const fn of [...deniedListeners]) fn();
}

export function isDenied(): boolean {
  return denied;
}

export function subscribeDenied(fn: () => void): () => void {
  deniedListeners.add(fn);
  return () => {
    deniedListeners.delete(fn);
  };
}

/** Set by the SDK boot: re-runs the silent sign-in (authorize → token → headers). */
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
    inflight = fn()
      .then(
        () => {
          backoffMs = REAUTH_BACKOFF_MIN_MS;
          notBefore = 0;
        },
        (err: unknown) => {
          // No new sign-in before the cool-down: the 3 s launch poll and the
          // 15 s refresh would otherwise hit the token route's rate limit.
          notBefore = Date.now() + backoffMs;
          backoffMs = Math.min(backoffMs * 2, REAUTH_BACKOFF_MAX_MS);
          throw err;
        },
      )
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/**
 * Runs `doFetch`; on 401 `session_invalid` re-runs the silent sign-in once and
 * calls `doFetch` again (it must read authHeaders() afresh). Any other reply,
 * or a failed sign-in, returns the first response unchanged.
 */
export async function fetchWithSessionRetry(doFetch: () => Promise<Response>): Promise<Response> {
  const res = await doFetch();
  const fn = reauth;
  if (fn === null || !(await isSessionInvalid(res))) return res;
  if (inflight === null && Date.now() < notBefore) return res;
  try {
    await reauthOnce(fn);
  } catch {
    return res;
  }
  return doFetch();
}

function noAccess(): Response {
  return new Response(JSON.stringify({ error: 'not_allowed' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** The local answer for a request Discord mode never sends. */
export function notInDiscord(): Response {
  return new Response(JSON.stringify({ error: 'not available inside Discord' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Discord mode's fetch: allowlist first, then the session headers and the one
 * re-sign-in retry. `request` is rebuilt per attempt from `input`/`init`.
 */
export async function gatedFetch(
  fetchImpl: typeof fetch,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const target =
    typeof input === 'string' ? new URL(input, globalThis.location?.origin).toString() : input;
  if (denied) return noAccess();
  const first = new Request(target, init);
  if (!embedRequestAllowed(first.method, first.url)) return notInDiscord();
  // Cloned before the first send: a sent body cannot be cloned afterwards.
  const spare = first.clone();
  let attempts = 0;
  return fetchWithSessionRetry(() => {
    const request = attempts++ === 0 ? first : spare;
    for (const [name, value] of Object.entries(authHeaders())) request.headers.set(name, value);
    return fetchImpl(request);
  });
}
