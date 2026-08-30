/* Chat Sandía — service worker.
 *
 * Deliberately minimal. This is an online-first CRM: caching authed
 * HTML or JS chunks here would risk serving a stale, wrong-user, or
 * post-deploy-broken shell (see next.config.ts's Cache-Control notes).
 * So the SW only:
 *   1. precaches a tiny static set (offline page, icons, manifest),
 *   2. serves the offline page when a navigation fails with no network,
 *   3. handles Web Push (`push` / `notificationclick` /
 *      `pushsubscriptionchange`) — the reason it exists at all.
 *
 * Bump SW_VERSION on any change here. `/sw.js` is served `no-store`
 * (next.config.ts) and registered with `updateViaCache: 'none'`, so the
 * browser re-fetches and byte-diffs this file on every load; a changed
 * version string then evicts the old precache in `activate`.
 */

const SW_VERSION = 'v1';
const CACHE = `sandia-static-${SW_VERSION}`;
const PRECACHE = [
  '/offline.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
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

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  // Navigations: network-first, fall back to the offline page. Never
  // cache the response — it's per-user and auth-gated.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/offline.html', { ignoreSearch: true })),
    );
    return;
  }

  // Precached static assets only: cache-first. Everything else is left
  // to the browser (no offline story for it, by design).
  const url = new URL(request.url);
  if (url.origin === self.location.origin && PRECACHE.includes(url.pathname)) {
    event.respondWith(caches.match(request).then((hit) => hit || fetch(request)));
  }
});

// ---- Web Push --------------------------------------------------------

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'Chat Sandía', body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'Chat Sandía';
  const options = {
    body: payload.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-maskable-192.png',
    tag: payload.tag || undefined,
    renotify: Boolean(payload.tag),
    data: { url: payload.url || '/notifications' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/notifications';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        // Same-origin window already open → focus it and route in-app.
        if ('focus' in client) {
          client.focus();
          if ('navigate' in client) {
            try {
              return client.navigate(target);
            } catch {
              /* cross-origin or detached — fall through to openWindow */
            }
          }
          return undefined;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
      return undefined;
    }),
  );
});

// Chrome rotates push subscriptions periodically; re-subscribe and tell
// the server, or pushes silently stop arriving. Best-effort — the VAPID
// public key comes from an endpoint so this file needs no build-time env.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const res = await fetch('/api/push/vapid-public-key');
        if (!res.ok) return;
        const { key } = await res.json();
        if (!key) return;
        const sub = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(key),
        });
        await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(sub),
        });
      } catch (err) {
        // Nothing else we can do from here.
        console.warn('[sw] pushsubscriptionchange re-subscribe failed', err);
      }
    })(),
  );
});

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = self.atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}
