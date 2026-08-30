/** Browser-side Web Push helpers. Safe to import anywhere; every entry
 *  point guards on feature support and returns a benign value when push
 *  isn't available (old browser, no SW, keys unset). */

export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  // Explicit ArrayBuffer (not ArrayBufferLike) so this satisfies
  // `BufferSource` for `pushManager.subscribe({ applicationServerKey })`.
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

export function pushConfigured(): boolean {
  return pushSupported() && Boolean(VAPID_PUBLIC_KEY);
}

async function readyRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  try {
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

export async function currentPushSubscription(): Promise<PushSubscription | null> {
  const reg = await readyRegistration();
  if (!reg) return null;
  return reg.pushManager.getSubscription();
}

/**
 * Ensure the browser has a push subscription and the server knows about
 * it. Idempotent — safe to call on every load. Returns true when the
 * server has a live subscription for this device afterwards.
 */
export async function subscribeToPush(): Promise<boolean> {
  const reg = await readyRegistration();
  if (!reg || !VAPID_PUBLIC_KEY) return false;

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    try {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    } catch {
      return false;
    }
  }

  try {
    const res = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(sub),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function unsubscribeFromPush(): Promise<void> {
  const sub = await currentPushSubscription();
  if (!sub) return;
  try {
    await fetch('/api/push/unsubscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
  } catch {
    /* server may already have pruned it */
  }
  await sub.unsubscribe().catch(() => {});
}

export type PushState = 'unsupported' | 'unconfigured' | 'denied' | 'off' | 'on';

export async function getPushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (!VAPID_PUBLIC_KEY) return 'unconfigured';
  if (Notification.permission === 'denied') return 'denied';
  const sub = await currentPushSubscription();
  if (Notification.permission === 'granted' && sub) return 'on';
  return 'off';
}
