import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from './admin-client'
import { loadAiConfig } from './config'
import { buildConversationContext } from './context'
import { retrieveKnowledge } from './knowledge'
import { loadCatalogContext } from './catalog-context'
import { generateReply } from './generate'
import { buildSystemPrompt } from './defaults'
import { buildHandoffSummary } from './handoff'
import { logAiUsage } from './usage'
import { latestUserMessage } from './query'
import { engineSendText } from '@/lib/flows/meta-send'
import { checkSharedRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { moveDeal, MoveDealError } from '@/lib/pipelines/move-deal'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'
import { sendCatalogToConversation, SendCatalogError } from '@/lib/products/send-catalog'

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

    const systemPrompt = buildSystemPrompt({
      userPrompt: config.systemPrompt,
      mode: 'auto_reply',
      knowledge,
      dealStageOptions,
      catalog,
    })

    const { text, handoff, markDealWon, moveToStageName, sendCatalog, usage } = await generateReply({
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
    // stays defensive about that). Sending the catalog is independent —
    // it mutates nothing, so it can fire alongside either.
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
  } catch (err) {
    console.error('[ai auto-reply] dispatch failed:', err)
  }
}

/**
 * Loads the prompt-time stage options for `buildSystemPrompt`: the
 * contact's most recently updated open deal (same "which deal is this
 * conversation about" resolution every autonomous action here uses —
 * `deals` has no populated `conversation_id` today) and its pipeline's
 * non-won stage names. Returns null when there's no open deal, or the
 * deal's current stage can't be resolved among the pipeline's non-won
 * stages, or there are no other stages to offer.
 */
async function loadDealStageOptions(args: {
  db: SupabaseClient
  accountId: string
  contactId: string
}): Promise<{ currentStageName: string; otherStageNames: string[] } | null> {
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
  if (!deal) return null

  const { data: stages } = await db
    .from('pipeline_stages')
    .select('id, name')
    .eq('pipeline_id', deal.pipeline_id)
    .eq('is_won', false)
    .order('position')
  const all = stages ?? []
  const current = all.find((s) => s.id === deal.stage_id)
  if (!current) return null

  const otherStageNames = all.filter((s) => s.id !== deal.stage_id).map((s) => s.name)
  if (otherStageNames.length === 0) return null

  return { currentStageName: current.name, otherStageNames }
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
 * `loadDealStageOptions`) and moves it to the stage the model named —
 * matched case-insensitively against that deal's own pipeline's
 * non-won stages only, so the model can never route a deal to a stage
 * it wasn't explicitly offered (or to "won" through this path — that's
 * `flagDealClosing`'s job). No-ops quietly whenever the deal, the named
 * stage, or an actual change can't be resolved; a failed move never
 * affects the already-sent customer-facing reply.
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
  if (dealErr || !deal) return

  const { data: stages } = await db
    .from('pipeline_stages')
    .select('id, name')
    .eq('pipeline_id', deal.pipeline_id)
    .eq('is_won', false)
  const target = (stages ?? []).find(
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
}
