import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadAiConfig } from '@/lib/ai/config'
import { retrieveKnowledge } from '@/lib/ai/knowledge'
import { generateReply } from '@/lib/ai/generate'
import { buildSystemPrompt, getSystemTimeContext } from '@/lib/ai/defaults'
import { latestUserMessage } from '@/lib/ai/query'
import { AiError, type ChatMessage } from '@/lib/ai/types'
import { hasActiveCatalogSources } from '@/lib/ai/catalog/resolver'
import { CATALOG_TOOL_SPECS, executeCatalogTool } from '@/lib/ai/tools/catalog-tools'

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

    const knowledge = await retrieveKnowledge(
      supabase,
      accountId,
      config,
      latestUserMessage(messages),
    )

    // Same tool wiring as auto-reply (src/lib/ai/auto-reply.ts) MINUS
    // the WhatsApp media side-effect — the Playground never sends a
    // real message, so it calls the shared catalog executor directly.
    // "El Playground de WACRM funciona con datos reales de prueba" is
    // exactly this: an admin can verify product/price/color/variant/
    // stock/photo answers before turning auto-reply on, without
    // messaging a real customer.
    const catalogAvailable = await hasActiveCatalogSources(supabase, accountId)
    const tools = catalogAvailable ? CATALOG_TOOL_SPECS : undefined
    const executeTool = catalogAvailable ? executeCatalogTool(supabase, accountId) : undefined

    const systemPrompt = buildSystemPrompt({
      userPrompt: config.systemPrompt,
      mode: 'auto_reply',
      knowledge,
      timeContext: getSystemTimeContext(),
      catalogToolsAvailable: catalogAvailable,
    })

    const { text, handoff, toolCalls } = await generateReply({
      config,
      systemPrompt,
      messages,
      tools,
      executeTool,
    })

    // Surface any product photo a get_product_media call resolved so
    // the Playground UI can show "📷 image would be sent here" instead
    // of silently swallowing it — the Playground itself never calls
    // engineSendMedia (see the comment above).
    const media = toolCalls
      .filter((c) => c.name === 'get_product_media' && c.result && typeof c.result === 'object' && !('error' in (c.result as object)))
      .map((c) => (c.result as { primaryImage?: { url: string; alt?: string } | null }).primaryImage)
      .filter((img): img is { url: string; alt?: string } => !!img)

    return NextResponse.json({
      reply: text,
      handoff,
      knowledge_count: knowledge.length,
      tool_calls: toolCalls.map((c) => ({ name: c.name, input: c.input })),
      media,
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
