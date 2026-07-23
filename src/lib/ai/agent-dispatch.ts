import { supabaseAdmin } from '@/lib/automations/admin-client'
import { loadAiConfig } from './config'
import { loadAutomationResources } from '@/lib/automations/resources'
import { attachKnowledgeToAgentContext, buildAgentContext } from './agent-context'
import { decideAgentAction } from './agent-decide'
import { moveDealStage } from '@/lib/pipelines/stage-move'
import { engineSendText } from '@/lib/automations/zapi-send'
import { addContactTagIfAbsent, removeContactTag } from '@/lib/contacts/tag-write'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { completeAiRun, createAiRun, logAiRetrievalEvent, logAiToolCall } from './run-log'
import { routeAgentRole } from './agent-router'

export interface DispatchInboundToAgentArgs {
  accountId: string
  userId: string
  contactId: string
  conversationId: string
}

/**
 * Fire-and-forget entry point called from the WhatsApp webhook after an
 * inbound message is stored. Never throws: a slow or failing AI call
 * must not affect the webhook's response to Meta.
 */
export async function dispatchInboundToAgent(args: DispatchInboundToAgentArgs): Promise<void> {
  try {
    await run(args)
  } catch (err) {
    console.error('[ai-agent] dispatch failed:', err)
  }
}

async function run(args: DispatchInboundToAgentArgs): Promise<void> {
  const { accountId, userId, contactId, conversationId } = args
  const db = supabaseAdmin()

  const config = await loadAiConfig(db, accountId)
  if (!config || !config.agentEnabled) return

  // Gate provider work before creating a run or spending BYOK quota.
  const limit = checkRateLimit(`ai-agent:${accountId}`, RATE_LIMITS.aiAgentDecision)
  if (!limit.success) return

  let runId: string | null = null
  try {
    runId = await createAiRun(db, {
      accountId,
      conversationId,
      userId,
      surface: 'whatsapp_agent',
      agentRole: 'coordinator',
      provider: config.provider,
      model: config.model,
    })
  } catch (err) {
    console.error('[ai-agent] failed to create run log:', err)
  }

  const completeRun = async (input: { status: 'completed' | 'failed'; error?: string }) => {
    try {
      await completeAiRun(db, { runId, ...input })
    } catch (err) {
      console.error('[ai-agent] failed to complete run log:', err)
    }
  }

  try {
    const { data: conversation } = await db
      .from('conversations')
      .select('id, ai_autoreply_disabled')
      .eq('id', conversationId)
      .maybeSingle()
    if (!conversation || conversation.ai_autoreply_disabled) {
      await completeRun({ status: 'completed' })
      return
    }

    const [resources, initialContext] = await Promise.all([
      loadAutomationResources(db, accountId),
      buildAgentContext(db, { accountId, conversationId }),
    ])

    const latestCustomerMessage = [...initialContext.messages]
      .reverse()
      .find((message) => message.role === 'customer')?.text ?? ''

    const context = await attachKnowledgeToAgentContext(
      db,
      initialContext,
      {
        enabled: true,
        query: latestCustomerMessage,
        embedding: null,
      },
      accountId
    )

    const agentRole = await routeAgentRole({ config, message: latestCustomerMessage })

    try {
      await logAiRetrievalEvent(db, {
        accountId,
        runId,
        query: latestCustomerMessage,
        retrievalMode: context.knowledge.some((knowledge) => knowledge.mode === 'semantic') ? 'hybrid' : 'fts',
        chunkIds: context.knowledge.map((knowledge) => knowledge.chunkId),
        scores: context.knowledge.map((knowledge) => ({
          chunkId: knowledge.chunkId,
          score: knowledge.score,
          mode: knowledge.mode,
        })),
      })
    } catch (err) {
      console.error('[ai-agent] failed to log retrieval:', err)
    }

    const logTool = async (input: {
      toolName: string
      arguments: Record<string, unknown>
      status: 'proposed' | 'executed' | 'rejected' | 'skipped' | 'failed'
      result?: Record<string, unknown>
      error?: string | null
    }) => {
      try {
        await logAiToolCall(db, { accountId, runId, ...input })
      } catch (err) {
        console.error('[ai-agent] failed to log tool call:', err)
      }
    }

    const decision = await decideAgentAction({ config, resources, context })
    let handoff = decision.handoff
    let handoffReason = decision.handoff_reason

    if (decision.reply_text) {
      const toolArguments = {
        agentRole,
        contactId,
        conversationId,
        text: decision.reply_text,
        citations: decision.citations,
      }
      await logTool({
        toolName: 'send_message',
        arguments: toolArguments,
        status: 'proposed',
      })

      // The database RPC atomically checks and increments the reply cap.
      const { data: claimed, error: claimError } = await db.rpc('claim_ai_reply_slot', {
        conversation_id: conversationId,
        max_replies: config.autoReplyMaxPerConversation,
      })

      if (claimError) {
        console.error('[ai-agent] failed to claim reply-cap slot:', claimError)
        await logTool({
          toolName: 'send_message',
          arguments: toolArguments,
          status: 'failed',
          error: errorMessage(claimError),
        })
      } else if (claimed !== true) {
        handoff = true
        handoffReason = handoffReason ?? 'auto-reply cap reached'
        await logTool({
          toolName: 'send_message',
          arguments: toolArguments,
          status: 'skipped',
          result: { reason: 'auto-reply cap reached' },
        })
      } else {
        try {
          const sent = await engineSendText({
            accountId,
            userId,
            conversationId,
            contactId,
            text: decision.reply_text,
          })
          await logTool({
            toolName: 'send_message',
            arguments: toolArguments,
            status: 'executed',
            result: { whatsappMessageId: sent.whatsapp_message_id },
          })

          try {
            const { error } = await db
              .from('messages')
              .update({ ai_generated: true })
              .eq('message_id', sent.whatsapp_message_id)
              .eq('conversation_id', conversationId)
            if (error) console.error('[ai-agent] failed to flag ai-generated message:', error)
          } catch (err) {
            console.error('[ai-agent] failed to flag ai-generated message:', err)
          }
        } catch (err) {
          await logTool({
            toolName: 'send_message',
            arguments: toolArguments,
            status: 'failed',
            error: errorMessage(err),
          })
          throw err
        }
      }
    }

    for (const tagId of decision.add_tags) {
      const toolArguments = { agentRole, accountId, contactId, tagId }
      await logTool({
        toolName: 'add_tag',
        arguments: toolArguments,
        status: 'proposed',
      })
      try {
        const added = await addContactTagIfAbsent(db, {
          accountId,
          contactId,
          tagId,
        })
        await logTool({
          toolName: 'add_tag',
          arguments: toolArguments,
          status: 'executed',
          result: { added },
        })
      } catch (err) {
        console.error('[ai-agent] add_tag failed:', err)
        await logTool({
          toolName: 'add_tag',
          arguments: toolArguments,
          status: 'failed',
          error: errorMessage(err),
        })
      }
    }

    for (const tagId of decision.remove_tags) {
      const toolArguments = { agentRole, accountId, contactId, tagId }
      await logTool({
        toolName: 'remove_tag',
        arguments: toolArguments,
        status: 'proposed',
      })
      try {
        await removeContactTag(db, { accountId, contactId, tagId })
        await logTool({
          toolName: 'remove_tag',
          arguments: toolArguments,
          status: 'executed',
        })
      } catch (err) {
        console.error('[ai-agent] remove_tag failed:', err)
        await logTool({
          toolName: 'remove_tag',
          arguments: toolArguments,
          status: 'failed',
          error: errorMessage(err),
        })
      }
    }

    if (config.pipelineMoveEnabled && decision.move_to_stage_id && context.dealId) {
      const toolArguments = {
        agentRole,
        accountId,
        dealId: context.dealId,
        toStageId: decision.move_to_stage_id,
      }
      await logTool({
        toolName: 'move_deal_stage',
        arguments: toolArguments,
        status: 'proposed',
      })
      try {
        const result = await moveDealStage({
          accountId,
          dealId: context.dealId,
          toStageId: decision.move_to_stage_id,
          source: 'ai',
          reason: 'AI agent classified the conversation',
        })
        await logTool({
          toolName: 'move_deal_stage',
          arguments: toolArguments,
          status: result.moved ? 'executed' : 'skipped',
          result: { moved: result.moved },
        })
        if (result.moved) {
          await runAutomationsForTrigger({
            accountId,
            triggerType: 'deal_stage_changed',
            contactId,
            context: {
              conversation_id: conversationId,
              deal_id: context.dealId,
            },
          })
        }
      } catch (err) {
        await logTool({
          toolName: 'move_deal_stage',
          arguments: toolArguments,
          status: 'failed',
          error: errorMessage(err),
        })
        throw err
      }
    }

    if (handoff) {
      const toolArguments = {
        agentRole,
        conversationId,
        assignedAgentId: config.handoffAgentId,
        reason: handoffReason,
      }
      await logTool({
        toolName: 'assign_conversation',
        arguments: toolArguments,
        status: 'proposed',
      })
      try {
        const { error } = await db
          .from('conversations')
          .update({
            ai_autoreply_disabled: true,
            ai_handoff_summary: handoffReason,
            ...(config.handoffAgentId ? { assigned_agent_id: config.handoffAgentId } : {}),
          })
          .eq('id', conversationId)
        if (error) {
          console.error('[ai-agent] handoff update failed:', error)
          await logTool({
            toolName: 'assign_conversation',
            arguments: toolArguments,
            status: 'failed',
            error: errorMessage(error),
          })
        } else {
          await logTool({
            toolName: 'assign_conversation',
            arguments: toolArguments,
            status: 'executed',
          })
        }
      } catch (err) {
        await logTool({
          toolName: 'assign_conversation',
          arguments: toolArguments,
          status: 'failed',
          error: errorMessage(err),
        })
        throw err
      }
    }

    await completeRun({ status: 'completed' })
  } catch (err) {
    await completeRun({ status: 'failed', error: errorMessage(err) })
    throw err
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
