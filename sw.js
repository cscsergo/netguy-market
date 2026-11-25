/* NetguY Market – service worker: az app fájljai offline is elérhetők.
   Saját fájlok: előbb hálózat, ha nincs, a mentett példány. Az árfolyam-API-kat nem érinti. */
const CACHE = 'ngm-shell-v3';
const SHELL = ['./', 'index.html', 'styles.css?v=2.3.0', 'data.js?v=2.3.0', 'app.js?v=2.3.0',
  'logo.webp', 'icon-192.png', 'icon-512.png', 'manifest.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: req.mode === 'navigate' })
      .then(r => r || (req.mode === 'navigate' ? caches.match('./') : Response.error())))
  );
});
