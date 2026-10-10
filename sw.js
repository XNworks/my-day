const CACHE = 'myday-v3';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'manifest.json', 'icon.svg'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;

  event.respondWith(
    fetch(event.request)
      .then(res => {
        if (res.ok) caches.open(CACHE).then(c => c.put(event.request, res.clone()));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
