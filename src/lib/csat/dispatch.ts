// ============================================================
// CSAT dispatch hooks — invoked from inside `dispatchWebhookEvent`
// (src/lib/webhooks/deliver.ts) so every existing `deal.won` /
// `message.received` source also drives the post-sale survey with zero
// extra call sites, exactly like `dispatchToGoogleSheets`.
//
//   deal.won         -> queueCsatForDeal   (insert a survey row;
//                       send now if delay_minutes = 0, else the cron
//                       /api/csat/cron picks it up when due)
//   message.received -> captureCsatResponse (a button tap from a
//                       contact with an outstanding sent survey is the
//                       rating; resolve the row + return a
//                       `csat.received` follow-up event for the caller
//                       to fan out — importing dispatchWebhookEvent
//                       here would be a cycle)
//
// Best-effort: never throws. A service-role client (its own, not the
// caller's) so it works from `after()` blocks the same as the outbound
// webhook path.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type { WebhookEvent } from '@/lib/webhooks/events'
import {
  sendMessageToConversation,
  SendMessageError,
} from '@/lib/whatsapp/send-message'
import { supabaseAdmin } from './admin-client'
import { parseScoreFromReply } from './config'

export interface CsatFollowUp {
  event: Extract<WebhookEvent, 'csat.received'>
  data: Record<string, unknown>
}

interface CsatConfigRow {
  enabled: boolean
  template_name: string | null
  template_language: string | null
  scale: number
  delay_minutes: number
  cooldown_days: number
}

/** Entry point called from `dispatchWebhookEvent`. Returns a follow-up
 *  event to fan out (only for a captured CSAT response), or null. */
export async function dispatchCsat(
  _callerDb: SupabaseClient,
  accountId: string,
  event: WebhookEvent,
  data: unknown,
): Promise<CsatFollowUp | null> {
  try {
    const db = supabaseAdmin()
    const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>

    if (event === 'deal.won') {
      const dealId = typeof d.deal_id === 'string' ? d.deal_id : null
      if (dealId) await queueCsatForDeal(db, accountId, dealId)
      return null
    }

    if (event === 'message.received') {
      return await captureCsatResponse(db, accountId, d)
    }

    return null
  } catch (err) {
    console.error(
      '[csat] dispatch failed for',
      event,
      err instanceof Error ? err.message : err,
    )
    return null
  }
}

async function loadConfig(
  db: SupabaseClient,
  accountId: string,
): Promise<CsatConfigRow | null> {
  const { data } = await db
    .from('csat_config')
    .select('enabled, template_name, template_language, scale, delay_minutes, cooldown_days')
    .eq('account_id', accountId)
    .maybeSingle<CsatConfigRow>()
  return data ?? null
}

/** The contact's WhatsApp conversation to send the survey in — prefer
 *  an open one, else the most recently active. Null when the contact
 *  has no WhatsApp thread at all. */
async function resolveWhatsappConversation(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<string | null> {
  const { data } = await db
    .from('conversations')
    .select('id, status, last_message_at')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('channel', 'whatsapp')
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(10)
  const rows = (data ?? []) as { id: string; status: string | null }[]
  if (rows.length === 0) return null
  return (rows.find((r) => r.status === 'open') ?? rows[0]).id
}

async function insertSurvey(
  db: SupabaseClient,
  row: Record<string, unknown>,
): Promise<void> {
  const { error } = await db.from('csat_surveys').insert(row)
  // 23505 = a concurrent deal.won dispatch already queued this deal.
  if (error && error.code !== '23505') {
    console.error('[csat] survey insert failed:', error.message)
  }
}

async function queueCsatForDeal(
  db: SupabaseClient,
  accountId: string,
  dealId: string,
): Promise<void> {
  const config = await loadConfig(db, accountId)
  if (!config || !config.enabled || !config.template_name) return

  // Already queued for this deal? (the unique index is the real guard;
  // this just avoids a guaranteed-losing insert on the common path).
  const { data: dupe } = await db
    .from('csat_surveys')
    .select('id')
    .eq('deal_id', dealId)
    .maybeSingle()
  if (dupe) return

  const { data: deal } = await db
    .from('deals')
    .select('id, contact_id')
    .eq('id', dealId)
    .eq('account_id', accountId)
    .maybeSingle()
  if (!deal) return

  const contactId = (deal.contact_id as string | null) ?? null
  const base = {
    account_id: accountId,
    deal_id: dealId,
    contact_id: contactId,
    scale: config.scale,
  }

  if (!contactId) {
    await insertSurvey(db, { ...base, status: 'skipped', skip_reason: 'no_contact' })
    return
  }

  // Per-contact cooldown — don't survey a repeat buyer every purchase.
  if (config.cooldown_days > 0) {
    const since = new Date(Date.now() - config.cooldown_days * 86_400_000).toISOString()
    const { data: recent } = await db
      .from('csat_surveys')
      .select('id')
      .eq('contact_id', contactId)
      .in('status', ['pending', 'sent', 'responded'])
      .gte('created_at', since)
      .limit(1)
    if (recent && recent.length > 0) {
      await insertSurvey(db, { ...base, status: 'skipped', skip_reason: 'cooldown' })
      return
    }
  }

  const conversationId = await resolveWhatsappConversation(db, accountId, contactId)
  if (!conversationId) {
    await insertSurvey(db, {
      ...base,
      status: 'skipped',
      skip_reason: 'no_whatsapp_conversation',
    })
    return
  }

  // delay_minutes = 0 → send inline now; otherwise queue for the cron.
  if (config.delay_minutes === 0) {
    const sent = await trySendSurvey(db, accountId, conversationId, config)
    await insertSurvey(db, {
      ...base,
      conversation_id: conversationId,
      status: sent.ok ? 'sent' : 'failed',
      sent_at: sent.ok ? new Date().toISOString() : null,
      sent_message_id: sent.ok ? sent.messageId : null,
      error: sent.ok ? null : sent.error,
    })
    return
  }

  await insertSurvey(db, {
    ...base,
    conversation_id: conversationId,
    status: 'pending',
    send_after: new Date(Date.now() + config.delay_minutes * 60_000).toISOString(),
  })
}

/** Send the configured template into `conversationId`. Shared by the
 *  inline (delay 0) path here and the cron sweep. */
export async function trySendSurvey(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  config: Pick<CsatConfigRow, 'template_name' | 'template_language'>,
): Promise<{ ok: true; messageId: string } | { ok: false; error: string }> {
  try {
    const res = await sendMessageToConversation(db, accountId, {
      conversationId,
      messageType: 'template',
      templateName: config.template_name,
      templateLanguage: config.template_language || null,
      senderType: 'bot',
    })
    return { ok: true, messageId: res.messageId }
  } catch (err) {
    const error =
      err instanceof SendMessageError
        ? `${err.code}: ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err)
    return { ok: false, error }
  }
}

async function captureCsatResponse(
  db: SupabaseClient,
  accountId: string,
  data: Record<string, unknown>,
): Promise<CsatFollowUp | null> {
  const contactId = typeof data.contact_id === 'string' ? data.contact_id : null
  if (!contactId) return null

  const replyId =
    typeof data.interactive_reply_id === 'string' ? data.interactive_reply_id : null
  const text = typeof data.text === 'string' ? data.text : null
  const isInteractive = data.content_type === 'interactive' || !!replyId
  // A "bare rating" text ("5", "★★★★") is also accepted — the Zernio
  // WhatsApp path doesn't parse quick-reply taps into an
  // interactive_reply_id, so a survey button there surfaces as plain
  // text. Kept strict (digits/stars only) so a "5" mid-conversation
  // can't be mistaken for a rating unless a survey is actually
  // outstanding for this contact (checked next).
  const bareRating = !!text && /^\s*(?:\d{1,2}|[★⭐✩✪]{1,10})\s*$/u.test(text)
  if (!isInteractive && !bareRating) return null

  const { data: survey } = await db
    .from('csat_surveys')
    .select('id, deal_id, contact_id, scale, sent_at')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('status', 'sent')
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!survey) return null

  const score = parseScoreFromReply(replyId, text, survey.scale as number)
  // Couldn't read a rating out of the tap — leave the survey 'sent' so
  // a later valid tap still lands.
  if (score == null) return null

  // A comment only when the label carried real words (not just "5").
  const comment =
    text && !/^\s*\d{1,2}\s*$/.test(text) && text.trim().length > 0
      ? text.trim().slice(0, 1000)
      : null

  const { error } = await db
    .from('csat_surveys')
    .update({
      status: 'responded',
      score,
      comment,
      responded_at: new Date().toISOString(),
    })
    .eq('id', survey.id)
    .eq('status', 'sent') // lost-update guard against a double webhook
  if (error) {
    console.error('[csat] response update failed:', error.message)
    return null
  }

  return {
    event: 'csat.received',
    data: {
      survey_id: survey.id,
      contact_id: contactId,
      deal_id: survey.deal_id ?? null,
      score,
      scale: survey.scale,
      comment,
    },
  }
}
