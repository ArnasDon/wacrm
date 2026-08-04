// Service worker for Web Push notifications (custom feature, not part
// of the upstream wacrm template). Deliberately minimal — no offline
// caching, just push handling — so it can't interfere with Next.js's
// own asset loading or introduce stale-cache bugs.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "wacrm", body: event.data.text() };
  }

  const title = payload.title || "wacrm";
  const options = {
    body: payload.body || "",
    icon: "/icon-192",
    badge: "/icon-192",
    data: { url: payload.url || "/inbox" },
    tag: payload.tag || undefined,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/inbox";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          const clientUrl = new URL(client.url);
          if (clientUrl.origin === self.location.origin && "focus" in client) {
            client.navigate(targetUrl);
            return client.focus();
          }
        }
        return self.clients.openWindow(targetUrl);
      })
  );
});
