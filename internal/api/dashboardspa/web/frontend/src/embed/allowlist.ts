// Discord mode: the requests the board may make inside the Activity
// (DESIGN-discord-activity-return §4.3, the gateway's allowlist A1-A12 + G).
// The gateway is the enforcement; this copy keeps the page from ever asking
// for anything else, so a denied read never leaves the iframe and no write
// path exists in Discord mode. Every row is GET except the gateway's own
// token exchange.

const SEG = '[A-Za-z0-9._-]{1,64}';

const READS: readonly RegExp[] = [
  /^\/v0\/cities$/, // A1
  new RegExp(`^/v0/city/${SEG}/status$`), // A2
  new RegExp(`^/v0/city/${SEG}/beads$`), // A3
  new RegExp(`^/v0/city/${SEG}/beads/ready$`), // A4
  new RegExp(`^/v0/city/${SEG}/bead/${SEG}$`), // A5
  new RegExp(`^/v0/city/${SEG}/bead/${SEG}/deps$`), // A6
  new RegExp(`^/v0/city/${SEG}/rigs$`), // A7
  new RegExp(`^/v0/city/${SEG}/sessions$`), // A8
  new RegExp(`^/v0/city/${SEG}/runs/census$`), // A9
  new RegExp(`^/api/city/${SEG}/runs/summary$`), // A10
  new RegExp(`^/api/city/${SEG}/config$`), // A11
  new RegExp(`^/api/city/${SEG}/supervisor-status$`), // A12
  /^\/api\/health$/, // A12
  /^\/api\/activity\/whoami$/, // G
  /^\/api\/activity\/launch$/, // G
];

const POSTS: readonly RegExp[] = [/^\/api\/activity\/token$/]; // G

function samePath(raw: string): string | null {
  const origin = globalThis.location?.origin ?? 'http://embed.invalid';
  let u: URL;
  try {
    u = new URL(raw, origin);
  } catch {
    return null;
  }
  if (u.origin !== origin) return null;
  try {
    return decodeURIComponent(u.pathname);
  } catch {
    return null;
  }
}

/** True when Discord mode may send `method url` (same origin, allowlisted). */
export function embedRequestAllowed(method: string, url: string): boolean {
  const path = samePath(url);
  if (path === null) return false;
  const m = method.toUpperCase();
  if (m === 'GET') return READS.some((re) => re.test(path));
  if (m === 'POST') return POSTS.some((re) => re.test(path));
  return false;
}
