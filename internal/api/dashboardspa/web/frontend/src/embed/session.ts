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

let reauth: Reauth | null = null;
let inflight: Promise<void> | null = null;

onEmbedReset(() => {
  reauth = null;
  inflight = null;
});

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
    inflight = fn().finally(() => {
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
  try {
    await reauthOnce(fn);
  } catch {
    return res;
  }
  return doFetch();
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
