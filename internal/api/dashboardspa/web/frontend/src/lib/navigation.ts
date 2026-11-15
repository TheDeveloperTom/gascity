// Seam (vk lane 0b). Owner: lane 6. Other lanes import, never edit.

/**
 * The only full reload in src/. It keeps location.search (the Activity's
 * frame_id/instance_id) when `path` has no query of its own.
 */
export function hardNavigate(path: string): void {
  const search = window.location.search;
  const target = path.includes('?') || search === '' ? path : withSearch(path, search);
  window.location.assign(target);
}

function withSearch(path: string, search: string): string {
  const hashAt = path.indexOf('#');
  if (hashAt === -1) return `${path}${search}`;
  return `${path.slice(0, hashAt)}${search}${path.slice(hashAt)}`;
}
