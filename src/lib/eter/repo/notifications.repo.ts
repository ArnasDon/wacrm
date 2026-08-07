import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// notifications repository (agent-facing slice) — the ONLY module the
// EterWA agent domain is allowed to use to write to
// `supabase.from('notifications')`. Scoped to `accountId` like every
// other repo in this directory; `userId` (the human recipient) is a
// required argument rather than inferred, since there's no `auth.uid()`
// on the service-role tool-executor path this runs under.
//
// Writes with `type: 'agent_notification'` (migration
// 038_eter_agent_pending_actions.sql extended the CHECK constraint for
// this) — deliberately distinct from `conversation_assigned`
// (migration 027), which is written exclusively by a DB trigger and
// means something more specific ("this conversation was assigned to
// you"). notify_admin is a free-text alert from the agent, not an
// assignment event.
// ============================================================

export interface CreateAgentNotificationInput {
  userId: string
  title: string
  body?: string | null
  conversationId?: string | null
  contactId?: string | null
}

export async function createAgentNotification(
  db: SupabaseClient,
  accountId: string,
  input: CreateAgentNotificationInput,
): Promise<void> {
  const { error } = await db.from('notifications').insert({
    account_id: accountId,
    user_id: input.userId,
    type: 'agent_notification',
    title: input.title,
    body: input.body ?? null,
    conversation_id: input.conversationId ?? null,
    contact_id: input.contactId ?? null,
  })
  if (error) throw error
}
