/**
 * Where a bare (city-less) URL goes once the bootstrap has picked a city.
 * The view path, query and hash survive, so `/beads?bead=<id>` opens the
 * same card under `/city/<name>/beads?bead=<id>` (RB13).
 */
export function bareRedirectTarget(
  cityName: string,
  location: { pathname: string; search: string; hash: string },
): string {
  const enc = encodeURIComponent(cityName);
  const pathname = location.pathname.replace(/\/{2,}/g, '/') || '/';
  const first = pathname.split('/')[1] ?? '';
  const tail = `${location.search}${location.hash}`;
  if (first === 'city') return `/city/${enc}/${tail}`;
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `/city/${enc}${path}${tail}`;
}
