const CACHE_NAME = 'wacrm-offline-v1';
const OFFLINE_URL = '/offline';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.add(OFFLINE_URL);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match(OFFLINE_URL);
      })
    );
  }
});

self.addEventListener('push', function (event) {
  if (!event.data) return;

  try {
    const payload = event.data.json();
    event.waitUntil(
      self.registration.showNotification(payload.title, {
        body: payload.body,
        icon: '/icon-192x192.png',
        badge: '/icon-192x192.png',
        data: payload.data,
      })
    );
  } catch (err) {
    console.error('Error handling push event', err);
  }
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  const url = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(url) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});
