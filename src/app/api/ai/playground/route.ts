import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadAiConfig } from '@/lib/ai/config'
import { retrieveKnowledge } from '@/lib/ai/knowledge'
import { generateReply } from '@/lib/ai/generate'
import { buildSystemPrompt } from '@/lib/ai/defaults'
import { latestUserMessage } from '@/lib/ai/query'
import { loadAiTools } from '@/lib/ai/tools/config'
import { AiError, type ChatMessage } from '@/lib/ai/types'

// Keep the tested transcript bounded, mirroring the live context window.
const MAX_TURNS = 20

/**
 * POST /api/ai/playground  (agent+)
 *
 * Test-chat with the account's agent WITHOUT touching WhatsApp. Runs the
 * exact same path the auto-reply bot uses — knowledge-base retrieval,
 * configured tools, `auto_reply` system prompt, and the configured
 * provider — so what you see here (including any tool calls the model
 * makes) is what a real customer would get. Reads the config even when
 * the master switch is off (requireActive:false) so you can try it
 * before going live. Stateless: the client sends the running transcript
 * each turn; tool calls made during the turn are returned in the
 * response but not persisted anywhere (nothing to replay them from on
 * the next turn, unlike the inbox where they land as message rows).
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
      config.knowledgeTopK,
    )
    const { systemPrompt, knowledgeBlock } = buildSystemPrompt({
      userPrompt: config.systemPrompt,
      mode: 'auto_reply',
      knowledge,
      handoffSensitivity: config.handoffSensitivity,
    })

    // Deliberately NOT gated by RATE_LIMITS.aiToolCall — that bucket is
    // per-account and shared with the real auto-reply path, so it exists
    // to protect the account's live integrations from a stampede of
    // REAL customer traffic. Gating Playground testing behind the same
    // bucket meant active testing silently starved real customers of
    // tool access moments later (issue found in production testing —
    // "works in Playground, not on WhatsApp", because Playground WAS the
    // traffic spending the shared budget). The per-user `aiDraft` limit
    // above (20/min) already bounds testing.
    const tools = await loadAiTools(supabase, accountId).catch((err) => {
      console.error('[ai/playground] loadAiTools error:', err)
      return []
    })

    const { text, handoff, toolCalls } = await generateReply({
      config,
      systemPrompt,
      knowledgeBlock,
      messages,
      tools,
    }).catch((err) => {
      console.error('[ai/playground] generateReply failed:', err)
      throw err
    })
    return NextResponse.json({
      reply: text,
      handoff,
      tool_calls: (toolCalls ?? []).map((c) => ({
        tool_name: c.toolName,
        args: c.args,
        ok: c.result.ok,
        status: c.result.status,
        body: c.result.body,
        error: c.result.error,
        duration_ms: c.result.durationMs,
      })),
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
