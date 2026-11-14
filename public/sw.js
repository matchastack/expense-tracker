/*
 * Service worker: keeps the app shell on the device so it opens instantly and
 * works offline. Data never goes through here: /api requests always hit the
 * network, and the app keeps its own copy of the data in IndexedDB.
 */
const CACHE = 'shell-v1';
const MAX_ENTRIES = 160;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(new Request('/', { cache: 'reload' })))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trim(cache) {
  const keys = await cache.keys();
  // Oldest entries first; never drop the shell document itself.
  const extra = keys.filter((r) => new URL(r.url).pathname !== '/').slice(0, Math.max(0, keys.length - MAX_ENTRIES));
  await Promise.all(extra.map((r) => cache.delete(r)));
}

async function put(request, response) {
  if (!response || !response.ok || response.type !== 'basic') return;
  const cache = await caches.open(CACHE);
  await cache.put(request, response);
}

/** The page: answer from the cache straight away and refresh it in the background. */
async function shell(event) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match('/');
  const fresh = fetch(new Request('/', { cache: 'no-cache' }))
    .then((res) => {
      if (res.ok) cache.put('/', res.clone());
      return res;
    })
    .catch(() => null);
  if (cached) {
    event.waitUntil(fresh);
    return cached;
  }
  return (await fresh) || new Response('Offline', { status: 503, headers: { 'content-type': 'text/plain' } });
}

/** Static files have content-hashed names (or rarely change): cache first. */
async function asset(event) {
  const cached = await caches.match(event.request);
  if (cached) return cached;
  const res = await fetch(event.request);
  event.waitUntil(put(event.request, res.clone()));
  return res;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') {
    event.respondWith(shell(event));
  } else if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(asset(event));
  }
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'precache' || !Array.isArray(data.urls)) return;
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      for (const url of data.urls) {
        try {
          if (new URL(url, self.location.origin).origin !== self.location.origin) continue;
          if (!(await cache.match(url))) await cache.add(url);
        } catch (e) {
          /* skip files that cannot be fetched */
        }
      }
      await trim(cache);
    }),
  );
});
