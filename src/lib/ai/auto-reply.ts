import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from './admin-client'
import { waitForQuietPeriod } from './debounce'
import { loadAiConfig } from './config'
import { buildConversationContext } from './context'
import { retrieveKnowledge } from './knowledge'
import { loadCatalogContext } from './catalog-context'
import { loadQuickReplyContext } from './quick-reply-context'
import { generateReply } from './generate'
import { buildSystemPrompt, type AutoReplyCalendarContext } from './defaults'
import { AiError, type AiConfig } from './types'
import { buildHandoffSummary } from './handoff'
import { logAiUsage } from './usage'
import { latestUserMessage } from './query'
import { engineSendText } from '@/lib/flows/meta-send'
import { checkSharedRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { moveDeal, MoveDealError } from '@/lib/pipelines/move-deal'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'
import { sendCatalogToConversation, SendCatalogError } from '@/lib/products/send-catalog'
import { checkFreeBusy, createEvent, APPOINTMENT_LOOKAHEAD_MS } from '@/lib/google-calendar/api'
import { formatWithOffset } from '@/lib/timezone'
import { createQuote, CreateQuoteError, type QuoteItemInput } from '@/lib/quotes/create-quote'
import { sendQuoteToConversation, sendQuoteAsText, SendQuoteError } from '@/lib/quotes/send-quote'
import type { LeadTemperature } from '@/types'
import type { GenerateResult } from './types'

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
 * Debounced first (see debounce.ts): a burst of rapid-fire inbound
 * messages on the same conversation collapses into one reply for the
 * last message in the burst, not one reply per message.
 *
 * Eligibility gates (any → silent no-op):
 *   - superseded by a newer inbound before the debounce quiet period
 *     elapsed
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

  // Debounce: coalesce a burst of rapid-fire inbound messages into one
  // reply (see debounce.ts) — stand down silently if a newer inbound on
  // this conversation superseded this call while it waited. Kept
  // outside the try/catch below on purpose: it does no I/O beyond a
  // timer, so it has nothing to fail on, and standing down is a normal
  // outcome, not an error to log.
  const isLatest = await waitForQuietPeriod(conversationId)
  if (!isLatest) return

  try {
    const db = supabaseAdmin()

    const config = await loadAiConfig(db, accountId)
    if (!config || !config.autoReplyEnabled) return

    const { data: conv, error: convErr } = await db
      .from('conversations')
      .select('assigned_agent_id, ai_autoreply_disabled, ai_reply_count')
      .eq('id', conversationId)
      .maybeSingle()
    if (convErr || !conv) return
    if (conv.assigned_agent_id) return // a human owns this thread
    if (conv.ai_autoreply_disabled) return // handed off / turned off here
    // Cheap early-out; the authoritative cap check is the atomic claim
    // below (this read can race a concurrent inbound). Reaching the cap
    // used to just go silent forever on this thread — the customer got
    // no reply and no human was ever notified, which is exactly the
    // "AI never handed off" symptom this now fixes: treat running out
    // of auto-reply budget the same as the bot being unable to help,
    // and hand off instead of going quiet.
    if (conv.ai_reply_count >= config.autoReplyMaxPerConversation) {
      await handOffToHuman({
        db,
        conversationId,
        handoffAgentId: config.handoffAgentId,
        alreadyAssigned: Boolean(conv.assigned_agent_id),
        summary: `🤖 AI agent reached its ${config.autoReplyMaxPerConversation}-reply limit for this conversation and paused — needs a human follow-up.`,
      })
      return
    }

    const messages = await buildConversationContext(db, conversationId)
    if (messages.length === 0) return

    // Angel's explicit product decision (2026-08-19): the AI must never
    // go quiet because of a message-level automation (`new_message_received`
    // / `keyword_match`). This used to stand the bot down whenever any
    // such automation was merely active on the account — including ones
    // that never matched this message's content, or that never actually
    // messaged the customer at all (e.g. a `move_deal`-only automation) —
    // which produced total, unexplained silence on real conversations. A
    // customer-facing automation firing on the same inbound can now cause
    // a double reply; that tradeoff is accepted in exchange for the bot
    // never silently doing nothing.

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

    // The account's saved 'text' quick replies, if any — lets the model
    // answer a routine question with the exact human-approved wording
    // instead of writing its own paraphrase every time.
    const quickReplies = await loadQuickReplyContext(db, accountId)

    // How the catalog actually gets delivered (migration 068) — also
    // gates whether the model is taught CREATE_QUOTE_SENTINEL_PREFIX
    // (see buildSystemPrompt below): the digital page already has its
    // own self-service quote cart, so this only turns on for pdf/photos.
    const { data: catalogModeRow } = await db
      .from('accounts')
      .select('catalog_delivery_mode')
      .eq('id', accountId)
      .maybeSingle()
    const catalogDeliveryMode = (catalogModeRow?.catalog_delivery_mode as 'digital' | 'pdf' | 'photos' | undefined) ?? 'digital'

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
      catalogDeliveryMode,
      quickReplies,
      askCustomerTaxInfo: config.askCustomerTaxInfo,
    })

    const {
      text, handoff, markDealWon, moveToStageName, sendCatalog, leadTemperature, appointmentProposal, quoteProposal, quickReplyId, usage,
    } = await generateReply({
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

    // Resolve the quick reply the model picked (if any) against the
    // account's real rows — never trust the id blindly (a stray
    // hallucination or a customer-message injection attempt must never
    // put arbitrary text on the wire). Only a 'text'-kind row counts;
    // an unmatched id, an 'interactive' row, or no marker at all all
    // resolve to null and the model's own `text` is used instead. When
    // it does resolve, that row's own `content_text` — never the
    // model's paraphrase — is what actually gets sent, so this
    // conversation's persisted history (and therefore the model's own
    // context on a later turn) reflects exactly what the customer was
    // told, word for word.
    let quickReplyText: { id: string; text: string } | null = null
    if (quickReplyId) {
      const { data: qr } = await db
        .from('quick_replies')
        .select('id, content_text')
        .eq('id', quickReplyId)
        .eq('account_id', accountId)
        .eq('kind', 'text')
        .maybeSingle()
      if (qr?.content_text) quickReplyText = { id: qr.id as string, text: qr.content_text as string }
    }
    const outboundText = quickReplyText?.text ?? text

    if (!outboundText && !handoff) {
      // The model produced no usable reply text but didn't ask for a
      // human either — most likely it emitted only a marker (e.g. the
      // temperature sentinel) with no actual customer-facing message,
      // a generation glitch rather than a real "I can't help" signal.
      // Skip this inbound silently rather than forcing an unrequested
      // handoff (previously `!text` alone triggered the same handoff
      // path as an explicit request, which handed real conversations
      // to a human even though the customer never asked and no sale
      // closed). The next inbound message gets a fresh attempt.
      console.warn(
        `[ai auto-reply] empty reply text for conversation ${conversationId}, skipping without handoff`,
      )
      return
    }

    if (handoff) {
      // The customer explicitly asked for a human AND then confirmed
      // it (the two-step protocol taught in `buildSystemPrompt` — the
      // model only ever emits this sentinel on that confirming turn,
      // never on the same turn as the initial request). Stop
      // auto-replying on this thread and hand it to one. We (a) pause
      // the bot here
      // (sticky until re-enabled), (b) route the conversation to the
      // configured handoff agent — null leaves it in the shared queue —
      // and (c) leave a short internal note so whoever picks it up has
      // context. Assigning fires the `on_conversation_assigned` trigger,
      // which notifies the agent.
      const summary = buildHandoffSummary({
        messages,
        replyCount: conv.ai_reply_count ?? 0,
      })
      await handOffToHuman({
        db,
        conversationId,
        handoffAgentId: config.handoffAgentId,
        alreadyAssigned: Boolean(conv.assigned_agent_id),
        summary,
      })
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
      text: outboundText,
      aiGenerated: true,
    })

    if (quickReplyText) {
      try {
        await db.from('ai_action_log').insert({
          account_id: accountId,
          actor_user_id: configOwnerUserId,
          action: 'send_quick_reply',
          target_id: quickReplyText.id,
          input: { quick_reply_id: quickReplyText.id, source: 'auto_reply_autonomous' },
          result: { conversation_id: conversationId },
        })
      } catch (err) {
        console.error('[ai auto-reply] send_quick_reply audit log failed:', err)
      }
    }

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
        await autoScheduleAppointment({
          db, accountId, contactId, configOwnerUserId, proposal: appointmentProposal,
          timeZone: calendarContext?.timeZone ?? 'UTC',
        })
      } catch (err) {
        console.error('[ai auto-reply] autonomous schedule_appointment failed:', err)
      }
    }

    // Defense in depth, same reasoning as the appointment check above:
    // buildSystemPrompt only ever teaches CREATE_QUOTE_SENTINEL_PREFIX
    // when catalogDeliveryMode is 'pdf'/'photos', but re-check here too
    // rather than trusting a marker in the raw output — a stray
    // hallucination or an injection attempt in a customer message must
    // never build a quote on a digital-catalog account, which already
    // has its own self-service cart for this.
    if (quoteProposal && catalogDeliveryMode !== 'digital') {
      try {
        await autoCreateQuoteFromChat({
          db, accountId, contactId, configOwnerUserId, conversationId, proposal: quoteProposal,
          handoffAgentId: config.handoffAgentId,
          alreadyAssigned: Boolean(conv.assigned_agent_id),
        })
      } catch (err) {
        console.error('[ai auto-reply] autonomous create_quote_chat failed:', err)
      }
    }
  } catch (err) {
    if (err instanceof AiError && err.code === 'invalid_key') {
      // A broken BYO key used to fail exactly like any other AI error —
      // logged to the server console only, customer gets no reply, and
      // nothing in the product itself ever surfaced it (confirmed live
      // 2026-08-21: an account's bot went silently dead for hours,
      // discovered only because a customer complained). Distinct from
      // transient errors (timeout/rate_limited/network/provider_error)
      // below, which are expected to self-heal and don't warrant
      // waking anyone up.
      console.error('[ai auto-reply] AI provider rejected the API key:', err.message)
      await notifyAiKeyInvalid(supabaseAdmin(), accountId).catch((notifyErr) => {
        console.error('[ai auto-reply] failed to send invalid-key notification:', notifyErr)
      })
    } else {
      console.error('[ai auto-reply] dispatch failed:', err)
    }
  }
}

/**
 * Alerts the account's admins/owners (the roles allowed to edit AI
 * settings — see `requireRole('admin')` in
 * src/app/api/ai/config/route.ts) that the configured AI provider key
 * is being rejected. Throttled to at most one alert per account per 6h
 * so a sustained outage sends one notification, not one per inbound
 * message.
 */
async function notifyAiKeyInvalid(db: SupabaseClient, accountId: string): Promise<void> {
  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
  const { data: recent } = await db
    .from('notifications')
    .select('id')
    .eq('account_id', accountId)
    .eq('type', 'ai_key_invalid')
    .gte('created_at', sixHoursAgo)
    .limit(1)
    .maybeSingle()
  if (recent) return

  const { data: recipients } = await db
    .from('profiles')
    .select('user_id')
    .eq('account_id', accountId)
    .in('account_role', ['owner', 'admin'])
  if (!recipients || recipients.length === 0) return

  await db.from('notifications').insert(
    recipients.map((r) => ({
      account_id: accountId,
      user_id: r.user_id as string,
      type: 'ai_key_invalid',
      title: 'AI auto-reply is down',
      body: 'The AI provider rejected the configured API key, so customers are not getting automatic replies. Check Settings → AI.',
    })),
  )
}

/**
 * Shared conversation-update for every way the bot hands a conversation
 * off to a human: pauses the bot (sticky until re-enabled), records
 * when it happened (drives the dashboard's "average human wait time"
 * card — migration 070), leaves an internal note, and routes to the
 * configured handoff agent unless the thread already has one — never
 * stomps an existing human assignment. Assigning fires the
 * `on_conversation_assigned` trigger, which notifies the agent.
 */
async function handOffToHuman(args: {
  db: SupabaseClient
  conversationId: string
  handoffAgentId: string | null
  alreadyAssigned: boolean
  summary: string
}): Promise<void> {
  const { db, conversationId, handoffAgentId, alreadyAssigned, summary } = args
  const update: Record<string, unknown> = {
    ai_autoreply_disabled: true,
    ai_handoff_summary: summary,
    ai_handoff_at: new Date().toISOString(),
  }
  if (handoffAgentId && !alreadyAssigned) {
    update.assigned_agent_id = handoffAgentId
  }
  await db.from('conversations').update(update).eq('id', conversationId)
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

  await handOffToHuman({
    db,
    conversationId,
    handoffAgentId,
    alreadyAssigned,
    summary:
      'The customer explicitly confirmed the purchase. The AI assistant handed this conversation off so a teammate can close the sale.',
  })

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
    const [busy, contactRow, accountRow] = await Promise.all([
      checkFreeBusy(db, accountId, now.toISOString(), until.toISOString()),
      db.from('contacts').select('email').eq('id', contactId).eq('account_id', accountId).maybeSingle(),
      db.from('accounts').select('timezone').eq('id', accountId).maybeSingle(),
    ])
    const timeZone = (accountRow.data as { timezone: string | null } | null)?.timezone || 'UTC'
    return {
      timeZone,
      now: formatWithOffset(now, timeZone),
      lookaheadUntil: formatWithOffset(until, timeZone),
      // Google's freebusy response is UTC ("Z") — reformat each
      // interval with the same offset as `now`/`lookaheadUntil` so the
      // model reasons about all three in one consistent timezone.
      busy: busy.map((b) => ({
        start: formatWithOffset(new Date(b.start), timeZone),
        end: formatWithOffset(new Date(b.end), timeZone),
      })),
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
  /** Account's IANA timezone, for the created event's display timezone
   *  — the actual booked instant is already correct regardless (the
   *  proposal's offset-qualified datetime disambiguates it), this only
   *  affects how the event's time is labeled/rendered in Calendar. */
  timeZone: string
}): Promise<void> {
  const { db, accountId, contactId, configOwnerUserId, proposal, timeZone } = args

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
      timeZone,
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

/**
 * Builds and sends a quote the model assembled from the chat itself —
 * only reachable when the catalog is delivered as a PDF/photos (see
 * the `catalogDeliveryMode` check at the call site), since the digital
 * catalog page already has its own self-service cart for this.
 *
 * Re-resolves every item name against the account's real, active
 * `products` (case-insensitive exact match) rather than trusting the
 * model's text — an unmatched name is dropped, never invented; if
 * NOTHING matches, or the quote can't be created/sent for any other
 * reason, this hands the conversation to a human instead of aborting
 * silently — a real incident (2026-08-25) had the bot promise "I can
 * prepare your quote now" and then go completely quiet, with nothing
 * in the CRM to show anything had gone wrong. `createQuote({
 * allowFreeItems: false })` is the exact same guard the public
 * catalog's own cart relies on, so a chat-originated quote can't
 * invent a product or price there either even if a name did match by
 * coincidence.
 */
async function autoCreateQuoteFromChat(args: {
  db: SupabaseClient
  accountId: string
  contactId: string
  configOwnerUserId: string
  conversationId: string
  proposal: NonNullable<GenerateResult['quoteProposal']>
  handoffAgentId: string | null
  alreadyAssigned: boolean
}): Promise<void> {
  const { db, accountId, contactId, configOwnerUserId, conversationId, proposal, handoffAgentId, alreadyAssigned } = args

  const handoff = (reason: string) =>
    handOffToHuman({
      db,
      conversationId,
      handoffAgentId,
      alreadyAssigned,
      summary: `🤖 The AI told this customer it would prepare a quote (${proposal.items.map((i) => `${i.name} x${i.qty}`).join(', ')}), but ${reason} — needs a human to finish it.`,
    })

  const { data: products } = await db
    .from('products')
    .select('id, name')
    .eq('account_id', accountId)
    .eq('is_active', true)
  const byName = new Map(
    (products ?? []).map((p) => [String(p.name).trim().toLowerCase(), p.id as string]),
  )

  const items: QuoteItemInput[] = []
  const unmatched: string[] = []
  for (const item of proposal.items) {
    const productId = byName.get(item.name.trim().toLowerCase())
    if (!productId) {
      console.warn(`[ai auto-reply] create_quote_chat: no active product matches "${item.name}", skipping it`)
      unmatched.push(item.name)
      continue
    }
    items.push({ product_id: productId, quantity: item.qty })
  }
  if (items.length === 0) {
    console.warn('[ai auto-reply] create_quote_chat: no item matched a real product, aborting')
    await handoff(`couldn't match "${unmatched.join('", "')}" to a real catalog product`)
    return
  }

  const { data: contact } = await db
    .from('contacts')
    .select('phone')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle()

  let created
  try {
    created = await createQuote({
      db,
      accountId,
      userId: configOwnerUserId,
      contactId,
      customerNit: proposal.customerNit,
      customerEmail: proposal.customerEmail,
      customerPhone: contact?.phone ?? '',
      customerAddress: proposal.customerAddress,
      items,
      allowFreeItems: false,
    })
  } catch (err) {
    if (err instanceof CreateQuoteError) {
      console.error('[ai auto-reply] create_quote_chat: createQuote failed:', err.message)
      await handoff(`creating it failed: ${err.message}`)
      return
    }
    throw err
  }

  try {
    if (proposal.format === 'text') {
      await sendQuoteAsText(db, accountId, created.quote.id, conversationId)
    } else {
      await sendQuoteToConversation(db, accountId, created.quote.id, conversationId)
    }
  } catch (err) {
    if (err instanceof SendQuoteError) {
      console.error('[ai auto-reply] create_quote_chat: send failed:', err.message)
      // The quote itself was created (quotes.id above) — only delivery
      // failed, so a human can resend it from Products → Quotes instead
      // of starting over from scratch.
      await handoff(`the quote (#${created.quote.id.slice(0, 8)}) was created but couldn't be sent: ${err.message}`)
      return
    }
    throw err
  }

  await db.from('ai_action_log').insert({
    account_id: accountId,
    actor_user_id: configOwnerUserId,
    action: 'create_quote',
    target_id: created.quote.id,
    input: { items: proposal.items, format: proposal.format, source: 'auto_reply_autonomous' },
    result: { quote_id: created.quote.id, total: created.quote.total },
  })
}
