// vk lane 6 — one API base and one auth-header hook for the Discord Activity.
//
// Today the dashboard is served same-origin by the gc supervisor, so the base
// is '' and the headers are {}. In the Activity the gateway serves the SPA and
// the API on one origin under the `/` mapping (apiBase stays ''), and the SDK
// bootstrap (ACTIVITY-PLAN Task 6) calls setAuthHeaders({Authorization,
// 'X-Activity-Instance'}) once it has a session. Every fetch path reads
// authHeaders() at request time, so a late setAuthHeaders still applies.
//
// EventSource cannot carry headers: in the Activity the gateway must accept
// the session for the SSE route another way (cookie or query), or the board
// falls back to polling (hooks/useGcEvents.ts).
//
// Board data allowlist (the gateway's allowlist later). The board reads only:
// beads, bead deps, rigs, agents (status), sessions list, runs summary, health.

function envString(name: 'VITE_API_BASE' | 'VITE_EMBED'): string {
  // types/vite-env.d.ts is not lane 6's file, so these two keys are read untyped.
  const v: unknown = (import.meta.env as unknown as Record<string, unknown>)[name];
  return typeof v === 'string' ? v.trim() : '';
}

/** `VITE_API_BASE`, trimmed and without a trailing slash; '' when unset. */
export function apiBase(): string {
  return envString('VITE_API_BASE').replace(/\/+$/, '');
}

/** Prefixes a root-relative path with apiBase(); absolute URLs pass unchanged. */
export function withApiBase(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//')) return path;
  return `${apiBase()}${path}`;
}

let currentAuthHeaders: Readonly<Record<string, string>> = {};

/** Headers every API request carries (a copy). `{}` outside the Activity. */
export function authHeaders(): Record<string, string> {
  return { ...currentAuthHeaders };
}

/** Set by the Activity SDK bootstrap (Task 6) after the token exchange. */
export function setAuthHeaders(h: Record<string, string>): void {
  currentAuthHeaders = { ...h };
}

let embeddedLatch = false;

/**
 * True inside the Discord Activity: the launch URL carries `frame_id`, or the
 * build sets `VITE_EMBED`. Latched: in-app navigation that drops the query
 * does not turn it back off.
 */
export function isEmbedded(): boolean {
  if (embeddedLatch) return true;
  const embedEnv = envString('VITE_EMBED');
  const search = globalThis.location?.search ?? '';
  if ((embedEnv !== '' && embedEnv !== '0' && embedEnv !== 'false') || new URLSearchParams(search).has('frame_id')) {
    embeddedLatch = true;
  }
  return embeddedLatch;
}

/** Test-only: forget the auth headers, the embed latch and the external opener. */
export function resetActivityPlumbingForTests(): void {
  currentAuthHeaders = {};
  embeddedLatch = false;
  resetHooks.forEach((fn) => fn());
}

const resetHooks: Array<() => void> = [];
/** Lets sibling seams (openExternal) join resetActivityPlumbingForTests. */
export function onPlumbingReset(fn: () => void): void {
  resetHooks.push(fn);
}
