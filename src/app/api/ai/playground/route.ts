import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadAiConfig } from '@/lib/ai/config'
import { retrieveKnowledge, accountHasKnowledgeBase } from '@/lib/ai/knowledge'
import { loadBusinessProfileForAgent } from '@/lib/ai/business-profile/service'
import { buildBusinessProfileContext } from '@/lib/ai/business-profile/context'
import { detectHandoffIntent, describeHandoffIntent } from '@/lib/ai/business-profile/handoff-intent'
import { generateReply } from '@/lib/ai/generate'
import { buildSystemPrompt, buildSystemPromptBlocks, getSystemTimeContext } from '@/lib/ai/defaults'
import { latestUserMessage } from '@/lib/ai/query'
import { routeAiContext } from '@/lib/ai/routing'
import { AiError, type ChatMessage } from '@/lib/ai/types'
import { createResolverCache, hasActiveCatalogSources } from '@/lib/ai/catalog/resolver'
import { CATALOG_TOOL_SPECS, executeCatalogTool } from '@/lib/ai/tools/catalog-tools'
import { catalogContextToPromptText, updateCatalogContext, type CatalogTurnContext } from '@/lib/ai/catalog/context'

// Keep the tested transcript bounded, mirroring the live context window.
const MAX_TURNS = 20

/**
 * POST /api/ai/playground  (agent+)
 *
 * Test-chat with the account's agent WITHOUT touching WhatsApp. Runs the
 * exact same path the auto-reply bot uses — knowledge-base retrieval +
 * `auto_reply` system prompt + the configured provider — so what you see
 * here is what a real customer would get. Reads the config even when the
 * master switch is off (requireActive:false) so you can try it before
 * going live. Stateless: the client sends the running transcript each turn.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    const limit = checkRateLimit(`ai-playground:${userId}`, RATE_LIMITS.aiDraft)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const rawMessages = Array.isArray(body?.messages) ? body.messages : null
    if (!rawMessages) {
      return NextResponse.json({ error: 'messages is required' }, { status: 400 })
    }

    const messages: ChatMessage[] = rawMessages
      .filter(
        (m: unknown): m is ChatMessage =>
          !!m &&
          typeof m === 'object' &&
          ((m as ChatMessage).role === 'user' ||
            (m as ChatMessage).role === 'assistant') &&
          typeof (m as ChatMessage).content === 'string' &&
          (m as ChatMessage).content.trim().length > 0,
      )
      .slice(-MAX_TURNS)

    if (messages.length === 0) {
      return NextResponse.json(
        { error: 'Send a message to test the agent.' },
        { status: 400 },
      )
    }

    // The client resends this from the previous response (Playground has
    // no conversationId to persist against, unlike auto-reply which uses
    // conversations.ai_catalog_context) — closes the exact gap that
    // produced "showed a product one turn, then said no confirmed info
    // the next": tool results are otherwise ephemeral, discarded once
    // generateReply returns text.
    const incomingCatalogContext: CatalogTurnContext | null =
      body?.catalog_context && typeof body.catalog_context === 'object' ? body.catalog_context : null

    const config = await loadAiConfig(supabase, accountId, {
      requireActive: false,
    }).catch((err) => {
      console.error('[ai/playground] loadAiConfig error:', err)
      throw new AiError('Stored API key could not be decrypted.', {
        code: 'key_decrypt_failed',
        status: 400,
      })
    })
    if (!config) {
      return NextResponse.json(
        {
          error: 'No agent configured yet. Add your provider key in Setup.',
          code: 'ai_not_configured',
        },
        { status: 400 },
      )
    }

    // Same tool wiring as auto-reply (src/lib/ai/auto-reply.ts) MINUS
    // the WhatsApp media side-effect — the Playground never sends a
    // real message, so it calls the shared catalog executor directly.
    // "El Playground de WACRM funciona con datos reales de prueba" is
    // exactly this: an admin can verify product/price/color/variant/
    // stock/photo answers before turning auto-reply on, without
    // messaging a real customer.
    // One resolver resolution shared by hasActiveCatalogSources and
    // every tool call this turn makes (AI optimization project, FASE 3)
    // — scoped to this one request only, never persisted.
    const resolverCache = createResolverCache()
    const [catalogAvailable, knowledgeAvailable] = await Promise.all([
      hasActiveCatalogSources(supabase, accountId, resolverCache),
      accountHasKnowledgeBase(supabase, accountId),
    ])

    // Routing (FASE 5) — same decision auto-reply makes, run here too
    // so the Playground shows an admin exactly what a real customer
    // message would trigger (see `routing` in the response below).
    const latestMessage = latestUserMessage(messages)
    const routing = routeAiContext({
      message: latestMessage,
      hasCatalog: catalogAvailable,
      hasKnowledge: knowledgeAvailable,
      catalogContextActive: Boolean(incomingCatalogContext?.products.length),
    })

    const knowledge = routing.useKnowledge
      ? await retrieveKnowledge(supabase, accountId, config, latestMessage)
      : []

    // Business Profile (FASE 6) — same routing gate as Knowledge, same
    // rationale as auto-reply.ts/draft/route.ts: it answers the same
    // class of question the router already recognizes, so it never
    // becomes a separate route. Loaded once and reused below for
    // handoff-intent resolution if this turn ends up handing off, so a
    // real handoff test in the Playground shows an admin the same
    // department/contact match a live customer message would get.
    let businessProfile = routing.useKnowledge ? await loadBusinessProfileForAgent(supabase, accountId) : null
    const businessProfileContext = businessProfile
      ? buildBusinessProfileContext(businessProfile.profile, businessProfile.departments, businessProfile.contacts)
      : null

    const tools = routing.useCatalog ? CATALOG_TOOL_SPECS : undefined
    const executeTool = routing.useCatalog ? executeCatalogTool(supabase, accountId, resolverCache) : undefined

    const systemPromptArgs = {
      userPrompt: config.systemPrompt,
      mode: 'auto_reply' as const,
      knowledge,
      businessProfileContext,
      timeContext: getSystemTimeContext(),
      catalogToolsAvailable: routing.useCatalog,
      catalogContextText: routing.useCatalog ? catalogContextToPromptText(incomingCatalogContext) : null,
    }
    const systemPrompt = buildSystemPrompt(systemPromptArgs)
    // Anthropic-only prompt caching (FASE 8) — see auto-reply.ts's
    // identical comment; OpenAI/OpenRouter never read this field.
    const systemPromptBlocks = buildSystemPromptBlocks(systemPromptArgs)

    const { text, handoff, toolCalls } = await generateReply({
      config,
      systemPrompt,
      systemPromptBlocks,
      messages,
      tools,
      executeTool,
    })

    // Same deterministic, server-side resolution auto-reply.ts uses —
    // runs only on the (rare) handoff path, and only against THIS
    // account's real departments/contacts (never anything the model
    // named). Surfaced in the response purely for the admin's benefit;
    // the Playground never writes to a conversation.
    let handoffIntent: { type: string; department: string | null; contact: string | null; note: string | null } | null =
      null
    if (handoff) {
      businessProfile ??= await loadBusinessProfileForAgent(supabase, accountId)
      const intent = detectHandoffIntent(latestMessage, businessProfile.departments, businessProfile.contacts)
      handoffIntent = {
        type: intent.type,
        department: intent.department?.name ?? null,
        contact: intent.contact?.name ?? null,
        note: describeHandoffIntent(intent),
      }
    }

    // Surface any product photo a get_product_media call resolved so
    // the Playground UI can show "📷 image would be sent here" instead
    // of silently swallowing it — the Playground itself never calls
    // engineSendMedia (see the comment above).
    const media = toolCalls
      .filter((c) => c.name === 'get_product_media' && c.result && typeof c.result === 'object' && !('error' in (c.result as object)))
      .map((c) => (c.result as { primaryImage?: { url: string; alt?: string } | null }).primaryImage)
      .filter((img): img is { url: string; alt?: string } => !!img)

    const nextCatalogContext = routing.useCatalog
      ? updateCatalogContext(incomingCatalogContext, toolCalls)
      : incomingCatalogContext

    return NextResponse.json({
      reply: text,
      handoff,
      knowledge_count: knowledge.length,
      tool_calls: toolCalls.map((c) => ({ name: c.name, input: c.input })),
      media,
      // Lets an admin SEE the routing decision the request actually
      // made (FASE 5) — this is exactly what the Playground is for:
      // verifying agent behavior before turning auto-reply on.
      routing: {
        decision: routing.decision,
        used_catalog: routing.useCatalog,
        used_knowledge: routing.useKnowledge,
      },
      // Only present when this turn handed off (FASE 6) — lets an admin
      // verify department/contact resolution before relying on it live.
      handoff_intent: handoffIntent,
      // Opaque to the client — it must only store this and resend it
      // verbatim as `catalog_context` on the next request.
      catalog_context: nextCatalogContext,
    })
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
