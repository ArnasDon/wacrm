import { supabaseAdmin } from './admin-client'
import { loadAiConfig } from './config'
import { buildConversationContext } from './context'
import { retrieveKnowledge } from './knowledge'
import { generateReply } from './generate'
import { buildSystemPrompt } from './defaults'
import { buildHandoffSummary } from './handoff'
import { logAiUsage } from './usage'
import { latestUserMessage } from './query'
import { engineSendMedia, engineSendText } from '@/lib/flows/meta-send'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { hasActiveCatalogSources } from './catalog/resolver'
import { CATALOG_TOOL_SPECS, GET_PRODUCT_MEDIA, executeCatalogTool } from './tools/catalog-tools'
import { catalogContextToPromptText, updateCatalogContext, type CatalogTurnContext } from './catalog/context'
import type { ToolExecutor } from './types'

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

    // Best-effort, SEPARATE from the query above on purpose: migration
    // 045 (conversations.ai_catalog_context) may not be applied yet in
    // every environment. If the column is missing, this query errors
    // and we simply proceed with no cross-turn context rather than
    // failing the whole dispatch — auto-reply must keep working exactly
    // as before this feature on an environment that hasn't migrated.
    let previousCatalogContext: CatalogTurnContext | null = null
    try {
      const { data: ctxRow, error: ctxErr } = await db
        .from('conversations')
        .select('ai_catalog_context')
        .eq('id', conversationId)
        .maybeSingle()
      if (ctxErr) throw ctxErr
      previousCatalogContext = (ctxRow?.ai_catalog_context as CatalogTurnContext | null) ?? null
    } catch (err) {
      console.warn('[ai auto-reply] ai_catalog_context read failed (migration 045 applied?):', err)
    }
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
    const acctLimit = checkRateLimit(
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

    // Catalog tools (search_catalog/get_product/get_availability/
    // get_product_media) are attached ONLY when the account has at
    // least one active Catalog integration (Budun ERP) or catalog-usage
    // Data Source — accounts with neither configured get the exact same
    // request as before this feature existed. See
    // docs/integrations/ai-data-integration/01_MASTER_EXECUTION.md.
    const catalogAvailable = await hasActiveCatalogSources(db, accountId)
    const tools = catalogAvailable ? CATALOG_TOOL_SPECS : undefined
    const executeTool: ToolExecutor | undefined = catalogAvailable
      ? wrapWithMediaSideEffect(executeCatalogTool(db, accountId), {
          accountId,
          userId: configOwnerUserId,
          conversationId,
          contactId,
        })
      : undefined

    const systemPrompt = buildSystemPrompt({
      userPrompt: config.systemPrompt,
      mode: 'auto_reply',
      knowledge,
      catalogToolsAvailable: catalogAvailable,
      catalogContextText: catalogContextToPromptText(previousCatalogContext),
    })

    const { text, handoff, usage, toolCalls } = await generateReply({
      config,
      systemPrompt,
      messages,
      tools,
      executeTool,
    })

    // Fold this turn's tool results into the cross-turn catalog context
    // (AI_Catalog_Fix_Kit FASE 5/6/9) so a later short follow-up like
    // "¿y el morado?" can resolve the right product even though the
    // tool-calling loop's own tool_calls are otherwise ephemeral. Only
    // written when there's something new OR something to carry forward
    // — and best-effort for the same reason as the read above.
    if (catalogAvailable && (toolCalls.length > 0 || previousCatalogContext)) {
      const nextCatalogContext = updateCatalogContext(previousCatalogContext, toolCalls)
      try {
        const { error } = await db
          .from('conversations')
          .update({ ai_catalog_context: nextCatalogContext })
          .eq('id', conversationId)
        if (error) throw error
      } catch (err) {
        console.warn('[ai auto-reply] ai_catalog_context write failed (migration 045 applied?):', err)
      }
    }

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
  } catch (err) {
    console.error('[ai auto-reply] dispatch failed:', err)
  }
}

/**
 * Wraps the generic catalog ToolExecutor so that a successful
 * `get_product_media` call ALSO sends the resolved image over WhatsApp
 * via the existing `engineSendMedia` — the only place in this feature
 * that touches WhatsApp media, matching
 * docs/integrations/ai-data-integration/01_MASTER_EXECUTION.md
 * ("MEDIA Y WHATSAPP" — "No crear un segundo sistema de envío de
 * media."). The Playground wiring (src/app/api/ai/playground/route.ts)
 * intentionally does NOT use this wrapper — it calls
 * `executeCatalogTool` directly, so testing the agent never messages a
 * real customer.
 *
 * Best-effort: a failed send (e.g. WhatsApp not configured, Meta
 * rejects the link) is logged and swallowed — the tool result the model
 * sees is unaffected, so the text reply still goes out even if the
 * photo attempt failed.
 */
export function wrapWithMediaSideEffect(
  base: ToolExecutor,
  target: { accountId: string; userId: string; conversationId: string; contactId: string },
): ToolExecutor {
  return async (call) => {
    const result = await base(call)
    if (call.name !== GET_PRODUCT_MEDIA || !result || typeof result !== 'object' || 'error' in result) {
      return result
    }
    const media = result as { primaryImage?: { url: string } | null; images?: { url: string }[] }
    const url = media.primaryImage?.url ?? media.images?.[0]?.url
    if (!url) return result
    try {
      await engineSendMedia({
        accountId: target.accountId,
        userId: target.userId,
        conversationId: target.conversationId,
        contactId: target.contactId,
        kind: 'image',
        link: url,
      })
    } catch (err) {
      console.error('[ai auto-reply] failed to send catalog product photo:', err instanceof Error ? err.message : err)
    }
    return result
  }
}
