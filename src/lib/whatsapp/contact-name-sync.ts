import type { SupabaseClient } from '@supabase/supabase-js'
import { listContacts } from '@/lib/whatsapp/uazapi-api'
import { findExistingContact } from '@/lib/contacts/dedupe'
import { classifyWhatsAppChat, isNonIndividualChat } from '@/lib/whatsapp/chat-classify'

// ============================================================
// Automatic WhatsApp address-book contact-name sync (uazapi).
//
// Goal: contacts that already have a thread in the inbox should show
// the name the connected WhatsApp number has saved for them, without
// any manual "sync" action. There is no cron job here — the uazapi
// webhook route calls `maybeSyncContactNames` on every event it
// receives (connection pings, inbound messages, status updates), and
// this file's own throttle decides whether that particular call
// actually does the work. Whichever event happens to arrive after the
// throttle window opens ends up doing the sync — for an account
// that's actively connected, that's typically minutes, not hours.
//
// Deliberately narrower than a full "import my WhatsApp contacts"
// feature: this only ever UPDATES the name on a contact that already
// exists (i.e. already has an inbox thread, created by an actual
// inbound/outbound message). It never creates a new contact from the
// address book alone — an entry with no message history has no
// business showing up in the inbox, same reasoning as the
// group/community filter in chat-classify.ts.
// ============================================================

const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6h

interface MaybeSyncParams {
  supabaseAdmin: SupabaseClient
  accountId: string
  baseUrl: string
  token: string
}

/**
 * Throttle gate + entry point, called from the uazapi webhook route
 * (and the instance/status poll, for the "just connected" moment).
 * Safe to call on every event — cheap (one SELECT) when the window
 * hasn't opened yet, and claims the window (via an UPDATE) before
 * doing the slower work so a burst of near-simultaneous events
 * doesn't all kick off their own sync.
 */
export async function maybeSyncContactNames(params: MaybeSyncParams): Promise<void> {
  const { supabaseAdmin, accountId, baseUrl, token } = params

  try {
    const { data: config } = await supabaseAdmin
      .from('whatsapp_config')
      .select('contacts_synced_at')
      .eq('account_id', accountId)
      .eq('provider', 'uazapi')
      .maybeSingle()

    const lastSyncMs = config?.contacts_synced_at
      ? new Date(config.contacts_synced_at as string).getTime()
      : 0
    if (Date.now() - lastSyncMs < SYNC_INTERVAL_MS) return

    // Claim the window immediately, before the (slower) API call and
    // DB scan below — a losing race against a concurrent event just
    // means we skip this round and retry next window, never a
    // duplicate sync running twice in parallel.
    await supabaseAdmin
      .from('whatsapp_config')
      .update({ contacts_synced_at: new Date().toISOString() })
      .eq('account_id', accountId)
      .eq('provider', 'uazapi')

    const { updated, scanned } = await syncContactNames({ supabaseAdmin, accountId, baseUrl, token })
    console.log(
      `[contact-name-sync] account ${accountId}: updated ${updated}/${scanned} contact name(s) from the WhatsApp address book`,
    )
  } catch (err) {
    // Never let this take down the message/connection processing that
    // triggered it — worst case, the next event retries.
    console.error('[contact-name-sync] check/sync failed:', err)
  }
}

async function syncContactNames(params: MaybeSyncParams): Promise<{ updated: number; scanned: number }> {
  const { supabaseAdmin, accountId, baseUrl, token } = params

  const contacts = await listContacts({ baseUrl, token, contactScope: 'address_book' })

  let updated = 0
  for (const c of contacts) {
    if (!c.jid) continue

    // address_book scope shouldn't include groups/communities, but
    // stay consistent with the inbound filter regardless of what
    // uazapi actually returns.
    if (isNonIndividualChat(classifyWhatsAppChat(c.jid))) continue

    const phone = c.jid.split('@')[0]
    const name = c.contact_name?.trim()
    if (!phone || !name) continue

    const existing = await findExistingContact(supabaseAdmin, accountId, phone)
    if (!existing) continue // No inbox thread for this number — nothing to rename.
    if (existing.name === name) continue

    const { error } = await supabaseAdmin
      .from('contacts')
      .update({ name, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
    if (!error) updated++
  }

  return { updated, scanned: contacts.length }
}
