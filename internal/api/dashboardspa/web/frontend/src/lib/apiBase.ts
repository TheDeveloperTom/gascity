// One API base for every fetch path. The dashboard is served same-origin by
// the gc supervisor (on the Mac, and over Tailscale at https://<mac>.ts.net),
// so the base is '' unless a build sets `VITE_API_BASE`.

function envString(name: 'VITE_API_BASE'): string {
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
