import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHUNK_RELOAD_KEY, installChunkReload } from './pwa';

// Lane L1 (dashboard_dir plan): the built files are swapped on disk while tabs
// stay open. A tab from before the swap may ask for a chunk that no longer
// exists (404). It reloads itself once instead of going blank, and a reload
// that fails again never loops.

type FakeWin = EventTarget & { location: { reload: ReturnType<typeof vi.fn> } };

function fakeWindow(): FakeWin {
  const t = new EventTarget() as FakeWin;
  t.location = { reload: vi.fn() };
  return t;
}

// What Vite's __vitePreload does when the dynamic import() of a lazy route
// rejects (a missing chunk): `baseModule().catch(handlePreloadError)`
// dispatches a cancelable `vite:preloadError` on window with the error.
function chunkFails(win: EventTarget): void {
  const e = new Event('vite:preloadError', { cancelable: true }) as Event & { payload?: unknown };
  e.payload = new TypeError('Failed to fetch dynamically imported module: /assets/Agents-old.js');
  win.dispatchEvent(e);
}

describe('installChunkReload', () => {
  let storage: Storage;

  beforeEach(() => {
    vi.useFakeTimers();
    storage = window.sessionStorage;
    storage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    storage.clear();
  });

  it('reloads once on vite:preloadError', () => {
    const win = fakeWindow();
    installChunkReload(win as unknown as Window, storage);
    chunkFails(win);
    chunkFails(win); // a second chunk of the same page load fails too
    expect(win.location.reload).toHaveBeenCalledTimes(1);
    expect(storage.getItem(CHUNK_RELOAD_KEY)).not.toBeNull();
  });

  it('does not reload when gascity:chunk-reload is set', () => {
    // the page after that reload: its chunk fails again
    storage.setItem(CHUNK_RELOAD_KEY, '1');
    const win = fakeWindow();
    installChunkReload(win as unknown as Window, storage);
    chunkFails(win);
    expect(win.location.reload).not.toHaveBeenCalled();
  });

  it('a failing reload cannot loop: no clear after load when the chunk failed', () => {
    storage.setItem(CHUNK_RELOAD_KEY, '1');
    const win = fakeWindow();
    installChunkReload(win as unknown as Window, storage);
    win.dispatchEvent(new Event('load'));
    chunkFails(win); // the failure lands after `load`, inside the grace window
    vi.runAllTimers();
    expect(storage.getItem(CHUNK_RELOAD_KEY)).not.toBeNull();
    chunkFails(win);
    expect(win.location.reload).not.toHaveBeenCalled();
  });

  it('clears the key on load when no preloadError fired', () => {
    storage.setItem(CHUNK_RELOAD_KEY, '1');
    const win = fakeWindow();
    installChunkReload(win as unknown as Window, storage);
    win.dispatchEvent(new Event('load'));
    vi.runAllTimers();
    expect(storage.getItem(CHUNK_RELOAD_KEY)).toBeNull();
    // a later, separate failure may reload again
    chunkFails(win);
    expect(win.location.reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload on an ordinary script error', () => {
    const win = fakeWindow();
    installChunkReload(win as unknown as Window, storage);
    win.dispatchEvent(new ErrorEvent('error', { message: 'TypeError: x is undefined' }));
    win.dispatchEvent(new Event('unhandledrejection'));
    expect(win.location.reload).not.toHaveBeenCalled();
    expect(storage.getItem(CHUNK_RELOAD_KEY)).toBeNull();
  });

  it('does not reload when the session store is unusable (cannot guard a loop)', () => {
    const broken = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    } as unknown as Storage;
    const win = fakeWindow();
    installChunkReload(win as unknown as Window, broken);
    expect(() => chunkFails(win)).not.toThrow();
    expect(win.location.reload).not.toHaveBeenCalled();
  });
});
