// KILL-SITCH SERVICE WORKER
// Takes over from old SW, clears all caches, then self-destructs.

self.addEventListener('install', function(e) {
  // Activate immediately — don't wait for next page load
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    // Step 1: Claim all clients immediately (take over from old SW)
    self.clients.claim()
      .then(function() {
        // Step 2: Delete ALL caches
        return caches.keys().then(function(names) {
          return Promise.all(names.map(function(n) { return caches.delete(n); }));
        });
      })
      .then(function() {
        // Step 3: Self-destruct — this SW's job is done
        return self.registration.unregister();
      })
  );
});

// No fetch handler — we don't want to intercept ANY requests.
// This SW exists only to clear caches and get out of the way.
