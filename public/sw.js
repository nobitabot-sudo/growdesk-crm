const CACHE = 'growdesk-crm-v1';
const SHELL = ['/', '/index.html', '/app.js', '/scriptData.js', '/styles.css', '/manifest.json', '/icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

// Network-first for API calls (data must be fresh), cache-first for the app shell.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/')) return; // let API calls go straight to network
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
