// ============================================================
// CSAT sweep — the send side of the post-sale survey, called once per
// tick by /api/csat/cron.
//
// Picks up `csat_surveys` rows left `pending` by the deal.won dispatch
// (delay_minutes > 0) whose `send_after` has elapsed, sends the
// account's configured template, and moves each to 'sent' / 'failed'.
// The inbound webhook path resolves 'sent' -> 'responded' when the
// customer taps a rating button (see dispatch.ts).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { trySendSurvey } from './dispatch'

const MAX_ROWS_PER_RUN = 200
/** Hard cap on provider sends per tick so a backlog drains over a few
 *  ticks instead of hammering the account's WhatsApp number. */
const MAX_SENDS_PER_RUN = 150

export interface CsatSweepResult {
  scanned: number
  sent: number
  failed: number
  skipped: number
}

interface PendingRow {
  id: string
  account_id: string
  contact_id: string | null
  conversation_id: string | null
}

interface CfgRow {
  enabled: boolean
  template_name: string | null
  template_language: string | null
  scale: number
}

export async function runCsatSweep(
  admin: SupabaseClient,
  now: Date = new Date(),
): Promise<CsatSweepResult> {
  const res: CsatSweepResult = { scanned: 0, sent: 0, failed: 0, skipped: 0 }

  const { data: pending, error } = await admin
    .from('csat_surveys')
    .select('id, account_id, contact_id, conversation_id')
    .eq('status', 'pending')
    .lte('send_after', now.toISOString())
    .order('send_after', { ascending: true })
    .limit(MAX_ROWS_PER_RUN)

  if (error) throw new Error(`csat: pending scan failed: ${error.message}`)
  if (!pending?.length) return res

  const configByAccount = new Map<string, CfgRow | null>()
  let sendsLeft = MAX_SENDS_PER_RUN

  for (const row of pending as PendingRow[]) {
    res.scanned++
    if (sendsLeft <= 0) break

    let config = configByAccount.get(row.account_id)
    if (config === undefined) {
      const { data } = await admin
        .from('csat_config')
        .select('enabled, template_name, template_language, scale')
        .eq('account_id', row.account_id)
        .maybeSingle<CfgRow>()
      config = data ?? null
      configByAccount.set(row.account_id, config)
    }

    if (!config || !config.enabled || !config.template_name) {
      await admin
        .from('csat_surveys')
        .update({ status: 'skipped', skip_reason: 'disabled' })
        .eq('id', row.id)
      res.skipped++
      continue
    }

    let conversationId = row.conversation_id
    if (!conversationId && row.contact_id) {
      const { data: conv } = await admin
        .from('conversations')
        .select('id, status, last_message_at')
        .eq('account_id', row.account_id)
        .eq('contact_id', row.contact_id)
        .eq('channel', 'whatsapp')
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(10)
      const rows = (conv ?? []) as { id: string; status: string | null }[]
      conversationId = rows.length
        ? (rows.find((r) => r.status === 'open') ?? rows[0]).id
        : null
    }

    if (!conversationId) {
      await admin
        .from('csat_surveys')
        .update({ status: 'skipped', skip_reason: 'no_whatsapp_conversation' })
        .eq('id', row.id)
      res.skipped++
      continue
    }

    sendsLeft--
    const sent = await trySendSurvey(admin, row.account_id, conversationId, config)
    if (sent.ok) {
      await admin
        .from('csat_surveys')
        .update({
          status: 'sent',
          scale: config.scale,
          conversation_id: conversationId,
          sent_at: new Date().toISOString(),
          sent_message_id: sent.messageId,
        })
        .eq('id', row.id)
      res.sent++
    } else {
      await admin
        .from('csat_surveys')
        .update({ status: 'failed', error: sent.error })
        .eq('id', row.id)
      res.failed++
      console.error('[csat] send failed', row.id, sent.error)
    }
  }

  return res
}
