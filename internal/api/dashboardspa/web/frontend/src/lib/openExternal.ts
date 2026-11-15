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
 * One exit for external URLs (Discord messages and channels). Synchronous, so
 * it can be called straight from a click handler (Safari/iOS popup rules). A
 * rejected URL does nothing. In the installed PWA a new window hands the link
 * to Discord or the browser.
 */
export function openExternal(url: string): void {
  const safe = safeOutboundUrl(url);
  if (safe === null) return;
  window.open(safe, '_blank', 'noopener,noreferrer');
}
