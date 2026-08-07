import { supabaseAdmin } from './admin-client'
import { loadAiConfig } from './config'
import { buildConversationContext } from './context'
import { generateReply } from './generate'
import { buildSystemPrompt } from './defaults'
import { buildHandoffSummary } from './handoff'
import { logAiUsage } from './usage'
import { createAutoReplyTools } from './tools'
import { loadAgentToolPermissions } from './tool-permissions'
import { engineSendText } from '@/lib/flows/meta-send'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { triggerMatches } from '@/lib/automations/engine'
import type { Automation } from '@/types'

interface DispatchArgs {
  /** Tenancy key — drives config, contact, and whatsapp_config lookups. */
  accountId: string
  conversationId: string
  contactId: string
  /** The account's WhatsApp config owner, used for the outbound send's
   *  audit columns (mirrors how the flow runner passes it through). */
  configOwnerUserId: string
}

const HANDOFF_NOTICE =
  'Vou encaminhar o seu atendimento à nossa equipa para continuar consigo.'
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

/**
 * AI auto-reply for a freshly-arrived inbound message.
 *
 * Invoked from the WhatsApp webhook's `after()` block, only when no
 * deterministic flow consumed the message (flows win). It owns its
 * try/catch and never throws so an LLM or media failure cannot affect
 * the webhook response to Meta.
 */
export async function dispatchInboundToAiReply(
  args: DispatchArgs,
): Promise<void> {
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
      const update: Record<string, unknown> = {
        ai_autoreply_disabled: true,
        ai_handoff_summary: `Limite automático atingido após ${replyCount} respostas.`,
      }
      if (config.handoffAgentId) update.assigned_agent_id = config.handoffAgentId
      await db.from('conversations').update(update).eq('id', conversationId)
      await sendStaticNotice(args, HANDOFF_NOTICE)
      return
    }

    const messages = await buildConversationContext(db, conversationId)
    if (messages.length === 0) {
      logSkip(conversationId, 'empty_conversation_context')
      return
    }

    // Deterministic message responders win over the LLM, but only when
    // an active automation ACTUALLY matches this inbound. The previous
    // implementation skipped AI whenever any keyword automation merely
    // existed in the account, which caused apparently random silence.
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
          message_text: latestInbound?.content ?? '',
          conversation_id: conversationId,
        }),
      )
    ) {
      logSkip(conversationId, 'matching_deterministic_automation')
      return
    }

    const acctLimit = checkRateLimit(
      `ai-autoreply:${accountId}`,
      RATE_LIMITS.aiAutoReplyAccount,
    )
    if (!acctLimit.success) {
      console.warn(
        `[ai auto-reply] account ${accountId} hit the per-account rate limit — handing off this inbound.`,
      )
      await db
        .from('conversations')
        .update({ ai_autoreply_disabled: true })
        .eq('id', conversationId)
      await sendStaticNotice(args, TEMPORARY_FAILURE_NOTICE)
      return
    }

    // Knowledge retrieval is now tool-driven. This prevents the same knowledge
    // base being queried once before the model call and again through
    // search_knowledge, and makes the Tools switches authoritative.
    const systemPrompt = buildSystemPrompt({
      userPrompt: config.systemPrompt,
      mode: 'auto_reply',
      knowledge: [],
    })

    const permissions = await loadAgentToolPermissions(
      db,
      accountId,
      config.agentId!,
    )
    const agentTools = createAutoReplyTools({
      db,
      accountId,
      conversationId,
      contactId,
      configOwnerUserId,
      config,
      permissions,
    })

    console.info('[ai auto-reply] tools enabled:', {
      conversationId,
      provider: config.provider,
      tools: agentTools.tools.map((tool) => tool.name),
    })

    const { text, handoff, usage } = await generateReply({
      config,
      systemPrompt,
      messages,
      tools: config.provider === 'openai' ? agentTools.tools : undefined,
      executeTool:
        config.provider === 'openai' ? agentTools.executeTool : undefined,
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
      const update: Record<string, unknown> = {
        ai_autoreply_disabled: true,
        ai_handoff_summary: summary,
      }
      if (config.handoffAgentId && !conv.assigned_agent_id) {
        update.assigned_agent_id = config.handoffAgentId
      }
      await db.from('conversations').update(update).eq('id', conversationId)
      await sendStaticNotice(args, HANDOFF_NOTICE)
      return
    }

    // Reserve the single auto-reply slot before executing any queued side
    // effect. Tool calls only prepare actions; no photo leaves the system
    // until this atomic cap check succeeds.
    const { data: claimed, error: claimErr } = await db.rpc(
      'claim_ai_reply_slot',
      {
        conversation_id: conversationId,
        max_replies: config.autoReplyMaxPerConversation,
      },
    )
    if (claimErr) {
      console.error('[ai auto-reply] claim_ai_reply_slot failed:', claimErr)
      await sendStaticNotice(args, TEMPORARY_FAILURE_NOTICE)
      return
    }
    if (claimed !== true) {
      console.warn('[ai auto-reply] reply slot was not claimed; handing off', conversationId)
      await db
        .from('conversations')
        .update({ ai_autoreply_disabled: true })
        .eq('id', conversationId)
      await sendStaticNotice(args, HANDOFF_NOTICE)
      return
    }

    if (hasPendingActions) {
      await agentTools.dispatchPendingActions()
    }

    if (text) {
      await engineSendText({
        accountId,
        userId: configOwnerUserId,
        conversationId,
        contactId,
        text,
        aiGenerated: true,
      })
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
