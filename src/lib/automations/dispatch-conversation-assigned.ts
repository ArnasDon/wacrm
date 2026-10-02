import { runAutomationsForTrigger } from './engine'

/**
 * Fire active `conversation_assigned` automations for an account after
 * a thread's assignee changes. Call from every code path that writes
 * `conversations.assigned_agent_id` (inbox UI, automation/flow steps,
 * AI handoff, etc.).
 */
export async function dispatchConversationAssignedAutomations(input: {
  accountId: string
  conversationId: string
  contactId: string | null
  agentId: string
}): Promise<void> {
  if (!input.agentId) return
  await runAutomationsForTrigger({
    accountId: input.accountId,
    triggerType: 'conversation_assigned',
    contactId: input.contactId ?? undefined,
    context: {
      conversation_id: input.conversationId,
      agent_id: input.agentId,
    },
  }).catch((err) => console.error('[automations] conversation_assigned dispatch failed:', err))
}
