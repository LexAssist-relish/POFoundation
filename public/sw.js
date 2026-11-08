// P O Foundation service worker
// 1) Receives payment receipts shared from GPay / bank apps (Web Share Target)
// 2) Keeps the app shell available offline-ish (network first, cache fallback)
const VERSION = 'pof-v1';
const SHARE_CACHE = 'pof-share';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(['/', '/index.html', '/manifest.webmanifest'])).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION && k !== SHARE_CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // --- Share target: stash the file, then open the app on the attach screen
  if (req.method === 'POST' && url.pathname === '/share-target') {
    event.respondWith((async () => {
      try {
        const form = await req.formData();
        const file = form.get('file');
        const cache = await caches.open(SHARE_CACHE);
        if (file && typeof file !== 'string') {
          await cache.put('/_share/file', new Response(file, {
            headers: { 'Content-Type': file.type || 'application/octet-stream' },
          }));
          await cache.put('/_share/meta', new Response(JSON.stringify({
            name: file.name || 'receipt', type: file.type, size: file.size,
            text: form.get('text') || '', at: Date.now(),
          }), { headers: { 'Content-Type': 'application/json' } }));
        } else {
          await cache.put('/_share/meta', new Response(JSON.stringify({
            error: 'no-file', text: form.get('text') || '', at: Date.now(),
          })));
        }
      } catch (err) {
        const cache = await caches.open(SHARE_CACHE);
        await cache.put('/_share/meta', new Response(JSON.stringify({ error: String(err), at: Date.now() })));
      }
      return Response.redirect('/?share=1', 303);
    })());
    return;
  }

  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // Navigations: network first, fall back to cached shell
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put('/index.html', copy)).catch(() => {});
      return res;
    }).catch(async () => (await caches.match('/index.html')) || (await caches.match('/')) || Response.error()));
    return;
  }

  // Static assets: cache, then network (hashed filenames are immutable)
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || url.pathname.endsWith('.png')) {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    })));
  }
});
