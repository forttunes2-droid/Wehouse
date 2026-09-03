// Replaces the retired offline shell. Workflow screens must never remain stale.
self.addEventListener('install', function (event) {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (names) {
        return Promise.all(names
          .filter(function (name) { return name.indexOf('wehouse-shell-') === 0; })
          .map(function (name) { return caches.delete(name); }));
      })
      .then(function () { return self.clients.claim(); })
      .then(function () { return self.registration.unregister(); })
  );
});
