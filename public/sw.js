const CACHE = 'ooh-v1';

const PRECACHE = [
  '/',
  '/auth/login',
  '/offline.html',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);

  // API and Supabase: network only, no caching
  if (url.pathname.startsWith('/api/') || url.hostname.includes('supabase')) return;

  // Navigation requests: network-first with offline fallback
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(() =>
        caches.match('/offline.html').then(r => r || new Response('Offline', { status: 503 }))
      )
    );
    return;
  }

  // Static assets: cache-first
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (!res || res.status !== 200 || res.type === 'opaque') return res;
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      });
    })
  );
});
