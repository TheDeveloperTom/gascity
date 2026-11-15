// Owner 16.11: the dashboard installs on the phone as a PWA. The service
// worker (/sw.js, emitted by the build from src/pwa/swSource.ts) caches the
// app shell only; it is registered in production builds only, so the Vite
// dev server never serves stale modules.

export interface RegisterOptions {
  prod: boolean;
  nav: Navigator | undefined;
}

export async function registerServiceWorker({ prod, nav }: RegisterOptions): Promise<void> {
  if (!prod || nav === undefined || !('serviceWorker' in nav)) return;
  try {
    await nav.serviceWorker.register('/sw.js', { scope: '/' });
  } catch {
    // no worker (a plain-http origin, a private window): the app works online
  }
}
