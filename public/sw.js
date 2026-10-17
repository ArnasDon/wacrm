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
    data: {
      url: payload.url || "/inbox",
      ...(payload.data || {}),
    },
    tag: payload.tag || undefined,
    actions: Array.isArray(payload.actions) ? payload.actions : undefined,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const notificationData = event.notification.data || {};
  const action = event.action;

  if (action === "fix_auto") {
    const actionToken = notificationData.actionToken || "";
    const headers = {
      "Content-Type": "application/json",
    };

    if (actionToken) {
      headers["Authorization"] = `Bearer ${actionToken}`;
    }

    event.waitUntil(
      fetch("/api/sentinela/actions", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({ action: "fix_auto" }),
      })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          const result = await response.json().catch(() => ({}));
          const rem = result.remediation || {};
          const summaryBody =
            `Lotes: ${rem.envioLotesResumed ?? 0} | ` +
            `IA/Clara: ${rem.aiConversationsRecovered ?? 0} | ` +
            `Filas: ${(rem.scheduledSendsRescheduled ?? 0) + (rem.automationsRescheduled ?? 0)}`;

          return self.registration.showNotification(
            "Sentinela: Filas reprocessadas!",
            {
              body: summaryBody,
              icon: "/icon-192",
              badge: "/icon-192",
              tag: "sentinela-fix-toast",
              data: { url: "/sentinela" },
            }
          );
        })
        .catch((err) => {
          console.error("[sw] Sentinela fix_auto failed:", err);
          return self.registration.showNotification(
            "⚠️ Sentinela: Falha ao reprocessar",
            {
              body: "Não foi possível executar a correção automática em background.",
              icon: "/icon-192",
              badge: "/icon-192",
              tag: "sentinela-fix-error",
              data: { url: "/sentinela" },
            }
          );
        })
    );
    return;
  }

  // Default click or action === "open_dashboard"
  const targetUrl =
    action === "open_dashboard"
      ? notificationData.url || "/sentinela"
      : notificationData.url || "/";

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
