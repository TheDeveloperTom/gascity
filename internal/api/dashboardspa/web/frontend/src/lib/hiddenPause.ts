import { useEffect, useState } from 'react';

// BOARD-CHAT D3 live check 19.11, HOST cause 5. The dashboard is plain HTTP/1.1
// on 127.0.0.1, and Chromium allows six connections per host across all tabs.
// A tab with an open card holds three long-lived streams (events, peer boards,
// the desk's session), so a second such tab took all six and the chat's
// POST /v1/send never started (aborted at 20 s, «не доставлено»). A tab that
// stays hidden for a few seconds now closes its streams and opens them again
// when it is shown; each stream reads once on resume, since it missed events.
// A quick tab switch keeps them, so switching back and forth costs nothing.

/** How long a page stays hidden before its streams are closed. */
export const HIDDEN_PAUSE_MS = 5_000;

export interface HiddenPauseHandlers {
  pause(): void;
  resume(): void;
}

function pageHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

/** Calls pause once the page has been hidden for graceMs, resume when it is shown again. */
export function watchHiddenPause(handlers: HiddenPauseHandlers, graceMs = HIDDEN_PAUSE_MS): () => void {
  if (typeof document === 'undefined') return () => {};
  let paused = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const onChange = () => {
    if (pageHidden()) {
      if (paused || timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        paused = true;
        handlers.pause();
      }, graceMs);
      return;
    }
    clear();
    if (!paused) return;
    paused = false;
    handlers.resume();
  };
  document.addEventListener('visibilitychange', onChange);
  onChange();
  return () => {
    clear();
    document.removeEventListener('visibilitychange', onChange);
  };
}

/** True while the page has been hidden longer than graceMs. */
export function useHiddenPaused(graceMs = HIDDEN_PAUSE_MS): boolean {
  const [paused, setPaused] = useState(false);
  useEffect(
    () =>
      watchHiddenPause(
        {
          pause: () => setPaused(true),
          resume: () => setPaused(false),
        },
        graceMs,
      ),
    [graceMs],
  );
  return paused;
}
