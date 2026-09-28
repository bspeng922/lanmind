const CACHE = 'lanmind-optical-receiver-dev';
const PRECACHE = [];
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});
self.addEventListener('activate', (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('lanmind-optical-receiver-') && key !== CACHE).map((key) => caches.delete(key))))));
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith('/receiver/')) return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
