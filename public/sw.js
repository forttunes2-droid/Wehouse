// WeHouse update controller. Keep this worker installed so an old cached app
// cannot continue controlling normal Chrome sessions after a deployment.
// Version: 20260817-production-refresh-2
self.addEventListener('install', function(e) {
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(names.map(function(n) { return caches.delete(n); }));
    }).then(function() {
      return self.clients.claim();
    }).then(function() {
      return self.clients.matchAll({ type: 'window' });
    }).then(function(clients) {
      clients.forEach(function(client) { client.navigate(client.url); });
    })
  );
});

// WeHouse currently favours correctness over offline HTML. Navigation and
// application assets always come from the deployed origin, never a stale
// service-worker cache.
self.addEventListener('fetch', function(e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request, { cache: 'no-store' }));
});
