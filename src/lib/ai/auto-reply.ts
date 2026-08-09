import { supabaseAdmin } from './admin-client'
import { loadAiConfig } from './config'
import { buildConversationContext } from './context'
import { createWhatsAppImageResolver } from './image-context'
import { generateReply } from './generate'
import { buildSystemPrompt } from './defaults'
import { buildHandoffSummary } from './handoff'
import { replyChunkDelayMs, splitReplyIntoChunks } from './chunk-reply'
import { logAiUsage } from './usage'
import { createAutoReplyTools } from './tools'
import { loadAgentToolPermissions } from './tool-permissions'
import { cataloguePrefetchPrompt, prefetchCatalogueForConversation } from './catalog-prefetch'
import { engineSendText, engineSendTypingIndicator } from '@/lib/flows/meta-send'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { triggerMatches } from '@/lib/automations/engine'
import type { Automation } from '@/types'
import { chatContentText } from './types'

export interface DispatchArgs {
  /** Tenancy key — drives config, contact, and whatsapp_config lookups. */
  accountId: string
  conversationId: string
  contactId: string
  /** Meta wamid of the newest inbound, used by the native typing indicator. */
  inboundMessageId: string
  /** The account's WhatsApp config owner, used for the outbound send's
   *  audit columns (mirrors how the flow runner passes it through). */
  configOwnerUserId: string
}

const HANDOFF_NOTICE = 'Vou encaminhar o seu atendimento à nossa equipa para continuar consigo.'
const TEMPORARY_FAILURE_NOTICE =
  'Não consegui concluir esta consulta neste momento. Vou encaminhar o seu atendimento à nossa equipa para que possa continuar sem ficar à espera.'

function logSkip(conversationId: string, reason: string) {
  console.info(`[ai auto-reply] conversation ${conversationId} skipped: ${reason}`)
}

async function sendStaticNotice(args: DispatchArgs, text: string) {
  await engineSendText({
    accountId: args.accountId,
    userId: args.configOwnerUserId,
    conversationId: args.conversationId,
    contactId: args.contactId,
    text,
    aiGenerated: true,
  })
}

async function showTyping(args: DispatchArgs): Promise<void> {
  try {
    await engineSendTypingIndicator({
      accountId: args.accountId,
      inboundMessageId: args.inboundMessageId,
    })
  } catch (error) {
    console.warn('[ai auto-reply] typing indicator failed:', error)
  }
}

async function sendReplyChunks(args: DispatchArgs, text: string, maxChunks: number): Promise<void> {
  const chunks = splitReplyIntoChunks(text, maxChunks)
  for (let index = 0; index < chunks.length; index++) {
    if (index > 0) {
      await showTyping(args)
      await new Promise((resolve) => setTimeout(resolve, replyChunkDelayMs(chunks[index - 1])))
    }
    await engineSendText({
      accountId: args.accountId,
      userId: args.configOwnerUserId,
      conversationId: args.conversationId,
      contactId: args.contactId,
      text: chunks[index],
      aiGenerated: true,
    })
  }
}

function formatHandoffNote(reason: string, summary?: string | null): string {
  const cleanSummary = summary?.trim()
  return cleanSummary ? `Motivo: ${reason}\n\nResumo: ${cleanSummary}` : `Motivo: ${reason}`
}

/**
 * AI auto-reply for a freshly-arrived inbound message.
 *
 * Invoked from the WhatsApp webhook's `after()` block, only when no
 * deterministic flow consumed the message (flows win). It owns its
 * try/catch and never throws so an LLM or media failure cannot affect
 * the webhook response to Meta.
 */
export async function dispatchInboundToAiReply(args: DispatchArgs): Promise<void> {
  const { accountId, conversationId, contactId, configOwnerUserId } = args

  try {
    const db = supabaseAdmin()

    const config = await loadAiConfig(db, accountId)
    if (!config) {
      logSkip(conversationId, 'no_ai_config')
      return
    }
    if (!config.autoReplyEnabled) {
      logSkip(conversationId, 'auto_reply_disabled_in_config')
      return
    }

    const notifyHandoffAssignee = async (note: string) => {
      if (!config.handoffAgentId) return
      const { error } = await db.from('notifications').insert({
        account_id: accountId,
        user_id: config.handoffAgentId,
        type: 'conversation_assigned',
        conversation_id: conversationId,
        contact_id: contactId,
        title: 'Conversa requer intervenção',
        body: note,
      })
      if (error) {
        console.error('[ai auto-reply] handoff notification failed:', error)
      }
    }

    const markHandoff = async (reason: string, summary?: string | null) => {
      const note = formatHandoffNote(reason, summary)
      const update: Record<string, unknown> = {
        ai_autoreply_disabled: true,
        ai_handoff_summary: note,
      }
      if (config.handoffAgentId) update.assigned_agent_id = config.handoffAgentId

      const { error } = await db
        .from('conversations')
        .update(update)
        .eq('id', conversationId)
        .eq('account_id', accountId)
      if (error) {
        console.error('[ai auto-reply] failed to persist handoff:', error)
      } else {
        await notifyHandoffAssignee(note)
      }
      return note
    }

    const { data: conv, error: convErr } = await db
      .from('conversations')
      .select('assigned_agent_id, ai_autoreply_disabled, ai_reply_count')
      .eq('id', conversationId)
      .maybeSingle()
    if (convErr || !conv) {
      console.error('[ai auto-reply] conversation lookup failed:', convErr)
      return
    }
    if (conv.assigned_agent_id) {
      logSkip(conversationId, 'conversation_assigned_to_human')
      return
    }
    if (conv.ai_autoreply_disabled) {
      logSkip(conversationId, 'conversation_ai_disabled')
      return
    }

    const replyCount = conv.ai_reply_count ?? 0
    if (replyCount >= config.autoReplyMaxPerConversation) {
      console.info(
        `[ai auto-reply] conversation ${conversationId} reached reply cap (${replyCount}/${config.autoReplyMaxPerConversation}); handing off.`,
      )
      await markHandoff(
        'Limite de respostas automáticas atingido.',
        `A IA respondeu ${replyCount} vezes nesta conversa. Continue o atendimento a partir da última mensagem do cliente.`,
      )
      await sendStaticNotice(args, HANDOFF_NOTICE)
      return
    }

    const messages = await buildConversationContext(db, conversationId, {
      resolveImage: createWhatsAppImageResolver(db, accountId),
    })
    if (messages.length === 0) {
      logSkip(conversationId, 'empty_conversation_context')
      return
    }

    const latestInbound = [...messages].reverse().find((m) => m.role === 'user')
    const { data: autoResponders, error: automationErr } = await db
      .from('automations')
      .select('*')
      .eq('account_id', accountId)
      .eq('is_active', true)
      .in('trigger_type', ['new_message_received', 'keyword_match'])

    if (automationErr) {
      console.error('[ai auto-reply] automation eligibility lookup failed:', automationErr)
    } else if (
      autoResponders?.some((automation) =>
        triggerMatches(automation as Automation, {
          message_text: latestInbound ? chatContentText(latestInbound.content) : '',
          conversation_id: conversationId,
        }),
      )
    ) {
      logSkip(conversationId, 'matching_deterministic_automation')
      return
    }

    const acctLimit = checkRateLimit(`ai-autoreply:${accountId}`, RATE_LIMITS.aiAutoReplyAccount)
    if (!acctLimit.success) {
      console.warn(
        `[ai auto-reply] account ${accountId} hit the per-account rate limit — handing off this inbound.`,
      )
      await markHandoff(
        'Limite temporário do serviço de IA atingido.',
        'O cliente escreveu enquanto o serviço automático estava temporariamente limitado. Continue a partir da última mensagem recebida.',
      )
      await sendStaticNotice(args, TEMPORARY_FAILURE_NOTICE)
      return
    }

    const permissions = await loadAgentToolPermissions(db, accountId, config.agentId!)
    const agentTools = createAutoReplyTools({
      db,
      accountId,
      conversationId,
      contactId,
      configOwnerUserId,
      config,
      permissions,
    })

    let catalogueGrounding: string | null = null
    if (permissions.search_catalog) {
      const prefetch = await prefetchCatalogueForConversation({
        db,
        accountId,
        messages,
        limit: 5,
      })
      catalogueGrounding = cataloguePrefetchPrompt(prefetch)
      if (prefetch.attempted) {
        console.info('[ai auto-reply] catalogue prefetch:', {
          conversationId,
          query: prefetch.query,
          count: prefetch.products.length,
          names: prefetch.products.map((product) => product.name),
        })
      }
    }

    const baseSystemPrompt = buildSystemPrompt({
      userPrompt: config.systemPrompt,
      mode: 'auto_reply',
      maxReplyChunks: config.maxReplyChunks,
      knowledge: [],
    })
    const systemPrompt = catalogueGrounding
      ? `${baseSystemPrompt}\n\n${catalogueGrounding}`
      : baseSystemPrompt

    console.info('[ai auto-reply] tools enabled:', {
      conversationId,
      provider: config.provider,
      tools: agentTools.tools.map((tool) => tool.name),
    })

    await showTyping(args)
    const { text, handoff, usage } = await generateReply({
      config,
      systemPrompt,
      messages,
      tools: config.provider === 'openai' ? agentTools.tools : undefined,
      executeTool: config.provider === 'openai' ? agentTools.executeTool : undefined,
    })

    void logAiUsage(db, {
      accountId,
      conversationId,
      mode: 'auto_reply',
      provider: config.provider,
      model: config.model,
      usage,
    })

    const hasPendingActions = agentTools.hasPendingActions()

    if (handoff || (!text && !hasPendingActions)) {
      console.info('[ai auto-reply] handoff requested:', {
        conversationId,
        handoff,
        emptyReply: !text,
        hasPendingActions,
      })
      const summary = buildHandoffSummary({
        messages,
        replyCount,
      })
      await markHandoff(
        handoff
          ? 'A IA determinou que o atendimento necessita de intervenção humana.'
          : 'A IA não conseguiu produzir uma resposta segura.',
        summary,
      )
      await sendStaticNotice(args, HANDOFF_NOTICE)
      return
    }

    const { data: claimed, error: claimErr } = await db.rpc('claim_ai_reply_slot', {
      conversation_id: conversationId,
      max_replies: config.autoReplyMaxPerConversation,
    })
    if (claimErr) {
      console.error('[ai auto-reply] claim_ai_reply_slot failed:', claimErr)
      await markHandoff(
        'Falha técnica ao reservar a resposta automática.',
        'A mensagem do cliente foi recebida, mas o sistema não conseguiu reservar uma resposta da IA. Continue a partir da última mensagem.',
      )
      await sendStaticNotice(args, TEMPORARY_FAILURE_NOTICE)
      return
    }
    if (claimed !== true) {
      console.warn('[ai auto-reply] reply slot was not claimed; handing off', conversationId)
      await markHandoff(
        'Limite de respostas automáticas atingido durante o processamento.',
        'A IA não enviou nova resposta. Continue a partir da última mensagem do cliente.',
      )
      await sendStaticNotice(args, HANDOFF_NOTICE)
      return
    }

    // For structured catalogue replies, the short model introduction belongs
    // before the cards. Sending it after the media made the WhatsApp thread
    // read backwards (cards first, then "Veja estas opções").
    if (hasPendingActions && text) {
      await sendReplyChunks(args, text, config.maxReplyChunks)
    }

    if (hasPendingActions) {
      await agentTools.dispatchPendingActions()
    }

    if (!hasPendingActions && text) {
      await sendReplyChunks(args, text, config.maxReplyChunks)
    }
  } catch (err) {
    console.error('[ai auto-reply] dispatch failed:', err)
    try {
      await sendStaticNotice(args, TEMPORARY_FAILURE_NOTICE)
    } catch (fallbackErr) {
      console.error('[ai auto-reply] fallback send failed:', fallbackErr)
    }
  }
}
