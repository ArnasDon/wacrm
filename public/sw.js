/* WA CRM service worker — web push only.
 *
 * Intentionally minimal: it handles push display and notification
 * clicks, and takes control immediately. It does NOT cache or
 * intercept fetches — the app is auth'd + server-rendered + realtime,
 * so an overeager cache would break login/data freshness. Offline
 * support can be layered on later behind a deliberate strategy.
 */

self.addEventListener("install", () => {
  // Activate this SW as soon as it's installed, without waiting for
  // old tabs to close.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Start controlling already-open clients right away.
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch (_e) {
    payload = { title: "WA CRM", body: event.data.text() };
  }

  const title = payload.title || "WA CRM";
  const options = {
    body: payload.body || "",
    icon: payload.icon || "/icon-192.png",
    badge: payload.badge || "/icon-192.png",
    tag: payload.tag,
    requireInteraction: Boolean(payload.requireInteraction),
    data: { url: payload.url || "/inbox" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/inbox";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // Focus an existing tab if one is open; otherwise open a new one.
        for (const client of clientList) {
          if ("focus" in client) {
            client.focus();
            if ("navigate" in client) {
              client.navigate(targetUrl).catch(() => {});
            }
            return undefined;
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
        return undefined;
      }),
  );
});
