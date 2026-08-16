// ============================================================
// Resolve which `whatsapp_config` row an outbound send should use.
//
// Post multi-number support, an account can have more than one
// WhatsApp connection. Every send path that already knows a
// `conversation` (composer, react, flows, automations) must use the
// specific number that conversation is pinned to
// (`conversations.whatsapp_config_id`), not "the account's config" —
// otherwise a reply to a customer who wrote to number B could go out
// on number A. Paths that don't have a conversation yet (first
// outbound contact from the public API) fall back to the account's
// `is_default` connection.
//
// `whatsappConfigId` may be `null` for conversations created before
// this feature shipped (backfilled to the default, but a future
// delete of that default row sets it back to NULL via
// ON DELETE SET NULL) — the `is_default` fallback covers that case
// too, and the final fallback (most recently connected row) covers
// the rare case where no row is marked default.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

export async function resolveWhatsAppConfig(
  db: SupabaseClient,
  accountId: string,
  whatsappConfigId?: string | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any | null> {
  if (whatsappConfigId) {
    const { data } = await db
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .eq('id', whatsappConfigId)
      .maybeSingle();
    if (data) return data;
    // Row was deleted out from under the conversation — fall through
    // to the account default instead of failing the send outright.
  }

  const { data: defaultRow } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .eq('is_default', true)
    .maybeSingle();
  if (defaultRow) return defaultRow;

  // No row explicitly marked default (shouldn't happen post-migration,
  // but don't fail a send over it) — take the most recently connected
  // row, matching the migration's own backfill ordering.
  const { data: anyRow } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .order('connected_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return anyRow ?? null;
}
