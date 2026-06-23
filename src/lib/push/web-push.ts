// ============================================================
// Web Push core — VAPID config + a single, reusable sender.
//
// This module is the only place that talks to the `web-push`
// library. It requires the Node.js runtime (web-push uses Node's
// crypto), so any route that imports it must NOT run on the edge
// runtime. VAPID details are read from env — the same key pair is
// used here (public + private) and in the browser (public only).
//
// On a 404/410 from the push service the subscription is dead
// (the user unsubscribed or the browser rotated it); we flip its
// `active` flag off via the service-role client so the next send
// skips it. We never throw — push is best-effort and must never
// break the caller (the WhatsApp webhook in particular).
// ============================================================

import webpush from "web-push";

import { supabaseAdmin } from "@/lib/automations/admin-client";

let vapidConfigured = false;

/**
 * Configure web-push with our VAPID details exactly once. Returns
 * false (and logs) if the env vars are missing, so callers can
 * short-circuit instead of throwing into the webhook path.
 */
function ensureVapidConfigured(): boolean {
  if (vapidConfigured) return true;

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;

  if (!publicKey || !privateKey || !subject) {
    console.error(
      "[web-push] missing VAPID env (NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT) — push disabled",
    );
    return false;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
  return true;
}

/** Shape stored in `push_subscriptions` (the columns we send with). */
export interface StoredSubscription {
  id: string;
  endpoint: string;
  p256dh_key: string;
  auth_key: string;
}

/** JSON delivered to the service worker's `push` handler. */
export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  url?: string;
  tag?: string;
  requireInteraction?: boolean;
}

/** Per-subscription result (mirrors the reference impl's `details`). */
export interface SendDetail {
  subscriptionId: string;
  endpoint: string;
  success: boolean;
  statusCode?: number;
  error?: string;
}

/**
 * Send one push. Marks the subscription inactive on 404/410. Never
 * throws — returns a detail describing the outcome.
 */
export async function sendToSubscription(
  sub: StoredSubscription,
  payload: PushPayload,
): Promise<SendDetail> {
  if (!ensureVapidConfigured()) {
    return {
      subscriptionId: sub.id,
      endpoint: sub.endpoint,
      success: false,
      error: "VAPID not configured",
    };
  }

  try {
    const res = await webpush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh_key, auth: sub.auth_key },
      },
      JSON.stringify(payload),
    );

    // Best-effort bookkeeping; ignore failures.
    void supabaseAdmin()
      .from("push_subscriptions")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", sub.id);

    return {
      subscriptionId: sub.id,
      endpoint: sub.endpoint,
      success: true,
      statusCode: res.statusCode,
    };
  } catch (err: unknown) {
    const statusCode =
      typeof err === "object" && err !== null && "statusCode" in err
        ? (err as { statusCode?: number }).statusCode
        : undefined;
    const message = err instanceof Error ? err.message : String(err);

    // 404 Not Found / 410 Gone — the endpoint is dead. Retire it so
    // future sends skip it.
    if (statusCode === 404 || statusCode === 410) {
      void supabaseAdmin()
        .from("push_subscriptions")
        .update({ active: false })
        .eq("id", sub.id);
    } else {
      console.error("[web-push] send failed", { endpoint: sub.endpoint, statusCode, message });
    }

    return {
      subscriptionId: sub.id,
      endpoint: sub.endpoint,
      success: false,
      statusCode,
      error: message,
    };
  }
}

/** Fan out one payload to many subscriptions in parallel. */
export async function sendToSubscriptions(
  subs: StoredSubscription[],
  payload: PushPayload,
): Promise<SendDetail[]> {
  const results = await Promise.allSettled(
    subs.map((s) => sendToSubscription(s, payload)),
  );
  return results.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : {
          subscriptionId: subs[i].id,
          endpoint: subs[i].endpoint,
          success: false,
          error: String(r.reason),
        },
  );
}
