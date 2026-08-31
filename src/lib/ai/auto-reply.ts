import { supabaseAdmin } from './admin-client'
import { loadAiConfig } from './config'
import { buildContextWithHistorySummary } from './context'
import { retrieveKnowledge } from './knowledge'
import { generateReply } from './generate'
import { buildSystemPrompt } from './defaults'
import { buildHandoffSummary } from './handoff'
import { logAiUsage } from './usage'
import { latestUserMessage } from './query'
import { loadAiTools } from './tools/config'
import { persistToolCallMessages } from './tools/persist'
import { engineSendText } from '@/lib/flows/meta-send'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'

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
 *
 * Tool calls (see `loadAiTools` below) are NOT gated by method or by a
 * human-approval step: a GET and a POST/PUT/PATCH/DELETE tool both fire
 * autonomously, purely on the model's own decision, driven entirely by
 * what the customer typed. That's a deliberate scope call, not an
 * oversight — an approval step is a materially bigger feature (a
 * pending/approve state + UI). If a business wires up a state-changing
 * tool (cancel an order, issue a refund), the tool's own `description`
 * and the downstream API's business logic are the only backstops today.
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

    const { messages, historySummary } = await buildContextWithHistorySummary(
      db,
      accountId,
      conversationId,
      config,
    )
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
      config.knowledgeTopK,
    )

    const { systemPrompt, knowledgeBlock, historyBlock } = buildSystemPrompt({
      userPrompt: config.systemPrompt,
      mode: 'auto_reply',
      knowledge,
      historySummary,
      handoffSensitivity: config.handoffSensitivity,
    })

    // Tools are best-effort to load: a decrypt/DB failure here degrades
    // to "no tools this turn" rather than losing the reply entirely.
    // Same treatment for the account-wide tool-call throttle — over the
    // limit means "reply without tools this turn", not "no reply".
    const toolLimit = checkRateLimit(`ai-toolcall:${accountId}`, RATE_LIMITS.aiToolCall)
    const tools = toolLimit.success
      ? await loadAiTools(db, accountId).catch((err) => {
          console.error('[ai auto-reply] loadAiTools failed:', err)
          return []
        })
      : []

    const { text, handoff, usage, toolCalls } = await generateReply({
      config,
      systemPrompt,
      knowledgeBlock,
      historyBlock,
      messages,
      tools,
    })

    // Surface every tool the model called in the thread itself, before
    // the final reply lands — an agent watching the conversation sees
    // "checked availability" → "booked the slot" → the actual reply, in
    // order. Best-effort; never blocks the send that follows.
    if (toolCalls && toolCalls.length > 0) {
      await persistToolCallMessages(db, conversationId, toolCalls)
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
      // Debug breadcrumb: a handoff (especially an immediate one, reply
      // #0) is otherwise a black box from the server logs alone — this
      // is enough to tell "the model explicitly bailed" from "a tool
      // call errored and it gave up" from "it answered but the reply
      // came back empty", without needing DB access.
      console.warn(
        `[ai auto-reply] handoff on conversation ${conversationId}: ` +
          `explicit=${handoff} emptyText=${!text} ` +
          `tools=${(toolCalls ?? []).map((c) => `${c.toolName}:${c.result.ok ? 'ok' : `error(${c.result.error})`}`).join(',') || 'none'}`,
      )
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
        // The BOT paused itself (model handoff or reply cap) — not a
        // human clicking "Take over". Distinguishing the two is what
        // lets the dormancy-reset cron (src/app/api/ai/cron/route.ts)
        // safely auto-resume this one after enough quiet time, while
        // never touching a conversation a human deliberately took over.
        ai_paused_by_human: false,
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
