import type { SupabaseClient } from '@supabase/supabase-js'

export interface OutboundContactRow {
  id: string
  phone: string | null
  wa_user_id?: string | null
}

/**
 * Load a contact for an outbound WhatsApp send (automations, flows, API).
 *
 * The entry ownership guard in the automation engine selects only `id`,
 * so a missing `wa_user_id` column (migration 040 not applied) used to
 * surface here as a misleading "contact not found for this account".
 */
export async function fetchContactForOutboundSend(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<OutboundContactRow> {
  const scoped = await db
    .from('contacts')
    .select('id, phone, wa_user_id')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle()

  if (!scoped.error && scoped.data) {
    return scoped.data as OutboundContactRow
  }

  if (scoped.error && isMissingWaUserIdColumn(scoped.error)) {
    const legacy = await db
      .from('contacts')
      .select('id, phone')
      .eq('id', contactId)
      .eq('account_id', accountId)
      .maybeSingle()
    if (legacy.error) {
      throw new Error(`contact lookup failed: ${legacy.error.message}`)
    }
    if (!legacy.data) {
      throw new Error('contact not found for this account')
    }
    return { ...legacy.data, wa_user_id: null }
  }

  if (scoped.error) {
    throw new Error(`contact lookup failed: ${scoped.error.message}`)
  }
  throw new Error('contact not found for this account')
}

function isMissingWaUserIdColumn(error: { message?: string; code?: string }): boolean {
  const msg = (error.message ?? '').toLowerCase()
  return (
    msg.includes('wa_user_id') ||
    (error.code === '42703' && msg.includes('column'))
  )
}
