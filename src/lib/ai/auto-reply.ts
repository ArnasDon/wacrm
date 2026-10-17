import { supabaseAdmin } from './admin-client'
import { loadAiConfig } from './config'
import { buildConversationContext, latestCustomerMessageId } from './context'
import { retrieveKnowledge, accountHasKnowledgeBase } from './knowledge'
import { generateReply } from './generate'
import { buildSystemPrompt, buildSystemPromptBlocks, getSystemTimeContext } from './defaults'
import { buildHandoffSummary } from './handoff'
import { logAiUsage, deriveCatalogExternalFlags, classifyGenerateFailure } from './usage'
import { latestUserMessage } from './query'
import { routeAiContext } from './routing'
import { loadBusinessProfileForAgent, isAccountMember, type BusinessProfileForAgent } from './business-profile/service'
import { buildBusinessProfileContext } from './business-profile/context'
import { detectHandoffIntent, describeHandoffIntent } from './business-profile/handoff-intent'
import { engineSendMedia, engineSendText } from '@/lib/flows/meta-send'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { createResolverCache, hasActiveCatalogSources } from './catalog/resolver'
import { CATALOG_TOOL_SPECS, GET_PRODUCT_MEDIA, executeCatalogTool } from './tools/catalog-tools'
import { catalogContextToPromptText, updateCatalogContext, type CatalogTurnContext } from './catalog/context'
import type { AiConfig, ToolExecutor } from './types'
import type { SupabaseClient } from '@supabase/supabase-js'

interface DispatchArgs {
  /** Tenancy key — drives config, contact, and whatsapp_config lookups. */
  accountId: string
  conversationId: string
  contactId: string
  /** The account's WhatsApp config owner, used for the outbound send's
   *  audit columns (mirrors how the flow runner passes it through). */
  configOwnerUserId: string
}

interface ConversationGateState {
  assigned_agent_id: string | null
  ai_autoreply_disabled: boolean
  ai_reply_count: number
}

// ============================================================
// H-6 (Punto 6 audit) — AI-processing mutual exclusion per conversation.
//
// PROBLEM: two inbound messages from the same contact, delivered as two
// separate webhook calls processed concurrently (each in its own
// `after()` invocation — no shared lock between them), could each call
// dispatchInboundToAiReply() for the SAME conversation at the same
// time. Message INSERTION was already race-free (migration 053), but
// nothing downstream of it was — two dispatches could both build
// context, call the model, and send a reply simultaneously.
// claim_ai_reply_slot() (below, unchanged) bounds how MANY replies a
// conversation can receive; it never prevented two of those replies
// from racing each other's context.
//
// FIX: a claim on `conversations.ai_processing_started_at`, acquired
// via a single atomic UPDATE...WHERE...RETURNING (same shape as this
// engagement's own H-5 fix for ai_data_sources refreshes) before any
// context is built. A second, concurrent dispatch for the same
// conversation fails this claim and returns WITHOUT generating a
// competing reply — see `processOneTurn`'s drain loop below for why
// that message is never lost despite the second dispatch bailing.
// See migration 060 for the full design rationale, TTL justification,
// and the one deliberately-accepted residual race.
// ============================================================

const AI_PROCESSING_CLAIM_STALE_AFTER_MS = 10 * 60_000
/** Bounds how many customer messages one dispatch will drain through in
 *  a single invocation before yielding to the NEXT webhook delivery —
 *  a safety cap, not an expected steady state. A 4th rapid-fire message
 *  is still safe: it simply becomes a fresh dispatch that reclaims the
 *  (by-then-released, or stale) claim and continues. */
const MAX_DRAIN_ITERATIONS = 3

/** Atomically claims the right to run AI processing for `conversationId`
 *  — succeeds only if no processing is currently claimed, or the
 *  existing claim is stale. Returns false (never throws) when another
 *  dispatch already holds a live claim — the caller's correct response
 *  is to return silently, not to treat this as an error. */
async function claimAiProcessing(
  db: SupabaseClient,
  conversationId: string,
  accountId: string,
): Promise<boolean> {
  const staleThreshold = new Date(Date.now() - AI_PROCESSING_CLAIM_STALE_AFTER_MS).toISOString()
  const { data, error } = await db
    .from('conversations')
    .update({ ai_processing_started_at: new Date().toISOString() })
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .or(`ai_processing_started_at.is.null,ai_processing_started_at.lt.${staleThreshold}`)
    .select('id')
    .maybeSingle()
  if (error) {
    console.error('[ai auto-reply] claimAiProcessing failed:', error)
    return false
  }
  return data != null
}

/** Atomically checks whether a newer customer message arrived than
 *  `lastSeenMessageId` while this dispatch was busy generating/sending.
 *  If not, releases the claim. If so, refreshes the claim (the caller
 *  still holds it) and reports it so the SAME dispatch loops back and
 *  answers the new message — see migration 060's function body, which
 *  does this check-and-decide as one atomic statement (a plain
 *  PostgREST filter can't express a cross-table condition like this). */
async function releaseOrContinueAiProcessing(
  db: SupabaseClient,
  conversationId: string,
  lastSeenMessageId: string | null,
): Promise<{ released: boolean }> {
  // A `RETURNS TABLE` function's `data` comes back as an array of rows
  // (exactly one, here) — same convention this codebase already uses
  // for insert_inbound_customer_message (migration 053,
  // src/app/api/whatsapp/webhook/route.ts), not `.maybeSingle()`.
  const { data, error } = await db.rpc('release_or_continue_ai_processing', {
    p_conversation_id: conversationId,
    p_last_seen_message_id: lastSeenMessageId,
  })
  if (error) {
    // Fail toward releasing — an unreleased claim only self-heals after
    // the staleness window, whereas a released claim that turns out to
    // have missed a message is still fully recoverable (see the drain
    // loop's own bail-safely reasoning): a later inbound to this same
    // conversation will simply reclaim and answer it in the ordinary
    // way. Never silently swallow the error without logging it.
    console.error('[ai auto-reply] releaseOrContinueAiProcessing failed — releasing the claim defensively:', error)
    await releaseAiProcessingClaim(db, conversationId)
    return { released: true }
  }
  const row = (data as { released: boolean; latest_message_id: string | null }[] | null)?.[0]
  return { released: row?.released ?? true }
}

/** Unconditional release — the safety net used on every "stop, do not
 *  loop" exit (handoff, provider error, ineligibility discovered
 *  mid-drain) and, redundantly but harmlessly, in the outer `finally`
 *  so a bug in the loop's own bookkeeping can never leave a claim
 *  stuck for the full staleness window. Best-effort: a failure here
 *  only delays the next dispatch until the claim goes stale, it never
 *  masks whatever real result/error preceded it. */
async function releaseAiProcessingClaim(db: SupabaseClient, conversationId: string): Promise<void> {
  try {
    const { error } = await db.from('conversations').update({ ai_processing_started_at: null }).eq('id', conversationId)
    if (error) console.error('[ai auto-reply] failed to release AI processing claim:', error.message)
  } catch (err) {
    console.error('[ai auto-reply] failed to release AI processing claim:', err)
  }
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
 *   - another dispatch is already processing this conversation (H-6) —
 *     safe to bail: see `processOneTurn`'s drain loop for why the
 *     message that triggered THIS dispatch is still guaranteed to be
 *     answered by whichever dispatch holds the claim.
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

    // H-6 — claim exclusive right to process THIS conversation's AI
    // reply before doing any work. A second, concurrent dispatch for
    // the same conversation fails this and returns silently; the drain
    // loop below guarantees the message it was triggered by still gets
    // answered by whichever dispatch holds the claim.
    const claimed = await claimAiProcessing(db, conversationId, accountId)
    if (!claimed) return

    try {
      let iterations = 0
      while (true) {
        iterations++
        const lastSeenMessageId = await latestCustomerMessageId(db, conversationId)
        const turn = await processOneTurn({ db, config, accountId, conversationId, contactId, configOwnerUserId })
        if (!turn.continueDraining) return // handoff, error, or genuine ineligibility — stop, do not loop

        if (iterations >= MAX_DRAIN_ITERATIONS) {
          // Safety cap reached — yield to the next webhook delivery
          // rather than draining forever. Releasing (not leaving the
          // claim held) lets that next dispatch — or a retry of this
          // one — pick up immediately instead of waiting out the
          // staleness window.
          return
        }

        const { released } = await releaseOrContinueAiProcessing(db, conversationId, lastSeenMessageId)
        if (released) return // nothing newer arrived while we were busy — done
        // else: a newer customer message exists — loop back and answer it,
        // still holding the same claim.
      }
    } finally {
      // Safety net — guarantees the claim is never left held past this
      // dispatch's own return, regardless of which path above returned.
      await releaseAiProcessingClaim(db, conversationId)
    }
  } catch (err) {
    console.error('[ai auto-reply] dispatch failed:', err)
  }
}

/**
 * Processes exactly one turn: builds context AS OF RIGHT NOW (never
 * reused across drain-loop iterations — a prior iteration may have just
 * changed `ai_catalog_context` or the reply count), generates a reply,
 * and sends it or hands off. Returns `continueDraining: true` ONLY on
 * the path where a reply was actually generated and sent — every other
 * exit (ineligible, nothing to answer, handoff, provider error, lost
 * the reply-slot race) returns false so the caller stops without
 * looping. This is the exact body `dispatchInboundToAiReply` used to
 * run once per invocation before H-6 — unchanged in substance, only
 * extracted so it can run inside the H-6 drain loop.
 */
async function processOneTurn(ctx: {
  db: SupabaseClient
  config: AiConfig
  accountId: string
  conversationId: string
  contactId: string
  configOwnerUserId: string
}): Promise<{ continueDraining: boolean }> {
  const { db, config, accountId, conversationId, contactId, configOwnerUserId } = ctx

  // Re-read fresh on every turn (including the first) — a human could
  // take the thread, or turn auto-reply off for it, at any point,
  // including mid-drain-loop; this must never be answered from a stale
  // snapshot from before the claim was acquired.
  const { data: conv, error: convErr } = await db
    .from('conversations')
    .select('assigned_agent_id, ai_autoreply_disabled, ai_reply_count')
    .eq('id', conversationId)
    .maybeSingle()
  if (convErr || !conv) return { continueDraining: false }
  const convState = conv as ConversationGateState

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
  if (convState.assigned_agent_id) return { continueDraining: false } // a human owns this thread
  if (convState.ai_autoreply_disabled) return { continueDraining: false } // handed off / turned off here
  // Cheap early-out; the authoritative cap check is the atomic claim
  // below (this read can race a concurrent inbound — bounded by
  // claim_ai_reply_slot's own atomicity, unrelated to H-6's claim).
  if (convState.ai_reply_count >= config.autoReplyMaxPerConversation) return { continueDraining: false }

  const messages = await buildConversationContext(db, conversationId)
  if (messages.length === 0) return { continueDraining: false }

  // Account-wide throttle on the shared BYO key. The per-conversation
  // cap bounds one thread; this bounds a burst across many threads (a
  // marketing blast landing 200 replies at once) so we never run the
  // owner's key past the provider's rate limit. Checked per TURN (not
  // once per dispatch invocation) so the H-6 drain loop can't bypass it
  // by answering several messages in one dispatch. Over the limit →
  // skip the auto-reply; the inbound still sits in the inbox for a
  // human.
  const acctLimit = checkRateLimit(
    `ai-autoreply:${accountId}`,
    RATE_LIMITS.aiAutoReplyAccount,
  )
  if (!acctLimit.success) {
    console.warn(
      `[ai auto-reply] account ${accountId} hit the per-account rate limit — skipping this inbound.`,
    )
    return { continueDraining: false }
  }

  // One resolver resolution shared by every catalog call this turn
  // makes (the availability check below + every tool invocation
  // inside the generateReply() call after it) — AI optimization
  // project, FASE 3. Scoped to this one dispatch only: a plain object
  // living in this function's closure, never persisted or shared
  // across turns/accounts. See catalog/resolver.ts's ResolverCache doc.
  const resolverCache = createResolverCache()

  // What's ACTUALLY available for this account — independent of
  // whether this particular turn needs it. Checked in parallel: both
  // are cheap/cached (FASE 3/4) and neither depends on the other.
  const [catalogAvailable, knowledgeAvailable] = await Promise.all([
    hasActiveCatalogSources(db, accountId, resolverCache),
    accountHasKnowledgeBase(db, accountId),
  ])

  // Routing (FASE 5) — decides, from the message text plus what's
  // actually available, whether THIS turn probably needs catalog,
  // Knowledge, both, or neither. Pure/local: no model call, no
  // network. Conservative by construction (see routing.ts): any real
  // doubt resolves to attaching everything that's available, never to
  // silently dropping a resource the customer's question needed.
  const latestMessage = latestUserMessage(messages)
  const routing = routeAiContext({
    message: latestMessage,
    hasCatalog: catalogAvailable,
    hasKnowledge: knowledgeAvailable,
    catalogContextActive: Boolean(previousCatalogContext?.products.length),
  })

  // Ground the reply in the account's knowledge base — but only when
  // routing actually decided this turn needs it. Skipping the call
  // entirely (not just skipping its result) is the actual saving:
  // no embed API call, no semantic/lexical RPCs, for a turn that was
  // never going to use them.
  const knowledge = routing.useKnowledge
    ? await retrieveKnowledge(db, accountId, config, latestMessage)
    : []

  // Business Profile (AI optimization project, FASE 6) — structured
  // identity/contact/hours/delivery/payment/policy info + the
  // department/contact directory. Shares routing's existing
  // `useKnowledge` gate rather than adding a fifth retrieval path:
  // Business Profile answers exactly the same class of question
  // (horario, ubicación, delivery, pagos, "¿quién atiende créditos?")
  // routing.ts's own Knowledge vocabulary already recognizes — see
  // Parte 17 of the FASE 6 authorization. `null` (never fetched) for
  // a turn routing decided doesn't need it; reused below on the
  // handoff path instead of a second fetch when it WAS already
  // loaded this turn.
  let businessProfile: BusinessProfileForAgent | null = routing.useKnowledge
    ? await loadBusinessProfileForAgent(db, accountId)
    : null
  const businessProfileContext = businessProfile
    ? buildBusinessProfileContext(businessProfile.profile, businessProfile.departments, businessProfile.contacts)
    : null

  // Catalog tools (search_catalog/get_product/get_availability/
  // get_product_media) are attached ONLY when routing decided this
  // turn needs catalog AND the account actually has an active source
  // — an account with nothing configured, or a turn routing decided
  // doesn't need it, gets no `tools` field on the wire at all. See
  // docs/integrations/ai-data-integration/01_MASTER_EXECUTION.md.
  const tools = routing.useCatalog ? CATALOG_TOOL_SPECS : undefined
  const executeTool: ToolExecutor | undefined = routing.useCatalog
    ? wrapWithMediaSideEffect(executeCatalogTool(db, accountId, resolverCache), {
        accountId,
        userId: configOwnerUserId,
        conversationId,
        contactId,
      })
    : undefined

  // Same gate for the cross-turn catalog-context prompt block — it
  // instructs the model to re-call catalog tools before confirming
  // anything, which is meaningless (and would bloat the prompt for
  // nothing) on a turn that doesn't have those tools attached.
  const catalogContextText = routing.useCatalog ? catalogContextToPromptText(previousCatalogContext) : null
  const systemPromptArgs = {
    userPrompt: config.systemPrompt,
    mode: 'auto_reply' as const,
    knowledge,
    // FASE 9 — this was the one buildSystemPrompt() call missing
    // timeContext: draft and playground already passed it, so what
    // got tested there was never quite what the live bot actually
    // sent. Same helper, same "no date/time awareness" behavior for
    // any account that doesn't need it — this only adds the block.
    timeContext: getSystemTimeContext(),
    catalogToolsAvailable: routing.useCatalog,
    catalogContextText,
    businessProfileContext,
    agentBehavior: config.agentBehavior,
  }
  const systemPrompt = buildSystemPrompt(systemPromptArgs)
  // Anthropic-only prompt caching (AI optimization project, FASE 8) —
  // same underlying content as `systemPrompt` above, just split by
  // cacheability; OpenAI/OpenRouter never read this field (see
  // providers/shared.ts). Cheap to always compute (pure string work,
  // no I/O) so this call site stays provider-agnostic rather than
  // branching on config.provider.
  const systemPromptBlocks = buildSystemPromptBlocks(systemPromptArgs)

  // Deterministic hand-off-to-human, reused for two different reasons:
  // (a) the model itself decided to hand off ([[HANDOFF]] or empty
  // text — see the `handoff || !text` branch below), and (b) F2 —
  // `generateReply` throwing (AiError from a timeout/rate-limit/
  // malformed response/network failure) must NOT leave the customer's
  // message silently unanswered with no signal to a human either.
  // Both reasons resolve department/contact/summary identically; only
  // the summary text differs, so a human can tell "the bot chose to
  // hand off" apart from "the bot never got a reply because the
  // provider failed". Extracting this (rather than duplicating the
  // block) means there is exactly one place that writes the pending/
  // handoff shape — the two call sites can't drift apart.
  async function handOffToHuman(summaryOverride?: string) {
    businessProfile ??= await loadBusinessProfileForAgent(db, accountId)
    const intent = detectHandoffIntent(latestMessage, businessProfile.departments, businessProfile.contacts)
    const intentNote = describeHandoffIntent(intent)

    const summary = summaryOverride ?? buildHandoffSummary({
      messages,
      replyCount: convState.ai_reply_count ?? 0,
    })
    const update: Record<string, unknown> = {
      ai_autoreply_disabled: true,
      ai_handoff_summary: intentNote ? `${summary} ${intentNote}` : summary,
      status: 'pending',
      ai_handoff_department_id: intent.department?.id ?? null,
      ai_handoff_contact_id: intent.contact?.id ?? null,
    }
    // Only set the assignee when a target is configured AND the thread
    // isn't already owned — never stomp an existing human assignment.
    // A contact's OWN optional linked_user_id (migration 050) is the
    // most specific match and wins over the account's generic default
    // handoff agent when both are available.
    //
    // Punto 9, H9-1 — last line of defense: both candidates are
    // re-verified as members of THIS account right before they're ever
    // written to assigned_agent_id, even though each is already
    // validated at save time (contacts route / ai_configs route, see
    // service.ts's isAccountMember doc). This also self-heals the case
    // those save-time checks can't catch — a linked contact or a
    // configured handoff agent who was a valid member when saved but has
    // since been removed from the account. Never assigns a candidate
    // that fails the check; falls through to the next one, or to the
    // shared queue (assigned_agent_id left as-is / null) if none pass —
    // never a guess, never a cross-tenant write.
    let resolvedAssignee: string | null = null
    const contactCandidate = intent.contact?.linkedUserId ?? null
    if (contactCandidate && (await isAccountMember(db, accountId, contactCandidate))) {
      resolvedAssignee = contactCandidate
    } else {
      const configCandidate = config.handoffAgentId ?? null
      if (configCandidate && (await isAccountMember(db, accountId, configCandidate))) {
        resolvedAssignee = configCandidate
      }
    }
    if (resolvedAssignee && !convState.assigned_agent_id) {
      update.assigned_agent_id = resolvedAssignee
    }
    await db.from('conversations').update(update).eq('id', conversationId)
  }

  const generateStartedAt = Date.now()
  let generated: Awaited<ReturnType<typeof generateReply>>
  try {
    generated = await generateReply({
      config,
      systemPrompt,
      systemPromptBlocks,
      messages,
      tools,
      executeTool,
    })
  } catch (err) {
    // F2 — a provider failure (timeout, rate limit, invalid key,
    // malformed response, network error — anything generateReply
    // throws as AiError, or an unexpected exception) must never leave
    // this inbound silently unanswered: no bot reply, but also no
    // human ever notified. Never invent a substitute reply here — a
    // fabricated "sorry, try again" would itself be an ungrounded
    // model-less guess, exactly what this whole pipeline exists to
    // avoid. Escalate to a human instead, via the exact same
    // deterministic route a model-requested handoff already uses.
    console.error('[ai auto-reply] generateReply failed — handing off to a human instead of leaving the inbound unanswered:', err)
    // Punto 8, H8-2 — a failed attempt gets exactly one row too (never
    // duplicated: this is the ONLY logAiUsage call on this path, and the
    // success path below is unreachable once we're here). `usage` is
    // necessarily null — the provider never returned one — so every
    // token column is written as NULL, never a misleading 0.
    const failure = classifyGenerateFailure(err)
    void logAiUsage(db, {
      accountId,
      conversationId,
      mode: 'auto_reply',
      provider: config.provider,
      model: config.model,
      usage: null,
      latencyMs: Date.now() - generateStartedAt,
      errorCode: failure.code,
      errorMessage: failure.message,
    })
    try {
      await handOffToHuman(
        '🤖 The AI agent could not generate a reply (provider error) — a human needs to take over this conversation.',
      )
    } catch (handoffErr) {
      // The fallback itself failed (e.g. DB unreachable) — log it
      // distinctly so this doesn't read as the same original error.
      console.error('[ai auto-reply] handoff fallback after a provider failure ALSO failed:', handoffErr)
    }
    return { continueDraining: false }
  }
  const { text, handoff, usage, toolCalls, finishReason, toolTurnsExhausted } = generated
  const latencyMs = Date.now() - generateStartedAt

  // Fold this turn's tool results into the cross-turn catalog context
  // (AI_Catalog_Fix_Kit FASE 5/6/9) so a later short follow-up like
  // "¿y el morado?" can resolve the right product even though the
  // tool-calling loop's own tool_calls are otherwise ephemeral. Only
  // written when there's actually something NEW this turn resolved —
  // best-effort for the same reason as the read above. Routing (FASE
  // 5) means "catalog tools attached but the model made zero calls" is
  // now a common, expected case (a turn routed to catalog only
  // because of stale context, where the model just answered from the
  // conversation) — re-writing the exact same previousCatalogContext
  // back unchanged would be a wasted query, not a correction, so this
  // no longer fires on "there's old context to preserve" alone.
  if (toolCalls.length > 0) {
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

  // Budun observability (migration 052, FASE 12) — derived AFTER the
  // fact from this turn's own toolCalls, never a new query or a
  // second look at the resolver's internals. See
  // usage.ts::deriveCatalogExternalFlags's doc.
  const { catalogExternalUsed, catalogExternalBlocked } = deriveCatalogExternalFlags(toolCalls)

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
    toolCallCount: toolCalls.length,
    catalogAttached: routing.useCatalog,
    catalogUsed: toolCalls.length > 0,
    knowledgeRetrieved: knowledge.length > 0,
    knowledgeChars: knowledge.reduce((sum, chunk) => sum + chunk.length, 0),
    catalogContextChars: catalogContextText?.length,
    routingDecision: routing.decision,
    // True only when Knowledge genuinely existed for this account AND
    // routing chose not to use it — distinct from knowledgeRetrieved:
    // false, which can also mean Knowledge was attempted and simply
    // found nothing relevant.
    knowledgeSkippedByRouting: knowledgeAvailable && !routing.useKnowledge,
    latencyMs,
    catalogExternalUsed,
    catalogExternalBlocked,
    finishReason,
    toolTurnsExhausted,
  })

  if (handoff || !text) {
    // The model can't (or shouldn't) answer — stop auto-replying on
    // this thread and hand it to a human. We (a) pause the bot here
    // (sticky until re-enabled), (b) mark the conversation 'pending'
    // — the CRM's own existing status for "needs human attention"
    // (see the amber "Pending" filter already in the inbox; this is
    // the reused mechanism FASE 6's audit found, not a new one), (c)
    // route to a resolved handoff agent when one exists — null leaves
    // it in the shared queue — and (d) leave an internal note so
    // whoever picks it up has context. Assigning fires the existing
    // `on_conversation_assigned` trigger, which notifies the agent —
    // reused as-is, no second notification system.
    //
    // WHO the customer asked for is resolved here, deterministically,
    // against this account's REAL configured departments/contacts —
    // never something the model decided (see business-profile/
    // handoff-intent.ts's module doc). Reuses this turn's own
    // Business Profile load when routing already fetched it; a turn
    // that skipped Knowledge (so never loaded it) fetches it now,
    // ONLY on this comparatively rare path. See handOffToHuman above.
    //
    // H-6: handoff always stops the drain loop — the bot must not keep
    // answering after deciding a human should take over, even if a
    // newer message technically exists.
    await handOffToHuman()
    return { continueDraining: false }
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
    return { continueDraining: false }
  }
  if (claimed !== true) return { continueDraining: false } // lost the per-conversation cap race

  try {
    await engineSendText({
      accountId,
      userId: configOwnerUserId,
      conversationId,
      contactId,
      text,
      aiGenerated: true,
    })
  } catch (err) {
    // Punto 10, F-P10-4 — engineSendText only throws AFTER Meta already
    // accepted the send, when the subsequent messages.insert() fails —
    // meaning the customer may have received this reply while the CRM
    // has no record of it, and the reply-slot claimed above is spent
    // either way (no compensating decrement exists — a residual,
    // deliberately accepted limitation, not fixed here per this
    // phase's own minimal-scope authorization). Left unhandled, this
    // would silently strand the conversation with no record, no
    // assignment, and no notification. Escalate to a human via the
    // exact same deterministic route a generation failure (F2) already
    // uses, rather than inventing a new fallback shape.
    console.error(
      '[ai auto-reply] engineSendText failed after claiming a reply slot — handing off to a human:',
      err,
    )
    try {
      await handOffToHuman(
        '🤖 The AI agent may have sent a reply but could not record it — a human should verify this conversation.',
      )
    } catch (handoffErr) {
      console.error('[ai auto-reply] handoff fallback after a send failure ALSO failed:', handoffErr)
    }
    return { continueDraining: false }
  }

  return { continueDraining: true }
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
