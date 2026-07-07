// EMERGENCY KILL SWITCH - runs once then self-destructs
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
      return self.clients.matchAll({type: 'window'});
    }).then(function(clients) {
      clients.forEach(function(c) { c.navigate(c.url); });
    }).then(function() {
      // Self-destruct after clearing caches
      return self.registration.unregister();
    })
  );
});
