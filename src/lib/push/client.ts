// ============================================================
// Browser-side push helpers — permission, PushManager subscribe /
// unsubscribe, and syncing the subscription with our API.
//
// Used by the Settings ▸ Push notifications panel. Everything here
// runs in the browser only.
// ============================================================

/** Is the Push API usable in this browser at all? */
export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/**
 * iOS only delivers web push when the site is installed to the home
 * screen (standalone display-mode), on iOS 16.4+. Detect a non-installed
 * iOS browser so the UI can tell the user to "Add to Home Screen" first.
 */
export function isIosNeedsInstall(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  const isIos = /iphone|ipad|ipod/i.test(ua);
  if (!isIos) return false;
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // Safari's non-standard flag for home-screen apps.
    (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  return !standalone;
}

/** VAPID public key → Uint8Array for applicationServerKey. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

function extractKeys(sub: PushSubscription): { p256dh: string; auth: string } {
  const json = sub.toJSON();
  return {
    p256dh: json.keys?.p256dh ?? "",
    auth: json.keys?.auth ?? "",
  };
}

/**
 * Full enable flow: request permission, ensure the SW is ready,
 * subscribe via PushManager (reusing an existing subscription if any),
 * and persist it to our backend. Throws with a user-facing message on
 * failure so the caller can `toast.error(err.message)`.
 */
export async function enablePush(): Promise<void> {
  if (!isPushSupported()) {
    throw new Error("Push notifications are not supported on this browser.");
  }

  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidPublicKey) {
    throw new Error("Push is not configured (missing VAPID public key).");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Notification permission was not granted.");
  }

  const registration = await navigator.serviceWorker.ready;

  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      // Cast: TS 5.7 types Uint8Array as generic over its buffer, which
      // the DOM's BufferSource union doesn't accept directly.
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
    }));

  const { p256dh, auth } = extractKeys(subscription);

  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: subscription.endpoint,
      p256dh,
      auth,
      userAgent: navigator.userAgent,
    }),
  });

  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.error || "Failed to save the subscription.");
  }
}

/**
 * Disable: unsubscribe from PushManager and deactivate the row on our
 * backend. Tolerant — best-effort cleanup.
 */
export async function disablePush(): Promise<void> {
  if (!isPushSupported()) return;

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;

  const endpoint = subscription.endpoint;
  await subscription.unsubscribe().catch(() => {});

  await fetch("/api/push/subscribe", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  }).catch(() => {});
}

/** Whether this browser currently holds an active push subscription. */
export async function getSubscriptionState(): Promise<boolean> {
  if (!isPushSupported()) return false;
  if (Notification.permission !== "granted") return false;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  return Boolean(subscription);
}

/** Send a test notification to the current user's own devices. */
export async function sendTestPush(): Promise<void> {
  const res = await fetch("/api/push/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "WA CRM", body: "Test notification 🎉" }),
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.error || "Failed to send test notification.");
  }
  const data = (await res.json()) as { sent: number };
  if (!data.sent) {
    throw new Error("No active device to notify. Enable notifications first.");
  }
}
