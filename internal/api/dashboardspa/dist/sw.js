'use strict';
const CACHE = 'gascity-shell-d5f20085a7e3';
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png'];
const NEVER = /^\/(?:v0|api|health|hook|svc)(?:\/|$)/;

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
