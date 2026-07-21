import { supabaseAdmin } from '@/lib/automations/admin-client'
import { loadAiConfig } from './config'
import { loadAutomationResources } from '@/lib/automations/resources'
import { buildAgentContext } from './agent-context'
import { decideAgentAction } from './agent-decide'
import { moveDealStage } from '@/lib/pipelines/stage-move'
import { engineSendText } from '@/lib/automations/meta-send'
import { addContactTagIfAbsent, removeContactTag } from '@/lib/contacts/tag-write'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'

export interface DispatchInboundToAgentArgs {
  accountId: string
  userId: string
  contactId: string
  conversationId: string
}

/**
 * Fire-and-forget entry point called from the WhatsApp webhook after an
 * inbound message is stored. Never throws — a slow or failing AI call
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

  // Rate-limited before the AI call is ever made — a misbehaving
  // upstream retry storm must not translate into runaway BYOK spend.
  const limit = checkRateLimit(`ai-agent:${accountId}`, RATE_LIMITS.aiAgentDecision)
  if (!limit.success) return

  const { data: conversation } = await db
    .from('conversations')
    .select('id, ai_autoreply_disabled')
    .eq('id', conversationId)
    .maybeSingle()
  if (!conversation || conversation.ai_autoreply_disabled) return

  const [resources, context] = await Promise.all([
    loadAutomationResources(db, accountId),
    buildAgentContext(db, { accountId, conversationId }),
  ])

  const decision = await decideAgentAction({ config, resources, context })

  let handoff = decision.handoff
  let handoffReason = decision.handoff_reason

  if (decision.reply_text) {
    // Atomically claim the next reply slot via the claim_ai_reply_slot
    // Postgres function (see supabase/migrations/039_ai_reply_cap_rpc.sql).
    // The cap check (`ai_reply_count < max_replies`) and the increment
    // (`ai_reply_count = ai_reply_count + 1`, evaluated against the live
    // row) happen inside a single server-side UPDATE, so Postgres
    // serializes concurrent callers correctly. dispatchInboundToAgent is
    // fire-and-forget and can run concurrently for the same conversation
    // (a customer sending several messages in quick succession) — a
    // client-computed read-then-write here would let two concurrent runs
    // both pass the cap check and both send.
    const { data: claimed, error: claimError } = await db.rpc('claim_ai_reply_slot', {
      conversation_id: conversationId,
      max_replies: config.autoReplyMaxPerConversation,
    })

    if (claimError) {
      console.error('[ai-agent] failed to claim reply-cap slot:', claimError)
    } else if (claimed !== true) {
      // Either the cap was already reached, or a concurrent run claimed the
      // last slot first. Either way, fall back to handoff instead of sending.
      handoff = true
      handoffReason = handoffReason ?? 'auto-reply cap reached'
    } else {
      const sent = await engineSendText({
        accountId,
        userId,
        conversationId,
        contactId,
        text: decision.reply_text,
      })
      // Best-effort flag so the inbox can visually distinguish AI-authored
      // replies from manual agent sends. Wrapped in try/catch (not just a
      // promise .catch) because a synchronous throw while building the
      // query — as opposed to a rejected promise — would otherwise abort
      // the rest of the dispatch (tagging/stage-move/handoff still need
      // to run even if this best-effort flag fails).
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
    }
  }

  for (const tagId of decision.add_tags) {
    await addContactTagIfAbsent(db, { accountId, contactId, tagId }).catch((err) =>
      console.error('[ai-agent] add_tag failed:', err),
    )
  }

  for (const tagId of decision.remove_tags) {
    await removeContactTag(db, { accountId, contactId, tagId }).catch((err) =>
      console.error('[ai-agent] remove_tag failed:', err),
    )
  }

  if (config.pipelineMoveEnabled && decision.move_to_stage_id && context.dealId) {
    await moveDealStage({
      accountId,
      dealId: context.dealId,
      toStageId: decision.move_to_stage_id,
      source: 'ai',
      reason: 'AI agent classified the conversation',
    }).then(async (result) => {
      if (!result.moved) return
      await runAutomationsForTrigger({
        accountId,
        triggerType: 'deal_stage_changed',
        contactId,
        context: { conversation_id: conversationId, deal_id: context.dealId! },
      })
    })
  }

  if (handoff) {
    const { error } = await db
      .from('conversations')
      .update({
        ai_autoreply_disabled: true,
        ai_handoff_summary: handoffReason,
        ...(config.handoffAgentId ? { assigned_agent_id: config.handoffAgentId } : {}),
      })
      .eq('id', conversationId)
    if (error) console.error('[ai-agent] handoff update failed:', error)
  }
}
