import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadAiConfig } from '@/lib/ai/config'
import { buildConversationContext } from '@/lib/ai/context'
import { retrieveKnowledge, accountHasKnowledgeBase } from '@/lib/ai/knowledge'
import { loadBusinessProfileForAgent } from '@/lib/ai/business-profile/service'
import { buildBusinessProfileContext } from '@/lib/ai/business-profile/context'
import { generateReply } from '@/lib/ai/generate'
import { buildSystemPrompt, buildSystemPromptBlocks, getSystemTimeContext } from '@/lib/ai/defaults'
import { latestUserMessage } from '@/lib/ai/query'
import { routeAiContext } from '@/lib/ai/routing'
import { logAiUsage } from '@/lib/ai/usage'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { AiError } from '@/lib/ai/types'

/**
 * POST /api/ai/draft  (agent+)
 *
 * Body: { conversation_id }
 * Returns: { draft } — a suggested reply for the agent to edit + send.
 *
 * Uses the account's configured provider/key (BYO). Read-only: it never
 * sends or stores anything, just hands text back to the composer.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    const userLimit = checkRateLimit(`ai-draft:${userId}`, RATE_LIMITS.aiDraft)
    if (!userLimit.success) return rateLimitResponse(userLimit)
    // Also cap the whole team's draws on the shared BYO provider key.
    const accountLimit = checkRateLimit(
      `ai-draft-acct:${accountId}`,
      RATE_LIMITS.aiDraftAccount,
    )
    if (!accountLimit.success) return rateLimitResponse(accountLimit)

    const body = await request.json().catch(() => null)
    const conversationId =
      body && typeof body.conversation_id === 'string' ? body.conversation_id : ''
    if (!conversationId) {
      return NextResponse.json(
        { error: 'conversation_id is required' },
        { status: 400 },
      )
    }

    // RLS scopes the SSR client to the caller's account, so a missing
    // row means "not yours / not found" either way.
    const { data: conversation, error: convErr } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', conversationId)
      .maybeSingle()
    if (convErr) {
      console.error('[ai/draft] conversation lookup error:', convErr)
      return NextResponse.json({ error: 'Failed to load conversation' }, { status: 500 })
    }
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    const config = await loadAiConfig(supabase, accountId).catch((err) => {
      // Decrypt failure — surface distinctly from "not configured".
      console.error('[ai/draft] loadAiConfig error:', err)
      throw new AiError('Stored API key could not be decrypted.', {
        code: 'key_decrypt_failed',
        status: 400,
      })
    })
    if (!config) {
      return NextResponse.json(
        {
          error: 'AI assistant is not set up. Enable it in Settings → AI Assistant.',
          code: 'ai_not_configured',
        },
        { status: 400 },
      )
    }

    const messages = await buildConversationContext(supabase, conversationId)
    // Nothing to draft from — a brand-new thread with no customer text
    // would otherwise produce a nonsensical reply-to-nothing.
    if (messages.length === 0) {
      return NextResponse.json(
        {
          error: 'No messages to draft from yet.',
          code: 'no_messages',
        },
        { status: 400 },
      )
    }

    // Routing (FASE 5) — this route has no catalog capability at all
    // (hasCatalog: false, always — see the FASE 10 note below), so its
    // only real question is whether THIS message needs Knowledge.
    // Conservative by construction (routing.ts): anything not a clear
    // greeting/ack, or with no signal either way, still resolves to
    // "use Knowledge" — draft has nothing else to fall back on, so
    // "in doubt → include the one resource this route has" applies.
    const latestMessage = latestUserMessage(messages)
    const knowledgeAvailable = await accountHasKnowledgeBase(supabase, accountId)
    const routing = routeAiContext({
      message: latestMessage,
      hasCatalog: false,
      hasKnowledge: knowledgeAvailable,
    })

    // Ground the draft in the account's knowledge base — only when
    // routing decided this message needs it (best-effort either way:
    // returns [] when there's no KB or retrieval fails).
    const knowledge = routing.useKnowledge
      ? await retrieveKnowledge(supabase, accountId, config, latestMessage)
      : []

    // Business Profile (FASE 6) — piggybacks on the same routing gate as
    // Knowledge (see routing.ts's rationale): the class of question it
    // answers (horario, dirección, delivery, pagos, contacto) is exactly
    // what already routes to useKnowledge, so this never becomes a
    // separate "fifth route". No handoff-intent detection here — draft
    // mode never emits [[HANDOFF]] (it hands text back to an agent to
    // edit, it never auto-sends or auto-transitions the conversation).
    const businessProfile = routing.useKnowledge
      ? await loadBusinessProfileForAgent(supabase, accountId)
      : null
    const businessProfileContext = businessProfile
      ? buildBusinessProfileContext(businessProfile.profile, businessProfile.departments, businessProfile.contacts)
      : null

    const systemPromptArgs = {
      userPrompt: config.systemPrompt,
      mode: 'draft' as const,
      knowledge,
      businessProfileContext,
      timeContext: getSystemTimeContext(),
    }
    const systemPrompt = buildSystemPrompt(systemPromptArgs)
    // Anthropic-only prompt caching (FASE 8) — see auto-reply.ts's
    // identical comment; OpenAI/OpenRouter never read this field.
    const systemPromptBlocks = buildSystemPromptBlocks(systemPromptArgs)

    const generateStartedAt = Date.now()
    const { text, usage } = await generateReply({ config, systemPrompt, systemPromptBlocks, messages })
    const latencyMs = Date.now() - generateStartedAt

    // Record spend on the account's BYO key. Best-effort + via the
    // service role (the log has no `authenticated` INSERT policy). This
    // must not fail or delay the draft the agent is waiting on, so:
    //  - the whole thing is wrapped (constructing the admin client throws
    //    if the service-role key is unset — that must not 500 the draft);
    //  - it's fire-and-forget (`void`), not awaited, so the response
    //    isn't held for a DB round-trip.
    try {
      void logAiUsage(supabaseAdmin(), {
        accountId,
        conversationId,
        mode: 'draft',
        provider: config.provider,
        model: config.model,
        usage,
        // No catalog tools on this route today (see FASE 10 — a
        // deliberate, documented decision, not an oversight) — logged
        // explicitly as false/0 rather than omitted, so a report can
        // tell "draft never had catalog" apart from "unknown".
        toolCallCount: 0,
        catalogAttached: false,
        catalogUsed: false,
        knowledgeRetrieved: knowledge.length > 0,
        knowledgeChars: knowledge.reduce((sum, chunk) => sum + chunk.length, 0),
        routingDecision: routing.decision,
        knowledgeSkippedByRouting: knowledgeAvailable && !routing.useKnowledge,
        latencyMs,
      })
    } catch (logErr) {
      console.error('[ai/draft] usage log skipped:', logErr)
    }

    return NextResponse.json({ draft: text })
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status },
      )
    }
    return toErrorResponse(err)
  }
}
