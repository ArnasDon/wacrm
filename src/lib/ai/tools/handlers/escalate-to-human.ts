import { escalateConversationToHuman } from '@/lib/eter/repo/conversation-handoff.repo'
import type { ToolExecutionResult } from '../loop-types'
import type { ToolHandlerContext } from './context'
import { requireString, optionalString, ToolInputError } from './parse-input'

/** escalate_to_human — executes directly. Pauses auto-reply on this
 *  thread and (optionally) assigns a human agent, via
 *  conversation-handoff.repo.ts. This is the tool-driven handoff path
 *  for the EterWA agent — distinct from (but compatible with) the
 *  plain draft/auto-reply path's text-sentinel handoff
 *  (`HANDOFF_SENTINEL` in defaults.ts / handoff.ts): the DB mutation
 *  here (`ai_autoreply_disabled = true`) is what actually stops the
 *  bot, so it takes effect immediately regardless of whether the
 *  model's final reply text also happens to contain the sentinel. */
export async function escalateToHumanHandler(
  ctx: ToolHandlerContext,
  input: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  try {
    const conversationId = requireString(input, 'conversation_id')
    const reason = requireString(input, 'reason')
    const agentId = optionalString(input, 'agent_id')

    if (ctx.conversationId && conversationId !== ctx.conversationId) {
      return {
        isError: true,
        content: 'conversation_id não corresponde à conversa actual — não é permitido escalar outra thread.',
      }
    }

    await escalateConversationToHuman(ctx.db, ctx.accountId, conversationId, {
      reason,
      agentId,
    })

    return {
      isError: false,
      content: 'Conversa entregue a um humano — o auto-reply foi desligado nesta thread.',
    }
  } catch (err) {
    if (err instanceof ToolInputError) return { isError: true, content: err.message }
    throw err
  }
}
