import type { SupabaseClient } from '@supabase/supabase-js'
import { createTwentyPerson } from './twenty-client'

// ============================================================
// One-way CRM sync: EterWA → Twenty, never the reverse.
//
// Scope (deliberately narrow — see the task that introduced this):
// when a conversation is opened by a Meta ad click
// (conversations.source = 'meta_ad'), create a Person in Twenty with
// whatever WhatsApp actually gave us — a name (or just the phone
// number, when the profile has none) and a phone number. NEVER a
// Company: Twenty's `origemContacto` field (the reason this sync
// exists) only lives on Company, but nothing at this point in the
// conversation justifies inventing a Company out of a phone number.
// If the conversation later reveals a real company/email, that update
// is a follow-up (see this file's TODO below) — not implemented here.
//
// FAIL-SAFE (non-negotiable — this is the whole point of running this
// from `after()`/fire-and-forget, see the webhook route's call site):
// Twenty being down, slow, or erroring must NEVER affect the WhatsApp
// conversation. Every failure here is caught, logged without any
// personal data (no name, no phone, no message text — only account/
// conversation ids), and swallowed. This function NEVER throws.
// ============================================================

export interface SyncMetaAdLeadArgs {
  db: SupabaseClient
  accountId: string
  conversationId: string
  contactId: string
}

/**
 * TODO (documented, not implemented — see the task's scope decision):
 * once the commercial persona learns the lead's email (it asks for one
 * before booking — see tools/handlers/commercial.ts), PATCH the Twenty
 * Person's `emails.primaryEmail` here, keyed off the `crm_person_id`
 * already stored on the conversation. Same fail-safe discipline as
 * `syncMetaAdLeadToCrm` below would apply.
 */
export async function syncMetaAdLeadToCrm(args: SyncMetaAdLeadArgs): Promise<void> {
  const { db, accountId, conversationId, contactId } = args
  try {
    const { data: config, error: configErr } = await db
      .from('ai_configs')
      .select('crm_sync_enabled')
      .eq('account_id', accountId)
      .maybeSingle()
    if (configErr) {
      console.error(`[crm sync] falha a ler ai_configs (account=${accountId}):`, configErr.message)
      return
    }
    if (!config?.crm_sync_enabled) return // off by default — see migration 048.

    // Never duplicate: a conversation already carrying a
    // `crm_person_id` was already synced (or a concurrent webhook
    // retry is racing this one) — see the atomic claim below for the
    // actual race guard.
    const { data: conv, error: convErr } = await db
      .from('conversations')
      .select('crm_person_id')
      .eq('id', conversationId)
      .maybeSingle()
    if (convErr) {
      console.error(`[crm sync] falha a ler conversations (conversation=${conversationId}):`, convErr.message)
      return
    }
    if (conv?.crm_person_id) return

    const { data: contact, error: contactErr } = await db
      .from('contacts')
      .select('name, phone')
      .eq('id', contactId)
      .maybeSingle()
    if (contactErr || !contact) {
      console.error(`[crm sync] falha a ler contacts (contact=${contactId}):`, contactErr?.message ?? 'não encontrado')
      return
    }

    const person = await createTwentyPerson({ name: contact.name, phone: contact.phone })

    // Atomic claim, same pattern as `claim_ai_reply_slot` — only write
    // `crm_person_id` while it's still NULL, so a concurrent webhook
    // retry racing this same conversation can never create two Twenty
    // people for one lead. If we lose the race, the OTHER call already
    // wrote a (different) valid Twenty person id — logging here instead
    // of silently leaking an orphan Person in Twenty.
    const { data: claimed, error: claimErr } = await db
      .from('conversations')
      .update({ crm_person_id: person.id })
      .eq('id', conversationId)
      .is('crm_person_id', null)
      .select('id')
    if (claimErr) {
      console.error(`[crm sync] falha a gravar crm_person_id (conversation=${conversationId}):`, claimErr.message)
      return
    }
    if (!claimed || claimed.length === 0) {
      console.warn(
        `[crm sync] perdeu a corrida de criação (conversation=${conversationId}) — Twenty Person ${person.id} ficou órfã.`,
      )
    }
  } catch (err) {
    // Catches TwentyNotConfiguredError, network errors, timeouts, and
    // any non-2xx response from createTwentyPerson — none of them may
    // ever reach the WhatsApp webhook's caller.
    console.error(
      `[crm sync] falhou (account=${accountId}, conversation=${conversationId}):`,
      err instanceof Error ? err.message : String(err),
    )
  }
}
