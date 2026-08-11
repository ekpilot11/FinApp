// Offline support.
//
// Stale-while-revalidate rather than cache-first: the page you already have
// opens instantly and works on the Underground, while a fresh copy is fetched
// in the background and used next launch. Cache-first alone would pin an old
// version forever; network-first would make FinApp useless without signal.
//
// Bump CACHE when the shell changes so old entries are dropped.

const CACHE = 'finapp-v2';

const SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './js/app.js',
  './js/card-import.js',
  './js/categories.js',
  './js/category-classifier.js',
  './js/charts.js',
  './js/csv.js',
  './js/dates.js',
  './js/expense-parser.js',
  './js/image.js',
  './js/ledger.js',
  './js/money.js',
  './js/speech.js',
  './js/spelled-number.js',
  './js/storage.js',
  './js/text.js',
  './js/vision.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // One bad path must not fail the whole install, or the app silently
      // loses offline support.
      .then((cache) => Promise.allSettled(SHELL.map((path) => cache.add(path))))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request, { ignoreSearch: true });

    const network = fetch(request)
      .then((response) => {
        if (response.ok && response.type === 'basic') {
          cache.put(request, response.clone()).catch(() => { /* quota */ });
        }
        return response;
      })
      .catch(() => null);

    if (cached) return cached;

    const response = await network;
    if (response) return response;

    // Offline and never cached: fall back to the shell so a deep link still
    // opens the app rather than Safari's error page.
    return (await cache.match('./index.html')) ?? Response.error();
  })());
});
