/**
 * Load the per-account AI assistant configuration (spec §4.1, §5).
 *
 * A thin service-role read of the single `ai_assistant_config` row for an
 * account. The webhook path runs as service-role and bypasses RLS exactly
 * as the Flows and automations engines already do (spec §4 / §12).
 *
 * Returns `null` when no config row exists (the account never opened the
 * AI Settings tab) or on any DB error — the caller treats a missing config
 * as "AI off" and skips, which is the safe default (spec §6: `!enabled →
 * skip`, and the broader fail-safe-to-human bias of §1).
 */

import { type AiAssistantConfig } from "@/types";

import { supabaseAdmin } from "./admin-client";

/**
 * Load `ai_assistant_config` for one account.
 *
 * `.maybeSingle()` returns `null` (not an error) when there is no row, so
 * an account without a config simply reads as "no AI configured". The
 * `account_id` column is UNIQUE in the DB (spec §4.1), so at most one row
 * ever matches.
 */
export async function loadAiConfig(
  accountId: string,
): Promise<AiAssistantConfig | null> {
  const db = supabaseAdmin();

  const { data, error } = await db
    .from("ai_assistant_config")
    .select("*")
    .eq("account_id", accountId)
    .maybeSingle();

  if (error) {
    console.error("[ai] loadAiConfig error:", error.message);
    return null;
  }

  return (data as AiAssistantConfig | null) ?? null;
}
