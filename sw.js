/* Radlwetter – Service Worker
 * - legt die App-Dateien beim Installieren in den Cache (läuft danach auch offline)
 * - lädt bei jeder neuen Version (config.js -> version) alles frisch und übernimmt sofort
 * - Wetterdaten (Open-Meteo) holt die App selbst; hier wird nichts davon zwischengespeichert
 */
importScripts('./config.js');

const CACHE = 'radlwetter-' + RADL_CONFIG.version;
const DATEIEN = [
  './', './index.html', './style.css', './config.js', './logik.js', './app.js',
  './manifest.webmanifest', './icons/icon.svg', './icons/icon-32.png',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(DATEIEN.map((u) => c.add(new Request(u, { cache: 'reload' })))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('radlwetter-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Gleiche Herkunft: erst Cache (schnell), im Hintergrund erneuern. Alles andere: direkt ins Netz.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (c) => {
      const treffer = await c.match(req, { ignoreSearch: true });
      const netz = fetch(req).then((r) => {
        if (r && r.ok) c.put(req, r.clone());
        return r;
      }).catch(() => treffer);
      return treffer || netz;
    })
  );
});
