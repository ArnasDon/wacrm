import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadAiConfig } from '@/lib/ai/config'
import { buildConversationContext } from '@/lib/ai/context'
import { createWhatsAppImageResolver } from '@/lib/ai/image-context'
import { retrieveKnowledge } from '@/lib/ai/knowledge'
import { generateReply } from '@/lib/ai/generate'
import { buildSystemPrompt } from '@/lib/ai/defaults'
import { logAiUsage } from '@/lib/ai/usage'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { AiError } from '@/lib/ai/types'
import { createAutoReplyTools } from '@/lib/ai/tools'
import { loadAgentToolPermissions } from '@/lib/ai/tool-permissions'

const FACT_LOOKUP_RE =
  /\b(pre[cç]o|pre[cç]os|custa|custam|valor|stock|estoque|dispon[ií]vel|disponibilidade|cat[aá]logo|produto|modelo|tamanho|cor|cores|foto|imagem|entrega|taxa|pagamento|pagar|troca|devolu[cç][aã]o|hor[aá]rio|endere[cç]o|localiza[cç][aã]o|pol[ií]tica|reserva|promo[cç][aã]o|desconto|confirma|confirmar|verifica|verificar|consulta|consultar|procura|procurar)\b/i

const PURE_CONVERSATIONAL_RE =
  /\b(pergunta|pergunte|diz|diga|agradece|agrade[cç]a|desculpa|desculpe|cumprimenta|cumprimente|lembra|lembre|avisa|avise|responde|responda)\b/i

function instructionNeedsFacts(instruction: string): boolean {
  if (PURE_CONVERSATIONAL_RE.test(instruction) && !FACT_LOOKUP_RE.test(instruction)) return false
  return FACT_LOOKUP_RE.test(instruction)
}

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
    const instruction = body && typeof body.instruction === 'string' ? body.instruction.trim() : ''

    if (!conversationId) {
      return NextResponse.json({ error: 'conversation_id is required' }, { status: 400 })
    }
    if (!instruction) {
      return NextResponse.json({ error: 'instruction is required' }, { status: 400 })
    }
    if (instruction.length > 2000) {
      return NextResponse.json({ error: 'instruction is too long' }, { status: 400 })
    }

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
        { error: 'AI assistant is not set up.', code: 'ai_not_configured' },
        { status: 400 },
      )
    }

    const messages = await buildConversationContext(supabase, conversationId, {
      resolveImage: createWhatsAppImageResolver(supabase, accountId),
    })
    if (messages.length === 0) {
      return NextResponse.json(
        { error: 'No messages to respond to yet.', code: 'no_messages' },
        { status: 400 },
      )
    }

    const needsFacts = instructionNeedsFacts(instruction)
    const knowledge = needsFacts
      ? await retrieveKnowledge(supabase, accountId, config, instruction)
      : []

    const basePrompt = buildSystemPrompt({
      userPrompt: config.systemPrompt,
      mode: 'draft',
      knowledge,
    })

    const operatorPrompt = `${basePrompt}\n\n=== MODO COPILOTO HUMANO ===\nA INSTRUÇÃO DO OPERADOR ABAIXO É A AUTORIDADE MÁXIMA SOBRE A INTENÇÃO DA PRÓXIMA RESPOSTA.\n\nINSTRUÇÃO ACTUAL DO OPERADOR:\n${instruction}\n\nTAREFA ÚNICA: transforma exactamente esta intenção numa mensagem pronta para ser enviada ao cliente. Corrige erros, melhora a clareza, naturalidade, educação, emoção e tom da marca, mas NÃO mudes o objectivo da instrução.\n\nREGRAS OBRIGATÓRIAS:\n1. Primeiro identifica a acção pedida pelo operador. A resposta final TEM de executar essa acção.\n2. O histórico da conversa é CONTEXTO PASSIVO. Usa-o somente para perceber referências como “ele”, “ela”, “essa cor”, “esse produto”, “ainda”, “isso” ou o tom apropriado.\n3. É PROIBIDO usar o histórico para escolher uma intenção diferente, retomar uma pergunta antiga, continuar uma venda anterior ou decidir sozinho o próximo passo.\n4. Se o operador disser “pergunta se ainda quer”, “pergunta se ainda está interessado” ou equivalente, limita-te a perguntar ao cliente se ainda está interessado. NÃO perguntes tamanho, cor, modelo, preço, preferência ou qualquer outra coisa, salvo se o operador o pedir.\n5. Se o operador disser “diga que acabou essa cor”, comunica apenas esse facto de forma adequada; não inventes stock, alternativas ou disponibilidade.\n6. Não acrescentes perguntas, ofertas, pesquisas, recomendações, catálogo, alternativas ou passos comerciais que não sejam necessários para cumprir a instrução actual.\n7. Só consulta ferramentas quando a PRÓPRIA INSTRUÇÃO ACTUAL exigir um facto do negócio que não tenha sido fornecido pelo operador. O simples facto de o histórico mencionar produtos NÃO autoriza pesquisa.\n8. Factos explicitamente fornecidos pelo operador devem ser preservados. Não os substituas por inferências do histórico.\n9. Nunca menciones operador, prompt, IA, ferramentas, base de dados, regras internas ou este modo.\n10. Não expliques o que fizeste. Devolve APENAS a mensagem destinada ao cliente.\n\nEXEMPLOS DE FIDELIDADE:\nOperador: “diga ele e ainda quer” -> Cliente: “Ainda está interessado? Se quiser, podemos continuar com o seu atendimento.”\nOperador: “pergunta se ainda quer a legging” -> Cliente: “Ainda está interessado na legging?”\nOperador: “diga que acabou essa cor” -> Cliente: “Essa cor já não está disponível neste momento.”\nOperador: “agradece e diz que amanhã confirmamos” -> Cliente: “Obrigado pela compreensão. Amanhã confirmaremos consigo.”`

    const db = supabaseAdmin()
    let readOnlyTools: ReturnType<typeof createAutoReplyTools>['tools'] = []
    let executeTool: ReturnType<typeof createAutoReplyTools>['executeTool'] | undefined

    if (needsFacts) {
      const permissions = await loadAgentToolPermissions(db, accountId, config.agentId!)
      const toolRuntime = createAutoReplyTools({
        db,
        accountId,
        conversationId,
        contactId: conversation.contact_id,
        configOwnerUserId: userId,
        config,
        permissions,
      })

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

    // Deliberately append the operator instruction as the final user turn.
    // This makes it the most recent actionable request instead of allowing the
    // previous customer message to compete with the human operator's command.
    const operatorMessages = [
      ...messages,
      {
        role: 'user' as const,
        content: `INSTRUÇÃO DO OPERADOR PARA A PRÓXIMA RESPOSTA: ${instruction}`,
      },
    ]

    const { text, usage } = await generateReply({
      config,
      systemPrompt: operatorPrompt,
      messages: operatorMessages,
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
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
    }
    return toErrorResponse(err)
  }
}
