// EMERGENCY KILL SWITCH
// This SW exists only to destroy old caches and force fresh code load

self.addEventListener('install', function(e) {
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(cacheNames.map(function(n) { return caches.delete(n); }));
    }).then(function() {
      return self.clients.claim();
    }).then(function() {
      return self.clients.matchAll({type: 'window'});
    }).then(function(clients) {
      clients.forEach(function(c) { c.navigate(c.url); });
    })
  );
});

self.addEventListener('message', function(e) {
  if (e.data === 'KILL') {
    e.waitUntil(
      caches.keys().then(function(names) {
        return Promise.all(names.map(function(n) { return caches.delete(n); }));
      }).then(function() {
        return self.clients.matchAll({type: 'window'});
      }).then(function(clients) {
        clients.forEach(function(c) { c.navigate(c.url); });
      })
    );
  }
});

// Pass all requests through to network (no caching)
self.addEventListener('fetch', function(e) {
  e.respondWith(fetch(e.request));
});
