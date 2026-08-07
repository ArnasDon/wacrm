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
import { createAutoReplyTools } from '@/lib/ai/tools'
import { loadAgentToolPermissions } from '@/lib/ai/tool-permissions'

const FACT_LOOKUP_RE =
  /\b(pre[cç]o|pre[cç]os|custa|custam|valor|stock|estoque|dispon[ií]vel|disponibilidade|cat[aá]logo|produto|modelo|tamanho|cor|cores|foto|imagem|entrega|taxa|pagamento|pagar|troca|devolu[cç][aã]o|hor[aá]rio|endere[cç]o|localiza[cç][aã]o|pol[ií]tica|reserva|promo[cç][aã]o|desconto|confirma|confirmar|verifica|verificar|consulta|consultar|procura|procurar)\b/i

const PURE_CONVERSATIONAL_RE =
  /\b(pergunta|pergunte|diz|diga|agradece|agrade[cç]a|desculpa|desculpe|cumprimenta|cumprimente|lembra|lembre|avisa|avise|responde|responda)\b/i

/**
 * Operator instructions are commands, not customer queries. Most are simple
 * conversational actions ("pergunta se ainda está interessado") and must not
 * trigger autonomous research just because the previous thread mentioned a
 * product. We only expose read-only tools when the instruction itself asks for
 * a business fact or explicitly asks us to verify/research something.
 */
function instructionNeedsFacts(instruction: string): boolean {
  if (FACT_LOOKUP_RE.test(instruction)) return true
  if (PURE_CONVERSATIONAL_RE.test(instruction)) return false
  return false
}

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

    // RLS proves the conversation belongs to the caller's account and gives
    // us the contact needed by the existing agent-tool executor.
    const { data: conversation, error: convErr } = await supabase
      .from('conversations')
      .select('id, contact_id')
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

    const needsFacts = instructionNeedsFacts(instruction)

    // Conversational operator commands do not need retrieval. This is
    // intentional: injecting unrelated KB/catalogue context can cause the
    // model to ignore a simple human instruction and continue the old topic.
    const knowledge = needsFacts
      ? await retrieveKnowledge(
          supabase,
          accountId,
          config,
          latestUserMessage(messages),
        )
      : []

    const basePrompt = buildSystemPrompt({
      userPrompt: config.systemPrompt,
      mode: 'draft',
      knowledge,
    })

    const operatorPrompt = `${basePrompt}\n\nHUMAN OPERATOR INSTRUCTION — HIGHEST PRIORITY FOR RESPONSE INTENT:\n${instruction}\n\nThe human operator is controlling this conversation. Your job is to transform the operator's instruction into the next polished customer-facing WhatsApp message.\n\nPRIORITY RULES:\n1. The operator decides WHAT should be communicated. You decide HOW to phrase it clearly, naturally, professionally and empathetically.\n2. Do not replace, reinterpret, expand or continue a previous sales task unless the operator's current instruction asks you to do so.\n3. Use the recent conversation only to understand references, tone and context. Do not let an earlier product topic override the current operator instruction.\n4. If the instruction is conversational, relational or stylistic — for example \"pergunta se ainda está interessado\", \"agradece\", \"pede desculpa\", \"diz que podemos ajudar\" — do NOT research the catalogue or knowledge base. Simply write the requested message.\n5. Only use an available read-only tool when the CURRENT operator instruction explicitly asks for, depends on, or asks you to verify a business fact such as price, stock, availability, catalogue information, delivery, payment or policy.\n6. Preserve factual decisions explicitly supplied by the human operator unless they conflict with verified system data required by the current instruction or would create a safety/security problem.\n7. Never mention the operator, this instruction, tools, internal systems or that AI helped write the reply.\n8. Do not add an extra question, offer, catalogue search, alternative product or sales step unless it helps fulfil the operator's stated intent.\n9. Output only the proposed customer-facing message.`

    const db = supabaseAdmin()
    let readOnlyTools: ReturnType<typeof createAutoReplyTools>['tools'] = []
    let executeTool: ReturnType<typeof createAutoReplyTools>['executeTool'] | undefined

    if (needsFacts && config.provider === 'openai') {
      const permissions = await loadAgentToolPermissions(
        db,
        accountId,
        config.agentId!,
      )
      const toolRuntime = createAutoReplyTools({
        db,
        accountId,
        conversationId,
        contactId: conversation.contact_id,
        configOwnerUserId: userId,
        config,
        permissions,
      })

      // Human copilot remains read-only. It may research the catalogue and
      // knowledge base, but cannot queue send_product or any other side effect.
      readOnlyTools = toolRuntime.tools.filter(
        (tool) => tool.name === 'search_catalog' || tool.name === 'search_knowledge',
      )
      executeTool = readOnlyTools.length > 0 ? toolRuntime.executeTool : undefined
    }

    console.info('[ai/operator-reply] generating draft:', {
      conversationId,
      needsFacts,
      tools: readOnlyTools.map((tool) => tool.name),
    })

    const { text, usage } = await generateReply({
      config,
      systemPrompt: operatorPrompt,
      messages,
      tools: readOnlyTools.length > 0 ? readOnlyTools : undefined,
      executeTool,
    })

    try {
      void logAiUsage(db, {
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
