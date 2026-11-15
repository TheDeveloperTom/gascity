// Seam (vk lane 0b). Owner: lane 6. Other lanes import, never edit.
import { onPlumbingReset } from './apiBase';

type ExternalOpener = (url: string) => Promise<void>;

let opener: ExternalOpener | null = null;
onPlumbingReset(() => {
  opener = null;
});

/**
 * Only http(s) URLs without credentials may leave the app. (stageBoard's
 * safeExternalUrl is GitHub-pull-request only, so it cannot gate Discord or
 * docs links; this is the general form of the same check.)
 */
function safeOutboundUrl(raw: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (parsed.username !== '' || parsed.password !== '') return null;
  return parsed.href;
}

/**
 * Activity SDK bootstrap (Task 6) installs
 * `url => sdk.commands.openExternalLink({url}).then(() => undefined)`.
 */
export function setExternalOpener(fn: ExternalOpener): void {
  opener = fn;
}

/**
 * One exit for external URLs. Synchronous, so it can be called straight from
 * a click handler (Safari/iOS popup rules, ruling 3): it starts the open and
 * never awaits. A rejected URL does nothing.
 */
export function openExternal(url: string): void {
  const safe = safeOutboundUrl(url);
  if (safe === null) return;
  if (opener !== null) {
    void opener(safe).catch(() => undefined);
    return;
  }
  window.open(safe, '_blank', 'noopener,noreferrer');
}
