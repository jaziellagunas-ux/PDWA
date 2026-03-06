// ─────────────────────────────────────────────────────────────
//  sw.js — EarthSync Service Worker
//  Strategy: Cache First for static assets, Network First for
//  dynamic content, with offline fallback.
// ─────────────────────────────────────────────────────────────

const CACHE_NAME    = 'earthsync-v1';
const OFFLINE_URL   = '/index.html';

// Files to pre-cache on install
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  // Google Fonts (cached on first use via runtime caching below)
];

// ── Install: pre-cache core assets ────────────────────────────
self.addEventListener('install', (event) => {
  console.log('[SW] Installing EarthSync v1...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Pre-caching core assets');
        return cache.addAll(PRECACHE_URLS);
      })
      .then(() => self.skipWaiting())
  );
});

// ── Activate: clean up old caches ─────────────────────────────
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys().then(cacheNames =>
      Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: smart caching strategies ───────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and browser-extension requests
  if (request.method !== 'GET') return;
  if (!url.protocol.startsWith('http')) return;

  // ── Google Fonts: Cache First ──────────────────────────────
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(CACHE_NAME).then(async cache => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        cache.put(request, response.clone());
        return response;
      })
    );
    return;
  }

  // ── Same-origin assets: Stale While Revalidate ────────────
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async cache => {
        const cached = await cache.match(request);

        const fetchPromise = fetch(request)
          .then(response => {
            if (response && response.status === 200 && response.type === 'basic') {
              cache.put(request, response.clone());
            }
            return response;
          })
          .catch(() => null);

        // Return cached immediately, update in background
        if (cached) {
          fetchPromise; // trigger background update
          return cached;
        }

        // No cache — wait for network, fallback to offline page
        const networkResponse = await fetchPromise;
        if (networkResponse) return networkResponse;

        // Offline fallback
        const offlineFallback = await cache.match(OFFLINE_URL);
        return offlineFallback || new Response('Sin conexión', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      })
    );
    return;
  }

  // ── Everything else: Network First with cache fallback ─────
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response && response.status === 200) {
          caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        return cached || caches.match(OFFLINE_URL);
      })
  );
});

// ── Background Sync (optional future use) ─────────────────────
self.addEventListener('sync', (event) => {
  console.log('[SW] Background sync:', event.tag);
});

// ── Push Notifications (optional future use) ──────────────────
self.addEventListener('push', (event) => {
  const data = event.data?.json() || { title: 'EarthSync', body: 'Nueva actualización disponible.' };
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body:  data.body,
      icon:  '/icons/icon-192.png',
      badge: '/icons/icon-72.png',
    })
  );
});
