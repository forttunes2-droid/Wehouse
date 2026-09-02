// WeHouse app shell. Live account data remains network-driven; versioned local
// assets are cached so navigation does not reconstruct the whole interface.
const CACHE='wehouse-shell-20260902-1';
const SHELL=['/','/manifest.webmanifest','/icon-192.png','/icon-512.png'];
self.addEventListener('install', function(e) {
  e.waitUntil(caches.open(CACHE).then(function(cache){return cache.addAll(SHELL)}).then(function(){return self.skipWaiting()}));
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(names.filter(function(n){return n!==CACHE}).map(function(n) { return caches.delete(n); }));
    }).then(function() {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function(e) {
  if (e.request.method !== 'GET') return;
  var url=new URL(e.request.url);
  if(url.origin!==self.location.origin)return;
  if(e.request.mode==='navigate'){
    e.respondWith(fetch(e.request).then(function(response){var copy=response.clone();caches.open(CACHE).then(function(cache){cache.put('/',copy)});return response}).catch(function(){return caches.match('/')}));
    return;
  }
  if(url.pathname.startsWith('/assets/')||/\.(?:png|jpg|jpeg|webp|svg|woff2?)$/i.test(url.pathname)){
    e.respondWith(caches.match(e.request).then(function(cached){if(cached)return cached;return fetch(e.request).then(function(response){if(response.ok){var copy=response.clone();caches.open(CACHE).then(function(cache){cache.put(e.request,copy)})}return response})}));
  }
});
