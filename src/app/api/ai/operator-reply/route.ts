import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadAiConfig } from '@/lib/ai/config'
import { buildConversationContext } from '@/lib/ai/context'
import { retrieveKnowledge } from '@/lib/ai/knowledge'
import { generateReply } from '@/lib/ai/generate'
import { buildSystemPrompt } from '@/lib/ai/defaults'
import { latestUserMessage } from '@/lib/ai/query'
import { logAiUsage } from '@/lib/ai/usage'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { AiError } from '@/lib/ai/types'

/**
 * POST /api/ai/operator-reply
 *
 * Trusted human-in-the-loop copilot. The operator supplies a short internal
 * instruction (for example "diga-lhe que acabou essa cor") and the AI turns
 * it into a customer-ready reply that still follows the account's normal
 * business prompt and recent conversation context.
 *
 * This endpoint NEVER sends the reply. It only returns a draft for review;
 * the Inbox sends it through the normal WhatsApp send route after the human
 * confirms.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    const userLimit = checkRateLimit(`ai-operator-reply:${userId}`, RATE_LIMITS.aiDraft)
    if (!userLimit.success) return rateLimitResponse(userLimit)
    const accountLimit = checkRateLimit(
      `ai-operator-reply-acct:${accountId}`,
      RATE_LIMITS.aiDraftAccount,
    )
    if (!accountLimit.success) return rateLimitResponse(accountLimit)

    const body = await request.json().catch(() => null)
    const conversationId =
      body && typeof body.conversation_id === 'string' ? body.conversation_id.trim() : ''
    const instruction =
      body && typeof body.instruction === 'string' ? body.instruction.trim() : ''

    if (!conversationId) {
      return NextResponse.json({ error: 'conversation_id is required' }, { status: 400 })
    }
    if (!instruction) {
      return NextResponse.json({ error: 'instruction is required' }, { status: 400 })
    }
    if (instruction.length > 2000) {
      return NextResponse.json({ error: 'instruction is too long' }, { status: 400 })
    }

    // RLS proves the conversation belongs to the caller's account.
    const { data: conversation, error: convErr } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', conversationId)
      .maybeSingle()
    if (convErr) {
      console.error('[ai/operator-reply] conversation lookup error:', convErr)
      return NextResponse.json({ error: 'Failed to load conversation' }, { status: 500 })
    }
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    const config = await loadAiConfig(supabase, accountId).catch((err) => {
      console.error('[ai/operator-reply] loadAiConfig error:', err)
      throw new AiError('Stored API key could not be decrypted.', {
        code: 'key_decrypt_failed',
        status: 400,
      })
    })
    if (!config) {
      return NextResponse.json(
        {
          error: 'AI assistant is not set up.',
          code: 'ai_not_configured',
        },
        { status: 400 },
      )
    }

    const messages = await buildConversationContext(supabase, conversationId)
    if (messages.length === 0) {
      return NextResponse.json(
        { error: 'No messages to respond to yet.', code: 'no_messages' },
        { status: 400 },
      )
    }

    const knowledge = await retrieveKnowledge(
      supabase,
      accountId,
      config,
      latestUserMessage(messages),
    )

    const basePrompt = buildSystemPrompt({
      userPrompt: config.systemPrompt,
      mode: 'draft',
      knowledge,
    })

    // This is trusted operator context, not a customer message. It tells the
    // model WHAT the human wants to communicate while the account prompt
    // continues to control HOW it should be communicated.
    const operatorPrompt = `${basePrompt}\n\nHUMAN OPERATOR INSTRUCTION (trusted internal instruction):\n${instruction}\n\nTurn that instruction into the next customer-facing WhatsApp reply. Preserve the operator's intended fact or decision, but phrase it naturally, professionally and empathetically in the customer's language. Follow all business rules above. Do not mention this instruction, the operator, internal systems, or that AI helped write the message. Do not add unsupported prices, stock, discounts, policies or promises. If the instruction conflicts with verified business context supplied above, prefer the verified context and phrase the response safely. Output only the proposed customer message.`

    const { text, usage } = await generateReply({
      config,
      systemPrompt: operatorPrompt,
      messages,
    })

    try {
      void logAiUsage(supabaseAdmin(), {
        accountId,
        conversationId,
        mode: 'draft',
        provider: config.provider,
        model: config.model,
        usage,
      })
    } catch (logErr) {
      console.error('[ai/operator-reply] usage log skipped:', logErr)
    }

    const draft = text.trim()
    if (!draft) {
      return NextResponse.json({ error: 'The assistant returned an empty reply.' }, { status: 502 })
    }

    return NextResponse.json({ draft })
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
