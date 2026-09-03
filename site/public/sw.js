const CACHE_NAME = 'penghu-rider-v6';
const CORE = [
  '/',
  '/styles.css',
  '/data/questions.json',
  '/manifest.webmanifest',
  '/art/adventure-map.webp',
  '/art/player-scooter-hono.webp',
  '/art/day1-lookout.webp',
  '/art/day2-lair.webp',
  '/art/boss-roadkeeper.webp',
  '/art/clear-coast.webp',
  '/art/app-icon-192.png',
  '/art/app-icon-512.png',
  '/art/lex-yao-fox-logo-512.png',
  '/art/monster-following-distance.webp',
  '/art/monster-intersection.webp',
  '/art/monster-vehicle-check.webp',
  '/art/monster-distracted-driving.webp',
  '/art/monster-accident-response.webp',
  '/art/monster-large-vehicle.webp',
  '/art/monster-bad-weather.webp',
  '/art/monster-hazard-perception.webp',
  '/og.png',
  '/precache-assets.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(CORE);
    const response = await fetch('/precache-assets.json');
    const assets = await response.json();
    for (let index = 0; index < assets.length; index += 32) {
      await cache.addAll(assets.slice(index, index + 32));
    }
    const root = await cache.match('/');
    if (root) {
      const html = await root.clone().text();
      const urls = [...html.matchAll(/(?:src|href)="(\/[^"?#]+)"/g)]
        .map((match) => match[1])
        .filter((url) => !url.startsWith('/data/') && !url.startsWith('/assets/questions/'));
      await Promise.allSettled([...new Set(urls)].map((url) => cache.add(url)));
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        void cache.put(request, response.clone());
      }
      return response;
    } catch {
      if (request.mode === 'navigate') return caches.match('/');
      return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    }
  })());
});
