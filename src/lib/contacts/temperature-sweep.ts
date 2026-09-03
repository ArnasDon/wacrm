// ============================================================
// Lead-temperature auto-cool sweep — the DB side of the opt-in
// "leads go cold when they go quiet" behaviour. Called once per tick by
// /api/contacts/temperature-sweep/cron.
//
// For every account with `lead_cooldown_enabled`, walk its warm/hot
// contacts and step each one notch cooler (hot -> warm -> cold) when
// both the thread has been silent and the current temperature has held
// for `lead_cooldown_days` (see decideCoolDown). Each change fires
// `contact.lead_temperature_changed` exactly like the manual inbox
// control, so Sheets / webhooks / KPIs all stay consistent.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'
import { decideCoolDown } from './temperature-cooldown'

const MAX_ACCOUNTS = 200
const MAX_CONTACTS_PER_ACCOUNT = 1000
/** Hard cap on writes per tick so a first run on a large backlog drains
 *  over a few hourly ticks instead of one huge transaction storm. */
const MAX_COOLED_PER_RUN = 500

export interface TemperatureSweepResult {
  accounts: number
  scanned: number
  cooled: number
  failed: number
}

interface AccountRow {
  id: string
  lead_cooldown_days: number
}

interface ContactRow {
  id: string
  lead_temperature: 'warm' | 'hot'
  lead_temperature_updated_at: string | null
}

export async function runTemperatureSweep(
  admin: SupabaseClient,
  now: Date = new Date(),
): Promise<TemperatureSweepResult> {
  const res: TemperatureSweepResult = { accounts: 0, scanned: 0, cooled: 0, failed: 0 }

  const { data: accounts, error } = await admin
    .from('accounts')
    .select('id, lead_cooldown_days')
    .eq('lead_cooldown_enabled', true)
    .limit(MAX_ACCOUNTS)

  if (error) throw new Error(`temperature-sweep: account scan failed: ${error.message}`)
  if (!accounts?.length) return res

  let budget = MAX_COOLED_PER_RUN

  for (const acct of accounts as AccountRow[]) {
    if (budget <= 0) break
    res.accounts++

    const cooldownDays = Number(acct.lead_cooldown_days) || 14

    const { data: contacts, error: cErr } = await admin
      .from('contacts')
      .select('id, lead_temperature, lead_temperature_updated_at')
      .eq('account_id', acct.id)
      .in('lead_temperature', ['warm', 'hot'])
      .limit(MAX_CONTACTS_PER_ACCOUNT)

    if (cErr) {
      console.error('[temperature-sweep] contact scan failed', acct.id, cErr.message)
      continue
    }
    if (!contacts?.length) continue

    const ids = contacts.map((c) => c.id as string)

    // Last thread activity per contact — `conversations.last_message_at`
    // is bumped on every message either way, so it's the right "has this
    // lead gone quiet" signal without a per-contact message query.
    const lastActivity = new Map<string, string>()
    const { data: convos } = await admin
      .from('conversations')
      .select('contact_id, last_message_at')
      .eq('account_id', acct.id)
      .in('contact_id', ids)
    for (const row of (convos ?? []) as { contact_id: string; last_message_at: string | null }[]) {
      if (!row.last_message_at) continue
      const prev = lastActivity.get(row.contact_id)
      if (!prev || row.last_message_at > prev) {
        lastActivity.set(row.contact_id, row.last_message_at)
      }
    }

    for (const c of contacts as ContactRow[]) {
      if (budget <= 0) break
      res.scanned++

      const decision = decideCoolDown({
        current: c.lead_temperature,
        lastActivityAt: lastActivity.get(c.id) ?? null,
        temperatureUpdatedAt: c.lead_temperature_updated_at,
        now,
        cooldownDays,
      })
      if (!decision) continue

      budget--
      const { data: updated, error: uErr } = await admin
        .from('contacts')
        .update({
          lead_temperature: decision.to,
          lead_temperature_updated_at: now.toISOString(),
        })
        .eq('id', c.id)
        .eq('account_id', acct.id)
        .eq('lead_temperature', decision.from) // lost-update guard
        .select('id')
        .maybeSingle()

      if (uErr || !updated) {
        if (uErr) {
          res.failed++
          console.error('[temperature-sweep] update failed', c.id, uErr.message)
        }
        continue
      }

      res.cooled++
      await dispatchWebhookEvent(admin, acct.id, 'contact.lead_temperature_changed', {
        contact_id: c.id,
        lead_temperature: decision.to,
        previous_temperature: decision.from,
        source: 'auto_cooldown',
      })
    }
  }

  return res
}
