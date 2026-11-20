// Discord mode: the live-update ticker (DESIGN-discord-activity-return §4.3:
// no event streams are served through the Activity gateway, so the board
// polls its allowed reads). One timer for the whole page (fork PR #7 review
// L3): every useGcEventRefresh consumer subscribes, and each tick calls them
// all once while the page is visible (one wake-up, not one timer per hook).

export const EMBED_POLL_MS = 15_000;

const subscribers = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function tick(): void {
  if (document.visibilityState === 'hidden') return;
  for (const fn of [...subscribers]) {
    if (subscribers.has(fn)) fn();
  }
}

export function subscribeEmbedTick(fn: () => void): () => void {
  subscribers.add(fn);
  if (timer === null) timer = setInterval(tick, EMBED_POLL_MS);
  return () => {
    subscribers.delete(fn);
    if (subscribers.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}
