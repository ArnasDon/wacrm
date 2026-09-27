// ============================================================
// WhatsApp channels — which whatsapp_config row a send goes through.
//
// Since migration 043 an account can hold several whatsapp_config rows
// ("channels"), one per connected phone number. Every account-scoped
// `.single()` lookup would now throw on the second row, so all sends
// resolve their channel here instead:
//
//   * a conversation replies through the channel the customer last
//     wrote to (`conversations.whatsapp_config_id`, set by the webhook);
//   * anything without a conversation — or whose channel was removed —
//     falls back to the account's default channel.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ChannelRow = Record<string, any>;

/**
 * Columns safe to hand to the browser — everything except the
 * encrypted access / verify tokens.
 */
export const CHANNEL_PUBLIC_COLUMNS =
  'id, name, color, is_default, phone_number_id, waba_id, waba_name, display_phone_number, verified_name, quality_rating, messaging_limit_tier, meta_status, code_verification_status, name_status, account_mode, is_official_business_account, country_code, country_dial_code, throughput_level, webhook_url, status, registered_at, subscribed_apps_at, last_registration_error, connected_at, meta_synced_at, created_at';

/**
 * The account's default channel: the row flagged `is_default`, else the
 * oldest connected row, else the oldest row. Null when the account has
 * no WhatsApp connected at all.
 */
export async function loadDefaultChannel(
  db: SupabaseClient,
  accountId: string
): Promise<ChannelRow | null> {
  const { data, error } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .order('created_at', { ascending: true });
  if (error || !data || data.length === 0) return null;
  return (
    data.find((r: ChannelRow) => r.is_default) ??
    data.find((r: ChannelRow) => r.status === 'connected') ??
    data[0]
  );
}

/**
 * A channel of the given WABA — the default one if it belongs to that
 * WABA, else the oldest. Templates live per WABA (migration 047), so
 * template calls to Meta go through any channel of the template's WABA.
 * Falls back to the default channel when `wabaId` is empty (legacy rows).
 */
export async function loadChannelForWaba(
  db: SupabaseClient,
  accountId: string,
  wabaId: string | null | undefined
): Promise<ChannelRow | null> {
  if (!wabaId) return loadDefaultChannel(db, accountId);
  const { data } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .eq('waba_id', wabaId)
    .order('created_at', { ascending: true });
  if (!data || data.length === 0) return null;
  return data.find((r: ChannelRow) => r.is_default) ?? data[0];
}

/** One channel by id, scoped to the account. */
export async function loadChannelById(
  db: SupabaseClient,
  accountId: string,
  channelId: string
): Promise<ChannelRow | null> {
  const { data } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('id', channelId)
    .eq('account_id', accountId)
    .maybeSingle();
  return data ?? null;
}

/**
 * The contact's most recently active conversation, across channels.
 *
 * A contact has one conversation per channel (migration 043), so a
 * lookup by contact alone can match several. Sends that name a contact
 * but not a conversation (contact-page send, API send-by-phone,
 * automations without a triggering conversation) continue the thread
 * the customer was last active in.
 */
export async function findLatestConversationId(
  db: SupabaseClient,
  accountId: string,
  contactId: string
): Promise<string | null> {
  const { data, error } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  return (data?.[0]?.id as string | undefined) ?? null;
}

/**
 * The channel a conversation replies through, falling back to the
 * default channel when the conversation has none recorded (API-created
 * before any inbound message) or its channel was disconnected.
 */
export async function loadChannelForConversation(
  db: SupabaseClient,
  accountId: string,
  conversationId: string | null | undefined,
  knownChannelId?: string | null
): Promise<ChannelRow | null> {
  let channelId = knownChannelId ?? null;
  if (!channelId && conversationId) {
    const { data: conv } = await db
      .from('conversations')
      .select('whatsapp_config_id')
      .eq('id', conversationId)
      .eq('account_id', accountId)
      .maybeSingle();
    channelId = conv?.whatsapp_config_id ?? null;
  }
  if (channelId) {
    const channel = await loadChannelById(db, accountId, channelId);
    if (channel) return channel;
  }
  return loadDefaultChannel(db, accountId);
}
