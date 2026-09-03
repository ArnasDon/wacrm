import type { SupabaseClient } from '@supabase/supabase-js'
import { moveDeal, findWonStageId, MoveDealError } from '@/lib/pipelines/move-deal'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'
import { supabaseAdmin } from '@/lib/webhooks/admin-client'
import { createQuote, CreateQuoteError, type QuoteItemInput } from '@/lib/quotes/create-quote'
import { createEvent } from '@/lib/google-calendar/api'
import { GoogleCalendarError } from '@/lib/google-calendar/oauth'
import type { LeadTemperature } from '@/types'

export type BusinessAction =
  | 'close_conversation'
  | 'mark_deal_won'
  | 'move_deal'
  | 'set_lead_temperature'
  | 'create_quote'
  | 'schedule_appointment'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const LEAD_TEMPERATURES: readonly LeadTemperature[] = ['cold', 'warm', 'hot']

export class BusinessActionError extends Error {
  constructor(message: string, readonly status = 400) { super(message) }
}

export function confirmationPhrase(action: BusinessAction, targetId: string) {
  return `CONFIRM:${action}:${targetId}`
}

export async function executeBusinessAction(args: {
  db: SupabaseClient; accountId: string; userId: string; action: BusinessAction;
  targetId: string; stageId?: string; temperature?: string
  /** create_quote only — targetId is the contact_id. */
  items?: QuoteItemInput[]
  customerNit?: string; customerEmail?: string; customerPhone?: string; customerAddress?: string
  /** schedule_appointment only — targetId is the contact_id. ISO datetimes. */
  startTime?: string; endTime?: string; attendeeEmail?: string
  appointmentSummary?: string; appointmentDescription?: string
}) {
  const {
    db, accountId, userId, action, targetId, stageId, temperature,
    items, customerNit, customerEmail, customerPhone, customerAddress,
    startTime, endTime, attendeeEmail, appointmentSummary, appointmentDescription,
  } = args
  let result: Record<string, unknown>

  // Webhook dispatch always goes through its own service-role client —
  // `db` here is the caller's RLS-scoped session client (correct for the
  // mutation itself), but delivery bookkeeping (webhook_deliveries,
  // webhook_endpoints.failure_count) requires service_role per RLS.
  const webhookDb = supabaseAdmin()

  if (action === 'close_conversation') {
    const { data, error } = await db.from('conversations').update({ status: 'closed' })
      .eq('id', targetId).eq('account_id', accountId).select('id, status').maybeSingle()
    if (error) throw new BusinessActionError(error.message, 500)
    if (!data) throw new BusinessActionError('Conversation not found', 404)
    result = data
    void dispatchWebhookEvent(webhookDb, accountId, 'conversation.closed', {
      conversation_id: data.id, closed_by: 'ai_action',
    })
  } else if (action === 'mark_deal_won') {
    // Prefer moving to the pipeline's "Venta cerrada" stage (migration
    // 051) — same operation a human dragging the card there triggers —
    // so status and stage_id never drift apart. Falls back to a direct
    // status flip only for pipelines that haven't flagged a won stage.
    const { data: deal, error: dealError } = await db.from('deals')
      .select('id, pipeline_id').eq('id', targetId).eq('account_id', accountId).maybeSingle()
    if (dealError) throw new BusinessActionError(dealError.message, 500)
    if (!deal) throw new BusinessActionError('Deal not found', 404)

    const wonStageId = await findWonStageId(db, accountId, deal.pipeline_id)
    if (wonStageId) {
      let moved
      try {
        moved = await moveDeal(db, accountId, targetId, wonStageId)
      } catch (err) {
        if (err instanceof MoveDealError) throw new BusinessActionError(err.message, err.status)
        throw err
      }
      result = { ...moved.deal }
    } else {
      const { data, error } = await db.from('deals').update({ status: 'won', won_at: new Date().toISOString() })
        .eq('id', targetId).eq('account_id', accountId)
        .select('id, pipeline_id, stage_id, status').maybeSingle()
      if (error) throw new BusinessActionError(error.message, 500)
      if (!data) throw new BusinessActionError('Deal not found', 404)
      result = data
    }
    void dispatchWebhookEvent(webhookDb, accountId, 'deal.won', {
      deal_id: targetId, source: 'ai_action',
    })
  } else if (action === 'move_deal') {
    if (!stageId) throw new BusinessActionError('stageId is required')
    let moved
    try {
      moved = await moveDeal(db, accountId, targetId, stageId)
    } catch (err) {
      if (err instanceof MoveDealError) throw new BusinessActionError(err.message, err.status)
      throw err
    }
    result = { ...moved.deal }
    void dispatchWebhookEvent(webhookDb, accountId, 'deal.stage_changed', {
      deal_id: moved.deal.id, pipeline_id: moved.deal.pipeline_id, stage_id: moved.deal.stage_id, source: 'ai_action',
    })
    if (moved.isWonStage) {
      void dispatchWebhookEvent(webhookDb, accountId, 'deal.won', {
        deal_id: moved.deal.id, source: 'ai_action',
      })
    }
  } else if (action === 'set_lead_temperature') {
    // targetId is a contact_id for this action (every other action
    // targets a conversation or deal) — callers must know the right id
    // shape per action, same as move_deal already requires a stageId.
    if (!temperature || !LEAD_TEMPERATURES.includes(temperature as LeadTemperature)) {
      throw new BusinessActionError('temperature must be one of cold, warm, hot')
    }
    const nowIso = new Date().toISOString()
    const { data, error } = await db.from('contacts')
      .update({
        lead_temperature: temperature,
        lead_temperature_updated_at: nowIso,
        updated_at: nowIso,
      })
      .eq('id', targetId).eq('account_id', accountId)
      .select('id, lead_temperature').maybeSingle()
    if (error) throw new BusinessActionError(error.message, 500)
    if (!data) throw new BusinessActionError('Contact not found', 404)
    result = data
    void dispatchWebhookEvent(webhookDb, accountId, 'contact.lead_temperature_changed', {
      contact_id: data.id, lead_temperature: data.lead_temperature,
    })
  } else if (action === 'create_quote') {
    // targetId is a contact_id for this action, like set_lead_temperature.
    // allowFreeItems: false — the AI may only ever quote from products
    // that exist in the account's catalog; createQuote() enforces this
    // itself (rejects any item without a valid, active product_id), so
    // the model can't invent an item or a price even if it tried.
    try {
      const created = await createQuote({
        db, accountId, userId, contactId: targetId,
        customerNit: customerNit ?? '', customerEmail: customerEmail ?? '',
        customerPhone: customerPhone ?? '', customerAddress: customerAddress ?? '',
        items: items ?? [], allowFreeItems: false,
      })
      result = { ...created.quote, items: created.items }
    } catch (err) {
      if (err instanceof CreateQuoteError) throw new BusinessActionError(err.message, err.status)
      throw err
    }
    void dispatchWebhookEvent(webhookDb, accountId, 'quote.created', {
      quote_id: (result as { id: string }).id, contact_id: targetId, source: 'ai_action',
    })
  } else if (action === 'schedule_appointment') {
    // targetId is a contact_id, like create_quote/set_lead_temperature.
    // Always confirmed by a human first (POST /api/ai/actions'
    // two-step flow) — this action never runs as an autonomous
    // sentinel, unlike move_deal/set_lead_temperature, because it has
    // an immediate real-world effect (a real calendar event + a real
    // email to a real customer).
    if (!startTime || !endTime || !attendeeEmail) {
      throw new BusinessActionError('startTime, endTime, and attendeeEmail are required')
    }
    if (!EMAIL_RE.test(attendeeEmail)) throw new BusinessActionError('attendeeEmail is not a valid email address')
    const start = new Date(startTime)
    const end = new Date(endTime)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      throw new BusinessActionError('startTime/endTime must be valid, with endTime after startTime')
    }

    const { data: contact, error: contactError } = await db.from('contacts')
      .select('id, name').eq('id', targetId).eq('account_id', accountId).maybeSingle()
    if (contactError) throw new BusinessActionError(contactError.message, 500)
    if (!contact) throw new BusinessActionError('Contact not found', 404)

    const { data: accountRow } = await db.from('accounts').select('timezone').eq('id', accountId).maybeSingle()
    const timeZone = (accountRow as { timezone: string | null } | null)?.timezone || 'UTC'

    let created
    try {
      created = await createEvent(db, accountId, {
        summary: appointmentSummary?.trim() || `Cita con ${contact.name ?? 'cliente'}`,
        description: appointmentDescription,
        startISO: start.toISOString(),
        endISO: end.toISOString(),
        attendeeEmail,
        timeZone,
      })
    } catch (err) {
      if (err instanceof GoogleCalendarError) throw new BusinessActionError(err.message, err.status)
      throw err
    }
    result = {
      event_id: created.eventId, html_link: created.htmlLink, meet_link: created.meetLink,
      start: start.toISOString(), end: end.toISOString(), attendee_email: attendeeEmail,
    }
    void dispatchWebhookEvent(webhookDb, accountId, 'appointment.scheduled', {
      contact_id: targetId, event_id: created.eventId,
      start: start.toISOString(), end: end.toISOString(), source: 'ai_action',
    })
  } else {
    throw new BusinessActionError(`Unsupported action: ${action as string}`)
  }

  const auditRow = {
    account_id: accountId, actor_user_id: userId, action, target_id: targetId,
    input: {
      ...(stageId ? { stageId } : {}),
      ...(temperature ? { temperature } : {}),
      ...(action === 'create_quote' ? { items, customerNit, customerEmail, customerPhone, customerAddress } : {}),
      ...(action === 'schedule_appointment' ? { startTime, endTime, attendeeEmail, appointmentSummary } : {}),
    },
    result,
  }
  // The action's real-world effect has already happened by this point (a
  // deal moved, a Google Calendar event + a customer email sent, a quote
  // created). Audit logging must NEVER surface as a retryable failure:
  // returning a 5xx here makes the client re-POST the same confirmed
  // action and double-book / double-quote. Best-effort with one retry,
  // then log loudly and return the result anyway — the same discipline
  // the autonomous auto-reply path already applies to its own
  // ai_action_log writes.
  let { error: auditError } = await db.from('ai_action_log').insert(auditRow)
  if (auditError) {
    ;({ error: auditError } = await db.from('ai_action_log').insert(auditRow))
  }
  if (auditError) {
    console.error(
      `[business-action] ${action} on ${targetId} (account ${accountId}) succeeded but ai_action_log insert failed:`,
      auditError.message,
    )
  }
  return result
}
