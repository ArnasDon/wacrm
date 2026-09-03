// ============================================================
// Outbound webhook delivery.
//
// `dispatchWebhookEvent` finds the account's active endpoints
// subscribed to an event, signs one JSON payload, and POSTs it to
// each in parallel. It is best-effort and never throws — callers fire
// it from the inbound webhook's `after()` block, where a failed
// delivery must not affect the 200 OK returned to Meta.
//
// Delivery semantics (documented in docs/public-api.md):
//   - At-least-once per event: every attempt is logged as a
//     `webhook_deliveries` row. The first attempt happens inline; on
//     failure it's left `pending` with a `next_retry_at` (exponential
//     backoff: 1 min, 5 min, 30 min) for `/api/webhooks/cron` to pick
//     up. After the retry schedule is exhausted the row is marked
//     `failed` and stays that way — no further attempts.
//   - Each consecutive failed *attempt* (inline or retried) bumps the
//     endpoint's `failure_count`, unchanged from before retries
//     existed; once it crosses MAX_CONSECUTIVE_FAILURES the endpoint
//     is auto-disabled (`is_active = false`). A success resets the
//     counter and stamps `last_delivery_at`. This is deliberately
//     independent of the per-delivery retry state — an endpoint that's
//     been flaky across many different events still auto-disables even
//     if any single delivery hasn't exhausted its own retries yet.
// ============================================================

import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { decrypt } from '@/lib/whatsapp/encryption';
import { buildSignatureHeader } from '@/lib/webhooks/sign';
import { isDeliverableUrl } from '@/lib/webhooks/ssrf';
import type { WebhookEvent } from '@/lib/webhooks/events';
import { dispatchToGoogleSheets } from '@/lib/google-sheets/dispatch';
import { dispatchCsat } from '@/lib/csat/dispatch';

/** Per-endpoint HTTP timeout. Kept short — this runs in `after()`. */
export const DELIVERY_TIMEOUT_MS = 5000;

/** Auto-disable an endpoint after this many consecutive failures. */
export const MAX_CONSECUTIVE_FAILURES = 15;

/**
 * Delay before each successive retry, indexed by (attempt_count at the
 * time it failed) - 1. Attempt 1 (inline) failing schedules retry at
 * +1min; that retry (attempt 2) failing schedules +5min; that one
 * (attempt 3) failing schedules +30min; attempt 4 failing exhausts the
 * schedule and the delivery is marked `failed`.
 */
export const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000];
export const MAX_DELIVERY_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

interface EndpointRow {
  id: string;
  url: string;
  secret: string;
}

/**
 * Deliver `event` (+ `data`) to every active endpoint of `accountId`
 * subscribed to it. Never throws.
 */
export async function dispatchWebhookEvent(
  db: SupabaseClient,
  accountId: string,
  event: WebhookEvent,
  data: unknown
): Promise<void> {
  try {
    // Same event feed also lands in a connected Google Sheet, if the
    // account set one up. Independent of webhook endpoints — fired
    // first, awaited (we're already in an after()/best-effort context)
    // so a slow Sheets append doesn't get abandoned by a serverless
    // freeze, but its own errors are swallowed inside.
    await dispatchToGoogleSheets(db, accountId, event, data);

    // Post-sale CSAT: `deal.won` queues a survey; `message.received`
    // may carry the customer's rating tap. A captured rating returns a
    // `csat.received` follow-up to fan out through this same path (so
    // it reaches Sheets + subscribed endpoints); dispatchCsat can't
    // call dispatchWebhookEvent itself without an import cycle.
    const csatFollowUp = await dispatchCsat(db, accountId, event, data);
    if (csatFollowUp) {
      void dispatchWebhookEvent(db, accountId, csatFollowUp.event, csatFollowUp.data);
    }

    const { data: rows, error } = await db
      .from('webhook_endpoints')
      .select('id, url, secret')
      .eq('account_id', accountId)
      .eq('is_active', true)
      .contains('events', [event]);

    if (error || !rows || rows.length === 0) return;

    // Sign the exact bytes we send so a receiver can recompute the
    // HMAC over the raw request body. `id` is a per-delivery uuid the
    // receiver can dedupe on (deliveries are at-least-once and may
    // repeat / arrive out of order).
    const payloadObj = {
      id: randomUUID(),
      event,
      occurred_at: new Date().toISOString(),
      account_id: accountId,
      data,
    };
    const payload = JSON.stringify(payloadObj);
    const tsSeconds = Math.floor(Date.now() / 1000);

    await Promise.allSettled(
      (rows as EndpointRow[]).map((row) =>
        deliverAndLog(db, row, accountId, event, payloadObj, payload, tsSeconds)
      )
    );
  } catch (err) {
    // Never let a delivery problem bubble into the webhook response.
    console.error('[webhooks] dispatch failed:', err);
  }
}

/** Insert the delivery-log row, attempt #1, and record the outcome. */
async function deliverAndLog(
  db: SupabaseClient,
  row: EndpointRow,
  accountId: string,
  event: WebhookEvent,
  payloadObj: unknown,
  payload: string,
  tsSeconds: number
): Promise<void> {
  const { data: delivery, error: insertErr } = await db
    .from('webhook_deliveries')
    .insert({
      endpoint_id: row.id,
      account_id: accountId,
      event,
      payload: payloadObj,
      status: 'pending',
      attempt_count: 0,
    })
    .select('id')
    .single();

  if (insertErr || !delivery) {
    // Can't log it, but the endpoint should still get its event —
    // deliver without a tracked row rather than dropping the event.
    console.error('[webhooks] failed to create delivery log row:', insertErr);
    await attemptDelivery(db, row, event, payload, tsSeconds);
    return;
  }

  await attemptAndRecord(db, row, delivery.id as string, event, 1, payload, tsSeconds);
}

/**
 * One HTTP attempt: SSRF guard → decrypt secret → sign → POST.
 * Returns the outcome without touching `webhook_deliveries` or
 * `webhook_endpoints` — callers own the bookkeeping.
 */
async function attemptDelivery(
  db: SupabaseClient,
  row: EndpointRow,
  event: WebhookEvent,
  payload: string,
  tsSeconds: number
): Promise<{ ok: true; status: number } | { ok: false; status: number | null; message: string }> {
  if (!(await isDeliverableUrl(row.url))) {
    console.warn('[webhooks] refusing non-public delivery target for', row.id);
    return { ok: false, status: null, message: 'refused: non-public delivery target' };
  }

  let secret: string;
  try {
    secret = decrypt(row.secret);
  } catch (err) {
    console.error('[webhooks] secret decrypt failed for', row.id, err);
    return { ok: false, status: null, message: 'secret could not be decrypted' };
  }

  try {
    const res = await fetch(row.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Wacrm-Event': event,
        'X-Wacrm-Webhook-Id': row.id,
        'X-Wacrm-Signature': buildSignatureHeader(payload, secret, tsSeconds),
      },
      body: payload,
      // Do NOT follow redirects — a public URL could 3xx-bounce to an
      // internal address, bypassing the SSRF check above. A 3xx is a
      // misconfiguration; treat it as a failure.
      redirect: 'manual',
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    if (!res.ok) {
      return { ok: false, status: res.status, message: `endpoint responded ${res.status}` };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[webhooks] delivery to ${row.id} failed:`, message);
    return { ok: false, status: null, message };
  }
}

/**
 * Run one attempt and persist both the endpoint-level failure streak
 * (unchanged historical behavior) and the delivery-row state (new:
 * `delivered` / `pending` with a scheduled retry / `failed` once
 * exhausted). Shared between the inline first attempt and the cron
 * retry path (`retryDelivery` below).
 */
async function attemptAndRecord(
  db: SupabaseClient,
  row: EndpointRow,
  deliveryId: string,
  event: WebhookEvent,
  attemptCount: number,
  payload: string,
  tsSeconds: number
): Promise<void> {
  const outcome = await attemptDelivery(db, row, event, payload, tsSeconds);
  const nowIso = new Date().toISOString();

  if (outcome.ok) {
    await db
      .from('webhook_endpoints')
      .update({ failure_count: 0, last_delivery_at: nowIso })
      .eq('id', row.id);
    await db
      .from('webhook_deliveries')
      .update({
        status: 'delivered',
        attempt_count: attemptCount,
        last_attempt_at: nowIso,
        response_status: outcome.status,
        next_retry_at: null,
      })
      .eq('id', deliveryId);
    return;
  }

  // Every failed attempt still bumps the endpoint's consecutive-failure
  // streak — auto-disable cares about a chronically unreliable
  // endpoint across all its events, not about any one delivery's own
  // retry budget.
  await recordFailure(db, row);

  const nextDelay = RETRY_DELAYS_MS[attemptCount - 1];
  await db
    .from('webhook_deliveries')
    .update({
      status: nextDelay != null ? 'pending' : 'failed',
      attempt_count: attemptCount,
      last_attempt_at: nowIso,
      response_status: outcome.status,
      response_snippet: outcome.message.slice(0, 500),
      next_retry_at: nextDelay != null ? new Date(Date.now() + nextDelay).toISOString() : null,
    })
    .eq('id', deliveryId);
}

/**
 * Re-attempt a `pending` delivery row whose `next_retry_at` is due.
 * Re-reads the endpoint's CURRENT url/secret (an admin may have
 * rotated them since the original attempt) but replays the ORIGINAL
 * signed payload, so a receiver sees the same event content and
 * dedupe id no matter how many attempts it took. Used by
 * `/api/webhooks/cron`.
 */
export async function retryDelivery(
  db: SupabaseClient,
  delivery: {
    id: string;
    endpoint_id: string;
    event: WebhookEvent;
    attempt_count: number;
    payload: unknown;
  }
): Promise<void> {
  const { data: endpoint, error } = await db
    .from('webhook_endpoints')
    .select('id, url, secret, is_active')
    .eq('id', delivery.endpoint_id)
    .maybeSingle();

  if (error || !endpoint || !endpoint.is_active) {
    // Endpoint was deleted or disabled since this delivery was queued
    // — nothing left to retry it against.
    await db
      .from('webhook_deliveries')
      .update({ status: 'failed', next_retry_at: null, last_attempt_at: new Date().toISOString() })
      .eq('id', delivery.id);
    return;
  }

  const payload = JSON.stringify(delivery.payload);
  const tsSeconds = Math.floor(Date.now() / 1000);
  await attemptAndRecord(
    db,
    endpoint as EndpointRow,
    delivery.id,
    delivery.event,
    delivery.attempt_count + 1,
    payload,
    tsSeconds
  );
}

async function recordFailure(db: SupabaseClient, row: EndpointRow): Promise<void> {
  // Atomic increment (+ auto-disable at the threshold) via a SQL
  // function — a read-modify-write here would lose increments when two
  // deliveries to the same endpoint run concurrently (e.g.
  // conversation.created + message.received for one inbound message),
  // so a dead endpoint might never reach the disable threshold.
  const { error } = await db.rpc('record_webhook_failure', {
    endpoint_id: row.id,
    max_failures: MAX_CONSECUTIVE_FAILURES,
  });
  if (error) {
    console.error('[webhooks] record_webhook_failure failed for', row.id, error);
  }
}
