import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from './admin-client'
import { loadAiConfig } from './config'
import { buildConversationContext } from './context'
import { retrieveKnowledge } from './knowledge'
import { loadCatalogContext } from './catalog-context'
import { generateReply } from './generate'
import { buildSystemPrompt, type AutoReplyCalendarContext } from './defaults'
import type { AiConfig } from './types'
import { buildHandoffSummary } from './handoff'
import { logAiUsage } from './usage'
import { latestUserMessage } from './query'
import { engineSendText } from '@/lib/flows/meta-send'
import { checkSharedRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { moveDeal, MoveDealError } from '@/lib/pipelines/move-deal'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'
import { sendCatalogToConversation, SendCatalogError } from '@/lib/products/send-catalog'
import { checkFreeBusy, createEvent, APPOINTMENT_LOOKAHEAD_MS } from '@/lib/google-calendar/api'
import type { LeadTemperature } from '@/types'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface DispatchArgs {
  /** Tenancy key — drives config, contact, and whatsapp_config lookups. */
  accountId: string
  conversationId: string
  contactId: string
  /** The account's WhatsApp config owner, used for the outbound send's
   *  audit columns (mirrors how the flow runner passes it through). */
  configOwnerUserId: string
}

/**
 * AI auto-reply for a freshly-arrived inbound message.
 *
 * Invoked from the WhatsApp webhook's `after()` block, only when no
 * deterministic flow consumed the message (flows win). Mirrors the flow
 * runner's contract: it owns its try/catch and NEVER throws — a failing
 * or slow LLM call must not affect the webhook's 200 to Meta.
 *
 * Eligibility gates (any → silent no-op):
 *   - AI off / auto-reply disabled for the account
 *   - a human agent is assigned (they own the thread)
 *   - auto-reply was disabled for this conversation (prior handoff)
 *   - the per-conversation reply cap is reached
 *   - there's nothing to reply to
 *
 * The 24h WhatsApp session window is inherently open here — we're
 * reacting to a customer message that just landed — so no separate
 * window check is needed.
 */
export async function dispatchInboundToAiReply(
  args: DispatchArgs,
): Promise<void> {
  const { accountId, conversationId, contactId, configOwnerUserId } = args

  try {
    const db = supabaseAdmin()

    const config = await loadAiConfig(db, accountId)
    if (!config || !config.autoReplyEnabled) return

    // Deterministic, user-configured responders win over the LLM — the
    // caller already excludes messages a Flow consumed. Message-level
    // automations (`new_message_received` / `keyword_match`) are
    // dispatched independently for this same inbound and may send their
    // own reply, so if the account has any active one we stand down to
    // avoid double-texting the customer. (Relationship triggers like
    // `first_inbound_message` don't count — they're not per-message
    // auto-responders.)
    const { data: autoResponders } = await db
      .from('automations')
      .select('id')
      .eq('account_id', accountId)
      .eq('is_active', true)
      .in('trigger_type', ['new_message_received', 'keyword_match'])
      .limit(1)
    if (autoResponders && autoResponders.length > 0) return

    const { data: conv, error: convErr } = await db
      .from('conversations')
      .select('assigned_agent_id, ai_autoreply_disabled, ai_reply_count')
      .eq('id', conversationId)
      .maybeSingle()
    if (convErr || !conv) return
    if (conv.assigned_agent_id) return // a human owns this thread
    if (conv.ai_autoreply_disabled) return // handed off / turned off here
    // Cheap early-out; the authoritative cap check is the atomic claim
    // below (this read can race a concurrent inbound).
    if (conv.ai_reply_count >= config.autoReplyMaxPerConversation) return

    const messages = await buildConversationContext(db, conversationId)
    if (messages.length === 0) return

    // Account-wide throttle on the shared BYO key. The per-conversation
    // cap bounds one thread; this bounds a burst across many threads (a
    // marketing blast landing 200 replies at once) so we never run the
    // owner's key past the provider's rate limit. Over the limit → skip
    // the auto-reply; the inbound still sits in the inbox for a human.
    const acctLimit = await checkSharedRateLimit(
      `ai-autoreply:${accountId}`,
      RATE_LIMITS.aiAutoReplyAccount,
    )
    if (!acctLimit.success) {
      console.warn(
        `[ai auto-reply] account ${accountId} hit the per-account rate limit — skipping this inbound.`,
      )
      return
    }

    // Ground the reply in the account's knowledge base (best-effort).
    const knowledge = await retrieveKnowledge(
      db,
      accountId,
      config,
      latestUserMessage(messages),
    )

    // Business context for autonomous stage progression: the contact's
    // currently open deal (if any) and its pipeline's non-won stages,
    // shown to the model so it can only ever pick a real option — never
    // invent one. Deliberately excludes the "won" stage: closing a deal
    // always goes through the separate, stricter purchase-confirmation
    // marker below, handled by a person, never this one.
    const dealStageOptions = await loadDealStageOptions({ db, accountId, contactId })

    // The account's active catalog, if any — lets the model recommend
    // real products/prices and offer to send the full PDF instead of
    // guessing or staying silent about what the business sells.
    const catalog = await loadCatalogContext(db, accountId)

    // Autonomous appointment scheduling — only ever offered to the
    // model when the account explicitly opted in AND has a connected
    // Google Calendar. A failed freebusy check (expired connection,
    // Google outage) just drops the capability for this reply, same
    // "degrade, never fail the reply" contract as the other autonomous
    // lookups above.
    const calendarContext = await loadCalendarContext({ db, accountId, contactId, config })

    const systemPrompt = buildSystemPrompt({
      userPrompt: config.systemPrompt,
      mode: 'auto_reply',
      knowledge,
      dealStageOptions,
      catalog,
      calendar: calendarContext,
    })

    const { text, handoff, markDealWon, moveToStageName, sendCatalog, leadTemperature, appointmentProposal, usage } = await generateReply({
      config,
      systemPrompt,
      messages,
    })

    // Record token spend on the account's BYO key. Fire-and-forget so it
    // never adds latency to the customer-facing send: `logAiUsage`
    // swallows its own errors, so the floating promise can't reject.
    // Logged regardless of handoff — the provider call happened either
    // way.
    void logAiUsage(db, {
      accountId,
      conversationId,
      mode: 'auto_reply',
      provider: config.provider,
      model: config.model,
      usage,
    })

    if (handoff || !text) {
      // The model can't (or shouldn't) answer — stop auto-replying on
      // this thread and hand it to a human. We (a) pause the bot here
      // (sticky until re-enabled), (b) route the conversation to the
      // configured handoff agent — null leaves it in the shared queue —
      // and (c) leave a short internal note so whoever picks it up has
      // context. Assigning fires the `on_conversation_assigned` trigger,
      // which notifies the agent.
      const summary = buildHandoffSummary({
        messages,
        replyCount: conv.ai_reply_count ?? 0,
      })
      const update: Record<string, unknown> = {
        ai_autoreply_disabled: true,
        ai_handoff_summary: summary,
      }
      // Only set the assignee when a target is configured AND the thread
      // isn't already owned — never stomp an existing human assignment.
      if (config.handoffAgentId && !conv.assigned_agent_id) {
        update.assigned_agent_id = config.handoffAgentId
      }
      await db.from('conversations').update(update).eq('id', conversationId)
      return
    }

    // Atomically claim a reply slot: the cap check + increment happen in
    // one UPDATE, so concurrent inbounds can never overshoot the cap. If
    // another inbound just took the last slot, `claimed` is false and we
    // skip the send. (We consume a slot slightly before the send lands —
    // fail-safe: under-reply rather than over-reply.)
    const { data: claimed, error: claimErr } = await db.rpc(
      'claim_ai_reply_slot',
      {
        conversation_id: conversationId,
        max_replies: config.autoReplyMaxPerConversation,
      },
    )
    if (claimErr) {
      // A real error here (vs. losing the cap race) is almost always a
      // deploy issue — e.g. `claim_ai_reply_slot` not EXECUTE-able by the
      // service role, or the migration not applied. Log it loudly: a
      // silent return makes "auto-reply never fires" undiagnosable.
      console.error('[ai auto-reply] claim_ai_reply_slot failed:', claimErr)
      return
    }
    if (claimed !== true) return // lost the per-conversation cap race

    await engineSendText({
      accountId,
      userId: configOwnerUserId,
      conversationId,
      contactId,
      text,
      aiGenerated: true,
    })

    // Autonomous business actions — explicit product decision, no human
    // confirmation gate for any of these (unlike every other business
    // action, which goes through POST /api/ai/actions's two-step
    // confirm flow). All run after the send so a failure here can never
    // prevent the customer-facing reply from going out. The two
    // deal-mutating ones are mutually exclusive per inbound: a purchase
    // confirmation always wins over an ordinary stage-progress signal
    // (the model is told to emit at most one "closing" marker, but code
    // stays defensive about that). Sending the catalog and setting the
    // lead temperature are both independent — neither touches `deals`,
    // so either can fire alongside any of the above.
    if (markDealWon) {
      try {
        await flagDealClosing({ db, accountId, conversationId, configOwnerUserId, handoffAgentId: config.handoffAgentId, alreadyAssigned: Boolean(conv.assigned_agent_id) })
      } catch (err) {
        console.error('[ai auto-reply] flagDealClosing failed:', err)
      }
    } else if (moveToStageName) {
      try {
        await autoMoveDealStage({ db, accountId, contactId, configOwnerUserId, stageName: moveToStageName })
      } catch (err) {
        console.error('[ai auto-reply] autonomous move_deal failed:', err)
      }
    }

    if (sendCatalog) {
      try {
        await sendCatalogToConversation(db, accountId, conversationId)
      } catch (err) {
        if (err instanceof SendCatalogError) {
          console.error('[ai auto-reply] autonomous send_catalog failed:', err.message)
        } else {
          throw err
        }
      }
    }

    if (leadTemperature) {
      try {
        await autoSetLeadTemperature({ db, accountId, contactId, configOwnerUserId, temperature: leadTemperature })
      } catch (err) {
        console.error('[ai auto-reply] autonomous set_temperature failed:', err)
      }
    }

    // Defense in depth: `buildSystemPrompt` only ever teaches the model
    // this marker when the toggle is on (via `calendarContext` above),
    // but re-check it here too rather than trusting that a marker in
    // the raw output implies the account actually opted in — a stray
    // hallucination or a customer-message injection attempt that gets
    // the literal marker text into the reply must never book a real
    // appointment on an account that has this switched off.
    if (appointmentProposal && config.autoScheduleAppointmentsEnabled) {
      try {
        await autoScheduleAppointment({ db, accountId, contactId, configOwnerUserId, proposal: appointmentProposal })
      } catch (err) {
        console.error('[ai auto-reply] autonomous schedule_appointment failed:', err)
      }
    }
  } catch (err) {
    console.error('[ai auto-reply] dispatch failed:', err)
  }
}

/**
 * Loads the prompt-time stage options for `buildSystemPrompt`. Resolves
 * "which deal is this conversation about" the same way every autonomous
 * action here does: the contact's most recently updated open deal
 * (`deals` has no populated `conversation_id` today).
 *
 * When one exists, returns its current stage + the pipeline's other
 * non-won stage names (`hasDeal: true`) — same as before this contact
 * could also have no deal at all. When there's no open deal, instead
 * offers the account's default pipeline's non-won stage names
 * (`hasDeal: false`, `currentStageName: null`) so the model can still
 * signal real buying interest and `autoMoveDealStage` creates a deal
 * directly at that stage. Returns null only when there's truly nothing
 * to offer (no pipeline configured at all, or a single-stage pipeline).
 */
async function loadDealStageOptions(args: {
  db: SupabaseClient
  accountId: string
  contactId: string
}): Promise<{ hasDeal: boolean; currentStageName: string | null; otherStageNames: string[] } | null> {
  const { db, accountId, contactId } = args

  const { data: deal } = await db
    .from('deals')
    .select('id, pipeline_id, stage_id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('status', 'open')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (deal) {
    const preSale = await loadPreSaleStages(db, deal.pipeline_id)
    const current = preSale.find((s) => s.id === deal.stage_id)
    if (!current) return null

    const otherStageNames = preSale.filter((s) => s.id !== deal.stage_id).map((s) => s.name)
    if (otherStageNames.length === 0) return null

    return { hasDeal: true, currentStageName: current.name, otherStageNames }
  }

  const pipeline = await loadDefaultPipeline(db, accountId)
  if (!pipeline) return null

  const preSale = await loadPreSaleStages(db, pipeline.id)
  const otherStageNames = preSale.map((s) => s.name)
  if (otherStageNames.length === 0) return null

  return { hasDeal: false, currentStageName: null, otherStageNames }
}

/**
 * "The account's default pipeline" — oldest one, same convention
 * `createQuote()` uses for a brand-new deal with no pipeline specified.
 * Shared by `loadDealStageOptions` and `autoMoveDealStage` so a
 * newly-created deal always lands in the same pipeline the model was
 * shown stage names from.
 */
async function loadDefaultPipeline(
  db: SupabaseClient,
  accountId: string,
): Promise<{ id: string } | null> {
  const { data } = await db
    .from('pipelines')
    .select('id')
    .eq('account_id', accountId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return (data as { id: string } | null) ?? null
}

/**
 * The pipeline's pre-sale stages, in position order — every stage
 * strictly BEFORE the won stage. `is_won = false` alone isn't enough:
 * an account can have an operational stage positioned AFTER "won" (e.g.
 * Angel's own "Seguimiento entrega" — delivery follow-up, `is_won:
 * false` but `position` greater than "Venta cerrada"'s), and offering
 * that as a candidate for autonomous move/create would let the model
 * park a still-negotiating deal in a post-sale stage, or treat it as
 * "the most advanced" option when reasoning about progress. Falls back
 * to every non-won stage (old behavior) only if the pipeline has no
 * won stage marked at all.
 */
async function loadPreSaleStages(
  db: SupabaseClient,
  pipelineId: string,
): Promise<{ id: string; name: string }[]> {
  const { data } = await db
    .from('pipeline_stages')
    .select('id, name, is_won')
    .eq('pipeline_id', pipelineId)
    .order('position')
  const all = (data ?? []) as { id: string; name: string; is_won: boolean }[]

  const wonIndex = all.findIndex((s) => s.is_won)
  const preSale = wonIndex === -1 ? all.filter((s) => !s.is_won) : all.slice(0, wonIndex)
  return preSale.map((s) => ({ id: s.id, name: s.name }))
}

/**
 * The customer explicitly confirmed the purchase. By product decision
 * the bot never marks a deal won itself — a person always finalizes a
 * sale — so this hands the conversation off exactly like `HANDOFF_SENTINEL`
 * does (pauses the bot, routes to the configured teammate, leaves a
 * summary) and logs the event to `ai_action_log` so it can be counted
 * on the AI results dashboard. Never touches `deals` at all.
 */
async function flagDealClosing(args: {
  db: SupabaseClient
  accountId: string
  conversationId: string
  configOwnerUserId: string
  handoffAgentId: string | null
  alreadyAssigned: boolean
}): Promise<void> {
  const { db, accountId, conversationId, configOwnerUserId, handoffAgentId, alreadyAssigned } = args

  const update: Record<string, unknown> = {
    ai_autoreply_disabled: true,
    ai_handoff_summary:
      'The customer explicitly confirmed the purchase. The AI assistant handed this conversation off so a teammate can close the sale.',
  }
  if (handoffAgentId && !alreadyAssigned) {
    update.assigned_agent_id = handoffAgentId
  }
  await db.from('conversations').update(update).eq('id', conversationId)

  await db.from('ai_action_log').insert({
    account_id: accountId,
    actor_user_id: configOwnerUserId,
    action: 'flag_deal_closing',
    target_id: conversationId,
    input: { source: 'auto_reply_autonomous' },
    result: { conversation_id: conversationId, handed_off_to: handoffAgentId },
  })
}

/**
 * Resolves "the deal this conversation is about" fresh (same rule as
 * `loadDealStageOptions`). If one exists, moves it to the stage the
 * model named — matched case-insensitively against that deal's own
 * pipeline's non-won stages only, so the model can never route a deal
 * to a stage it wasn't explicitly offered (or to "won" through this
 * path — that's `flagDealClosing`'s job).
 *
 * If the contact has no open deal, this CREATES one directly at the
 * named stage instead (Angel's explicit product decision, 2026-08-16 —
 * previously the bot could only ever advance a deal a human had already
 * created, which left most real conversations invisible to the
 * pipeline). Same default-pipeline resolution as `loadDealStageOptions`,
 * titled after the contact — matching the human "+ New" quick-create
 * convention in the inbox sidebar — with `value: 0` (the bot never
 * invents a price; a linked quote, if any, sets the real value
 * separately via `createQuote`).
 *
 * No-ops quietly whenever the target stage or an actual change can't be
 * resolved; a failure here never affects the already-sent
 * customer-facing reply.
 */
async function autoMoveDealStage(args: {
  db: SupabaseClient
  accountId: string
  contactId: string
  configOwnerUserId: string
  stageName: string
}): Promise<void> {
  const { db, accountId, contactId, configOwnerUserId, stageName } = args

  const { data: deal, error: dealErr } = await db
    .from('deals')
    .select('id, pipeline_id, stage_id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('status', 'open')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (dealErr) return

  if (deal) {
    const stages = await loadPreSaleStages(db, deal.pipeline_id)
    const target = stages.find(
      (s) => s.name.trim().toLowerCase() === stageName.trim().toLowerCase(),
    )
    if (!target || target.id === deal.stage_id) return

    let moved
    try {
      moved = await moveDeal(db, accountId, deal.id, target.id)
    } catch (err) {
      if (err instanceof MoveDealError) {
        console.error('[ai auto-reply] autonomous move_deal failed:', err.message)
        return
      }
      throw err
    }

    await db.from('ai_action_log').insert({
      account_id: accountId,
      actor_user_id: configOwnerUserId,
      action: 'move_deal',
      target_id: deal.id,
      input: { stageId: target.id, stageName: target.name, source: 'auto_reply_autonomous' },
      result: moved.deal,
    })

    void dispatchWebhookEvent(db, accountId, 'deal.stage_changed', {
      deal_id: moved.deal.id,
      pipeline_id: moved.deal.pipeline_id,
      stage_id: moved.deal.stage_id,
      source: 'auto_reply_autonomous',
    })
    return
  }

  const pipeline = await loadDefaultPipeline(db, accountId)
  if (!pipeline) return

  const stages = await loadPreSaleStages(db, pipeline.id)
  const target = stages.find(
    (s) => s.name.trim().toLowerCase() === stageName.trim().toLowerCase(),
  )
  if (!target) return

  const [{ data: contact }, { data: account }] = await Promise.all([
    db.from('contacts').select('name, phone').eq('id', contactId).maybeSingle(),
    db.from('accounts').select('default_currency').eq('id', accountId).maybeSingle(),
  ])
  const title = contact?.name || contact?.phone || 'Nuevo negocio'

  const { data: created, error: createErr } = await db
    .from('deals')
    .insert({
      account_id: accountId,
      user_id: configOwnerUserId,
      pipeline_id: pipeline.id,
      stage_id: target.id,
      contact_id: contactId,
      title,
      value: 0,
      currency: account?.default_currency ?? 'USD',
      status: 'open',
    })
    .select('*')
    .single()
  if (createErr || !created) {
    console.error('[ai auto-reply] autonomous create_deal failed:', createErr)
    return
  }

  await db.from('ai_action_log').insert({
    account_id: accountId,
    actor_user_id: configOwnerUserId,
    action: 'create_deal',
    target_id: created.id,
    input: { pipelineId: pipeline.id, stageId: target.id, stageName: target.name, source: 'auto_reply_autonomous' },
    result: created,
  })

  void dispatchWebhookEvent(db, accountId, 'deal.stage_changed', {
    deal_id: created.id,
    pipeline_id: created.pipeline_id,
    stage_id: created.stage_id,
    source: 'auto_reply_autonomous',
  })
}

/**
 * Sets the contact's `lead_temperature` from the model's own autonomous
 * assessment — no human confirmation, unlike the confirmed
 * `set_lead_temperature` business action (`POST /api/ai/actions`,
 * `src/lib/ai/business-actions.ts`), which still exists as a
 * human-reviewed alternative. Skips the write entirely when the value
 * hasn't changed, so this can safely run on every reply without
 * spamming `ai_action_log` or the webhook with no-op updates.
 */
async function autoSetLeadTemperature(args: {
  db: SupabaseClient
  accountId: string
  contactId: string
  configOwnerUserId: string
  temperature: LeadTemperature
}): Promise<void> {
  const { db, accountId, contactId, configOwnerUserId, temperature } = args

  const { data: contact } = await db
    .from('contacts')
    .select('lead_temperature')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle()
  if (!contact || contact.lead_temperature === temperature) return

  const { error } = await db
    .from('contacts')
    .update({ lead_temperature: temperature, updated_at: new Date().toISOString() })
    .eq('id', contactId)
    .eq('account_id', accountId)
  if (error) {
    console.error('[ai auto-reply] autonomous set_temperature update failed:', error)
    return
  }

  await db.from('ai_action_log').insert({
    account_id: accountId,
    actor_user_id: configOwnerUserId,
    action: 'set_lead_temperature',
    target_id: contactId,
    input: { temperature, source: 'auto_reply_autonomous' },
    result: { contact_id: contactId, lead_temperature: temperature },
  })

  void dispatchWebhookEvent(db, accountId, 'contact.lead_temperature_changed', {
    contact_id: contactId,
    lead_temperature: temperature,
  })
}

/**
 * Loads real Google Calendar free/busy data + the contact's email for
 * `buildSystemPrompt`'s `calendar` param — the AI is only ever shown
 * this (and therefore only ever able to use
 * `SCHEDULE_APPOINTMENT_SENTINEL_PREFIX`) when the account explicitly
 * opted into autonomous scheduling (`auto_schedule_appointments_enabled`)
 * AND has a connected calendar. Returns null in every other case,
 * including a failed freebusy call — that just silently drops the
 * capability for this one reply rather than failing it.
 */
async function loadCalendarContext(args: {
  db: SupabaseClient
  accountId: string
  contactId: string
  config: AiConfig
}): Promise<AutoReplyCalendarContext | null> {
  const { db, accountId, contactId, config } = args
  if (!config.autoScheduleAppointmentsEnabled) return null

  const { data: gcalConfig } = await db
    .from('google_calendar_config')
    .select('status')
    .eq('account_id', accountId)
    .maybeSingle()
  if (gcalConfig?.status !== 'connected') return null

  const now = new Date()
  const until = new Date(now.getTime() + APPOINTMENT_LOOKAHEAD_MS)
  try {
    const [busy, contactRow] = await Promise.all([
      checkFreeBusy(db, accountId, now.toISOString(), until.toISOString()),
      db.from('contacts').select('email').eq('id', contactId).eq('account_id', accountId).maybeSingle(),
    ])
    return {
      now: now.toISOString(),
      lookaheadUntil: until.toISOString(),
      busy,
      contactEmail: (contactRow.data as { email: string | null } | null)?.email ?? null,
    }
  } catch (err) {
    console.error('[ai auto-reply] freebusy check failed, dropping autonomous scheduling for this reply:', err)
    return null
  }
}

/**
 * Books the real Google Calendar event the model proposed — the
 * account's chosen autonomous-scheduling path, no human confirmation
 * (unlike the suggest-action + inbox-card flow in
 * src/lib/ai/business-actions.ts's `schedule_appointment`, which
 * always requires one). Re-validates everything against fresh data
 * rather than trusting the model's own text: the datetimes must
 * parse, the slot must still be free (a beat may have passed since
 * `loadCalendarContext`'s snapshot — e.g. a different conversation
 * booked the same slot in between), and the email must look real.
 * Any failure here is logged and silently dropped — it can never
 * affect the customer-facing reply, which already went out.
 */
async function autoScheduleAppointment(args: {
  db: SupabaseClient
  accountId: string
  contactId: string
  configOwnerUserId: string
  proposal: { start: string; end: string; email: string }
}): Promise<void> {
  const { db, accountId, contactId, configOwnerUserId, proposal } = args

  const start = new Date(proposal.start)
  const end = new Date(proposal.end)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    console.warn('[ai auto-reply] autonomous schedule_appointment: invalid start/end, skipping:', proposal)
    return
  }
  if (start.getTime() < Date.now() - 60_000) {
    console.warn('[ai auto-reply] autonomous schedule_appointment: proposed slot is in the past, skipping:', proposal)
    return
  }
  if (!EMAIL_RE.test(proposal.email)) {
    console.warn('[ai auto-reply] autonomous schedule_appointment: invalid attendee email, skipping:', proposal)
    return
  }

  let busy: { start: string; end: string }[]
  try {
    busy = await checkFreeBusy(db, accountId, start.toISOString(), end.toISOString())
  } catch (err) {
    console.error('[ai auto-reply] autonomous schedule_appointment: freebusy re-check failed, skipping:', err)
    return
  }
  const overlaps = busy.some((b) => new Date(b.start) < end && new Date(b.end) > start)
  if (overlaps) {
    console.warn('[ai auto-reply] autonomous schedule_appointment: slot is no longer free, skipping:', proposal)
    return
  }

  const { data: contact } = await db
    .from('contacts')
    .select('name')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle()

  let created
  try {
    created = await createEvent(db, accountId, {
      summary: `Cita con ${contact?.name ?? 'cliente'}`,
      startISO: start.toISOString(),
      endISO: end.toISOString(),
      attendeeEmail: proposal.email,
    })
  } catch (err) {
    console.error('[ai auto-reply] autonomous schedule_appointment: createEvent failed:', err)
    return
  }

  await db.from('ai_action_log').insert({
    account_id: accountId,
    actor_user_id: configOwnerUserId,
    action: 'schedule_appointment',
    target_id: contactId,
    input: { startTime: proposal.start, endTime: proposal.end, attendeeEmail: proposal.email, source: 'auto_reply_autonomous' },
    result: { event_id: created.eventId, html_link: created.htmlLink, meet_link: created.meetLink },
  })

  void dispatchWebhookEvent(db, accountId, 'appointment.scheduled', {
    contact_id: contactId,
    event_id: created.eventId,
    start: start.toISOString(),
    end: end.toISOString(),
    source: 'auto_reply_autonomous',
  })
}
