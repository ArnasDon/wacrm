import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAgentNotification } from './notifications.repo'

describe('notifications.repo (agent slice)', () => {
  it('inserts with type agent_notification and scopes to accountId', async () => {
    let inserted: Record<string, unknown> | null = null
    const db = {
      from: () => ({
        insert: (payload: Record<string, unknown>) => {
          inserted = payload
          return Promise.resolve({ error: null })
        },
      }),
    } as unknown as SupabaseClient

    await createAgentNotification(db, 'acct-1', {
      userId: 'user-1',
      title: 'Lead urgente',
      body: 'Contacto quer falar já.',
      conversationId: 'conv-1',
    })

    expect(inserted).toMatchObject({
      account_id: 'acct-1',
      user_id: 'user-1',
      type: 'agent_notification',
      title: 'Lead urgente',
      conversation_id: 'conv-1',
    })
  })
})
