import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { escalateConversationToHuman } from './conversation-handoff.repo'

function makeDb(conv: Record<string, unknown> | null) {
  let updatePayload: Record<string, unknown> | null = null
  const db = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: conv, error: null }) }),
        }),
      }),
      update: (payload: Record<string, unknown>) => {
        updatePayload = payload
        return { eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }
      },
    }),
  }
  const state = { db: db as unknown as SupabaseClient, get updatePayload() { return updatePayload } }
  return state
}

describe('escalateConversationToHuman', () => {
  it('disables auto-reply and assigns the given agent when unassigned', async () => {
    const state = makeDb({ assigned_agent_id: null })
    await escalateConversationToHuman(state.db, 'acct-1', 'conv-1', {
      reason: 'Lead pediu para falar com humano',
      agentId: 'agent-7',
    })
    expect(state.updatePayload).toMatchObject({
      ai_autoreply_disabled: true,
      assigned_agent_id: 'agent-7',
    })
  })

  it('never overwrites an existing assignment', async () => {
    const state = makeDb({ assigned_agent_id: 'agent-existing' })
    await escalateConversationToHuman(state.db, 'acct-1', 'conv-1', {
      reason: 'x',
      agentId: 'agent-7',
    })
    expect(state.updatePayload).not.toHaveProperty('assigned_agent_id')
  })

  it('throws when the conversation does not resolve for this account', async () => {
    const { db } = makeDb(null)
    await expect(
      escalateConversationToHuman(db, 'acct-1', 'conv-missing', { reason: 'x' }),
    ).rejects.toThrow()
  })
})
