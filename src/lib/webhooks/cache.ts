// ============================================================
// In-memory TTL cache for `webhook_endpoints`.
//
// `dispatchWebhookEvent` used to run one filtered SELECT per event
// dispatch (message.received, message.status_updated, ...), each a
// separate Supabase REST call / edge log line. Most accounts call this
// dozens of times a minute for the same handful of endpoints, so we
// fetch ALL of an account's active endpoints once, cache them for
// TTL_MS, and filter by event type in memory instead.
//
// Invalidated eagerly whenever a webhook endpoint is created, updated,
// or deleted through our own API (see src/app/api/v1/webhooks/*) — a
// stale cache would otherwise keep delivering to a deleted/edited
// endpoint, or miss a newly-created one, for up to TTL_MS.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { WebhookEvent } from "@/lib/webhooks/events";

export interface CachedEndpoint {
  id: string;
  url: string;
  secret: string;
  events: string[];
}

const TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  rows: CachedEndpoint[];
  expiresAt: number;
}

const byAccountId = new Map<string, CacheEntry>();

/** All active endpoints for `accountId` subscribed to `event`. */
export async function getActiveEndpointsForEvent(
  db: SupabaseClient,
  accountId: string,
  event: WebhookEvent,
): Promise<CachedEndpoint[]> {
  const all = await getActiveEndpoints(db, accountId);
  return all.filter((row) => row.events.includes(event));
}

async function getActiveEndpoints(
  db: SupabaseClient,
  accountId: string,
): Promise<CachedEndpoint[]> {
  const cached = byAccountId.get(accountId);
  if (cached && cached.expiresAt > Date.now()) return cached.rows;

  const { data, error } = await db
    .from("webhook_endpoints")
    .select("id, url, secret, events")
    .eq("account_id", accountId)
    .eq("is_active", true);

  if (error) {
    console.error("[webhooks] cache refresh failed:", error.message);
    // Fail open with whatever we had rather than silently dropping
    // deliveries; an expired-but-present entry beats none at all.
    return cached?.rows ?? [];
  }

  const rows = (data ?? []) as CachedEndpoint[];
  byAccountId.set(accountId, { rows, expiresAt: Date.now() + TTL_MS });
  return rows;
}

/** Call after any create/update/delete of an account's webhook endpoints. */
export function invalidateWebhookEndpointsCache(accountId: string): void {
  byAccountId.delete(accountId);
}

/** Test-only: clear all cached entries so tests don't leak state across cases. */
export function resetWebhookEndpointsCacheForTests(): void {
  byAccountId.clear();
}
