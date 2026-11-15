// The service worker's source, emitted as /sw.js by vite.config.ts
// (serviceWorkerPlugin) with the build's id in the cache name, so every new
// build is a new worker and its activate step drops the old shell.
//
// App shell only: the page, the hashed /assets/* bundle, the manifest and the
// icons. API reads (/v0/…, city services, the event streams, /api, /health)
// and other origins are never touched, so the board is never stale and SSE
// streams pass straight through. Pages are network-first (the cached page is
// only the offline fallback); hashed assets are cache-first (they never change).

const BUILD_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function serviceWorkerSource(buildId: string): string {
  if (!BUILD_ID_RE.test(buildId)) throw new Error(`service worker: bad build id ${JSON.stringify(buildId)}`);
  return `'use strict';
const CACHE = 'gascity-shell-${buildId}';
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png'];
const NEVER = /^\\/(?:v0|api|health|hook|svc)(?:\\/|$)/;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key.startsWith('gascity-shell-') && key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

function store(request, response) {
  if (!response || !response.ok) return response;
  const copy = response.clone();
  caches.open(CACHE).then((cache) => cache.put(request, copy));
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (NEVER.test(url.pathname) || url.pathname.includes('/svc/') || url.pathname.endsWith('/stream')) return;
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => store('/', response))
        .catch(() => caches.match('/').then((hit) => hit || Response.error())),
    );
    return;
  }
  if (url.pathname.startsWith('/assets/') || SHELL.includes(url.pathname)) {
    event.respondWith(caches.match(request).then((hit) => hit || fetch(request).then((response) => store(request, response))));
  }
});
`;
}
