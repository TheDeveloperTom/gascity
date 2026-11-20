// Discord mode (owner 20.11 13:21, DESIGN-discord-activity-return rev 2.1).
//
// The board runs inside a Discord Activity only when Discord itself loaded
// it there. Discord serves every Activity from its own proxy origin
// `https://<application_id>.discordsays.com` and appends the launch params
// `frame_id` and `instance_id` (plus `platform`, `channel_id`, …) to the
// iframe URL; the Embedded App SDK reads exactly these in its constructor
// and refuses to start without `frame_id`. Both must hold: a normal browser
// over Tailscale never has the discordsays origin, and there is no build
// flag or query switch that turns Discord mode on. Latched for the page:
// client-side navigation that drops the launch query keeps it on.
//
// This file must stay free of the SDK: the plain web path imports it.

const DISCORD_PROXY_HOST_RE = /^(\d{17,20})\.discordsays\.com$/;

let embeddedLatch: boolean | null = null;
let currentAuthHeaders: Readonly<Record<string, string>> = {};
let tailscaleBoard: string | null = null;

function detect(loc: Pick<Location, 'hostname' | 'search' | 'protocol'> | undefined): boolean {
  if (loc === undefined) return false;
  if (loc.protocol !== 'https:') return false;
  if (!DISCORD_PROXY_HOST_RE.test(loc.hostname)) return false;
  const q = new URLSearchParams(loc.search);
  return (q.get('frame_id') ?? '') !== '' && (q.get('instance_id') ?? '') !== '';
}

/** True only inside a Discord Activity (proxy origin + SDK launch params). */
export function isEmbedded(): boolean {
  if (embeddedLatch === null) embeddedLatch = detect(globalThis.location);
  return embeddedLatch;
}

/**
 * The Discord application id the Activity runs as: the proxy host's first
 * label (`<application_id>.discordsays.com`). One build serves every city,
 * so the id is never baked into the bundle. Null outside the Activity.
 */
export function embedClientId(): string | null {
  if (!isEmbedded()) return null;
  const match = DISCORD_PROXY_HOST_RE.exec(globalThis.location.hostname);
  return match?.[1] ?? null;
}

/** Headers every gateway request carries (a copy); `{}` until sign-in and outside Discord. */
export function authHeaders(): Record<string, string> {
  return { ...currentAuthHeaders };
}

/** Set by the SDK boot after the token exchange; `{}` clears them. */
export function setAuthHeaders(h: Record<string, string>): void {
  currentAuthHeaders = { ...h };
}

/**
 * The owner's Tailscale board origin, as the gateway's token reply states it
 * (`board_url`), for «на доске в Tailscale». Only an https origin is kept.
 */
export function setTailscaleBoardUrl(raw: unknown): void {
  tailscaleBoard = null;
  if (typeof raw !== 'string') return;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.username !== '' || u.password !== '') return;
    tailscaleBoard = u.origin;
  } catch {
    // not a URL: no button
  }
}

/** The Tailscale board's card URL for `beadId`, or null when unknown. */
export function tailscaleCardUrl(city: string | null, beadId: string): string | null {
  if (tailscaleBoard === null || city === null) return null;
  const q = new URLSearchParams({ bead: beadId });
  return `${tailscaleBoard}/city/${encodeURIComponent(city)}/beads?${q.toString()}`;
}

const resetHooks: Array<() => void> = [];

/** Lets sibling seams join resetEmbedForTests. */
export function onEmbedReset(fn: () => void): void {
  resetHooks.push(fn);
}

/** Test-only: forget the latch, the headers, the board URL and sibling state. */
export function resetEmbedForTests(): void {
  embeddedLatch = null;
  currentAuthHeaders = {};
  tailscaleBoard = null;
  resetHooks.forEach((fn) => fn());
}
