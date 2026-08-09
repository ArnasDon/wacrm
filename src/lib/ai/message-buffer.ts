import { supabaseAdmin } from './admin-client'
import { dispatchInboundToAiReply, type DispatchArgs } from './auto-reply'
import { loadAiConfig } from './config'

interface BufferedDispatchArgs extends DispatchArgs {
  generation: number
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

/**
 * Atomically marks a newly persisted inbound message as the latest AI input.
 * This is called for every inbound message, including messages consumed by a
 * Flow, so deterministic handling also invalidates an older pending AI reply.
 */
export async function registerInboundForAiBuffer(args: {
  accountId: string
  conversationId: string
}): Promise<number | null> {
  const { data, error } = await supabaseAdmin().rpc('schedule_ai_dispatch', {
    p_account_id: args.accountId,
    p_conversation_id: args.conversationId,
  })

  if (error) {
    console.error('[ai message buffer] schedule_ai_dispatch failed:', error)
    return null
  }

  const generation = Number(data)
  if (!Number.isSafeInteger(generation) || generation < 1) {
    console.error('[ai message buffer] invalid dispatch generation:', data)
    return null
  }

  return generation
}

/**
 * Waits for the account's quiet window, then atomically claims this generation.
 * A newer inbound increments the generation and makes this invocation stale;
 * simultaneous claim attempts are reduced to exactly one winner by the RPC.
 */
export async function dispatchBufferedInboundToAiReply(
  args: BufferedDispatchArgs
): Promise<void> {
  const {
    accountId,
    conversationId,
    contactId,
    configOwnerUserId,
    generation,
  } = args

  try {
    const db = supabaseAdmin()
    const config = await loadAiConfig(db, accountId)
    if (!config?.autoReplyEnabled) return

    await wait(config.bufferWindowSeconds * 1_000)

    const { data: claimed, error } = await db.rpc('claim_ai_dispatch', {
      p_account_id: accountId,
      p_conversation_id: conversationId,
      p_generation: generation,
    })

    if (error) {
      console.error('[ai message buffer] claim_ai_dispatch failed:', error)
      return
    }
    if (claimed !== true) {
      console.info(
        `[ai message buffer] conversation ${conversationId} generation ${generation} superseded`
      )
      return
    }

    await dispatchInboundToAiReply({
      accountId,
      conversationId,
      contactId,
      configOwnerUserId,
      inboundMessageId: args.inboundMessageId,
    })
  } catch (error) {
    console.error('[ai message buffer] dispatch failed:', error)
  }
}
