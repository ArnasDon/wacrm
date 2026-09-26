// ============================================================
// In-memory TTL cache for `whatsapp_config` — the "which number/token
// do we send as" lookup that runs on every outbound send (broadcasts,
// flows, automations, the inbox composer) and on every inbound webhook
// (to resolve phone_number_id -> account). Each of those used to be
// its own `select('*')` REST call / edge log line.
//
// Two lookup keys (account_id, phone_number_id) share the same cached
// record — sending and receiving resolve the same row from opposite
// directions. Selects only the columns the hot send/receive paths
// actually use, not `*`; callers that need other columns (verify_token,
// registration timestamps, etc. — settings-page-class, not hot) keep
// querying the table directly.
//
// Invalidate on every create/update/delete of whatsapp_config through
// our app (see src/app/api/whatsapp/config/route.ts) so a saved change
// (new token, rotated number) is visible immediately rather than for
// up to TTL_MS.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

export interface CachedWhatsappConfig {
  id: string;
  account_id: string;
  user_id: string;
  phone_number_id: string;
  access_token: string;
  status: string;
}

export const SEND_CONFIG_COLUMNS =
  "id, account_id, user_id, phone_number_id, access_token, status";

const TTL_MS = 10 * 60 * 1000;

interface CacheEntry {
  value: CachedWhatsappConfig | null;
  expiresAt: number;
}

const byAccountId = new Map<string, CacheEntry>();
const byPhoneNumberId = new Map<string, CacheEntry>();

function store(
  value: CachedWhatsappConfig | null,
  accountId?: string | null,
  phoneNumberId?: string | null,
): void {
  const entry: CacheEntry = { value, expiresAt: Date.now() + TTL_MS };
  if (accountId) byAccountId.set(accountId, entry);
  if (phoneNumberId) byPhoneNumberId.set(phoneNumberId, entry);
}

/** The account's WhatsApp config, or null if it hasn't connected one. */
export async function getWhatsappConfigByAccountId(
  db: SupabaseClient,
  accountId: string,
): Promise<CachedWhatsappConfig | null> {
  const cached = byAccountId.get(accountId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const { data, error } = await db
    .from("whatsapp_config")
    .select(SEND_CONFIG_COLUMNS)
    .eq("account_id", accountId)
    .maybeSingle();

  if (error) {
    console.error("[whatsapp-config-cache] lookup by account_id failed:", error.message);
    return cached?.value ?? null;
  }

  const config = (data as CachedWhatsappConfig | null) ?? null;
  store(config, accountId, config?.phone_number_id);
  return config;
}

/**
 * The config owning `phoneNumberId` (the webhook's inbound resolve
 * path). Also detects the pre-migration-013 duplicate-row case the
 * direct query used to guard against, so callers keep that safety net.
 */
export async function getWhatsappConfigByPhoneNumberId(
  db: SupabaseClient,
  phoneNumberId: string,
): Promise<{ config: CachedWhatsappConfig | null; duplicateRows: number }> {
  const cached = byPhoneNumberId.get(phoneNumberId);
  if (cached && cached.expiresAt > Date.now())
    return { config: cached.value, duplicateRows: 0 };

  const { data, error } = await db
    .from("whatsapp_config")
    .select(SEND_CONFIG_COLUMNS)
    .eq("phone_number_id", phoneNumberId);

  if (error) {
    console.error("[whatsapp-config-cache] lookup by phone_number_id failed:", error.message);
    return { config: cached?.value ?? null, duplicateRows: 0 };
  }

  const rows = (data ?? []) as CachedWhatsappConfig[];
  if (rows.length > 1) {
    // Don't cache an ambiguous result — surface it to the caller every
    // time so the existing "multiple configs" log/skip behavior holds.
    return { config: null, duplicateRows: rows.length };
  }

  const config = rows[0] ?? null;
  store(config, config?.account_id, phoneNumberId);
  return { config, duplicateRows: 0 };
}

/** Call after any create/update/delete of a whatsapp_config row. */
export function invalidateWhatsappConfigCache(
  accountId?: string | null,
  phoneNumberId?: string | null,
): void {
  if (accountId) byAccountId.delete(accountId);
  if (phoneNumberId) byPhoneNumberId.delete(phoneNumberId);
}
