// Owner 16.11: the dashboard installs on the phone as a PWA. The service
// worker (/sw.js, emitted by the build from src/pwa/swSource.ts) caches the
// app shell only; it is registered in production builds only, so the Vite
// dev server never serves stale modules.

export interface RegisterOptions {
  prod: boolean;
  nav: Navigator | undefined;
}

// Lane L1 (dashboard_dir): the built files can be swapped on disk while a tab
// stays open, so a tab from before the swap may ask for a chunk that no
// longer exists and get a 404. In the production build every lazy route goes
// through Vite's __vitePreload, whose `baseModule().catch(...)` dispatches
// `vite:preloadError` on window when the dynamic import() rejects (and when a
// dependency preload fails). On that event the tab reloads ONCE into the new
// index; the session key stops a failing reload from looping. The key is
// cleared a grace period after `load` when no chunk failed during this page
// load, so a later, separate swap may reload again. The grace period exists
// because a lazy route chunk of the first render can fail after `load` (a
// dynamic import does not delay the load event).
export const CHUNK_RELOAD_KEY = 'gascity:chunk-reload';
const CLEAR_AFTER_LOAD_MS = 10_000;

export function installChunkReload(win: Window, storage: Storage): void {
  let failed = false;
  let clearTimer: ReturnType<typeof setTimeout> | undefined;

  win.addEventListener('vite:preloadError', () => {
    if (failed) return; // one reload per page load
    failed = true;
    if (clearTimer !== undefined) clearTimeout(clearTimer);
    try {
      if (storage.getItem(CHUNK_RELOAD_KEY) !== null) return; // already reloaded once
      storage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
    } catch {
      return; // no usable session store: cannot guard a loop, so do not reload
    }
    win.location.reload();
  });

  win.addEventListener('load', () => {
    clearTimer = setTimeout(() => {
      if (failed) return;
      try {
        storage.removeItem(CHUNK_RELOAD_KEY);
      } catch {
        // nothing to clear
      }
    }, CLEAR_AFTER_LOAD_MS);
  });
}

export async function registerServiceWorker({ prod, nav }: RegisterOptions): Promise<void> {
  if (!prod || nav === undefined || !('serviceWorker' in nav)) return;
  try {
    await nav.serviceWorker.register('/sw.js', { scope: '/' });
  } catch {
    // no worker (a plain-http origin, a private window): the app works online
  }
}
