// KILL SWITCH: This service worker only exists to destroy the old one
// It deletes all caches, unregisters itself, and reloads the page

self.addEventListener('install', function(event) {
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames.map(function(cacheName) {
          return caches.delete(cacheName);
        })
      );
    }).then(function() {
      self.registration.unregister().then(function() {
        self.clients.matchAll().then(function(clients) {
          clients.forEach(function(client) {
            client.navigate(client.url);
          });
        });
      });
    })
  );
});

self.addEventListener('fetch', function(event) {
  // Don't cache anything - pass through to network
  event.respondWith(fetch(event.request));
});
