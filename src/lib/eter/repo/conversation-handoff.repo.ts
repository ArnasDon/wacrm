import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// Conversation-handoff slice of the `conversations` table — the ONLY
// module the EterWA agent domain is allowed to use to write these
// specific columns. `src/lib/ai/auto-reply.ts` writes the same columns
// directly (pre-existing code, not touched here); this repo exists so
// the NEW escalate_to_human tool handler follows the account-scoped
// repository rule the rest of Fase 2 follows.
//
// Mirrors the auto-reply handoff shape (see auto-reply.ts): pause the
// bot on this thread (sticky — `ai_autoreply_disabled = true`), leave a
// short internal note (`ai_handoff_summary`), and assign a human only
// when one is requested AND the thread isn't already owned — this
// function never steals an existing assignment.
// ============================================================

export interface EscalateConversationInput {
  reason: string
  /** UUID of the human agent to assign, or omitted to drop into the
   *  shared (unassigned) queue. */
  agentId?: string | null
}

export async function escalateConversationToHuman(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  input: EscalateConversationInput,
): Promise<void> {
  const { data: conv, error: readErr } = await db
    .from('conversations')
    .select('assigned_agent_id')
    .eq('account_id', accountId)
    .eq('id', conversationId)
    .maybeSingle()
  if (readErr) throw readErr
  if (!conv) throw new Error(`Conversation ${conversationId} not found for account ${accountId}`)

  const update: Record<string, unknown> = {
    ai_autoreply_disabled: true,
    ai_handoff_summary: `🤖 Agente escalou a conversa: ${input.reason}`,
  }
  if (input.agentId && !conv.assigned_agent_id) {
    update.assigned_agent_id = input.agentId
  }

  const { error } = await db
    .from('conversations')
    .update(update)
    .eq('account_id', accountId)
    .eq('id', conversationId)
  if (error) throw error
}
