import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// Punto 10, F-P10-2 — this is the first test file for this module.
// Scoped narrowly, per this phase's own authorization, to the one
// property that matters for F-P10-2: an Automation send is a
// deterministic, non-human send and must NEVER pause the AI auto-reply
// bot (never write `assigned_agent_id` / `ai_autoreply_disabled`) —
// unlike `src/lib/whatsapp/send-message.ts`'s `humanAgentUserId` path,
// which is the one place that's allowed to.
// ============================================================

vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTextMessage: vi.fn(async () => ({ messageId: 'wamid.auto' })),
  sendTemplateMessage: vi.fn(async () => ({ messageId: 'wamid.auto-tpl' })),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => v,
}))

const conversationUpdates: Record<string, unknown>[] = []

vi.mock('./admin-client', () => ({
  supabaseAdmin: (): SupabaseClient =>
    ({
      from(table: string) {
        const builder: Record<string, unknown> = {
          select: () => builder,
          eq: () => builder,
          insert: () => Promise.resolve({ error: null }),
          update: (row: Record<string, unknown>) => {
            if (table === 'conversations') conversationUpdates.push(row)
            return builder
          },
          maybeSingle: async () => {
            if (table === 'contacts') {
              return { data: { id: 'ct-1', phone: '+15551234567' }, error: null }
            }
            return { data: null, error: null }
          },
          single: async () => {
            if (table === 'whatsapp_config') {
              return {
                data: { id: 'cfg-1', phone_number_id: 'pn-1', access_token: 'token' },
                error: null,
              }
            }
            return { data: null, error: null }
          },
          then: (resolve: (r: { data: unknown[]; error: null }) => unknown) =>
            resolve({ data: [], error: null }),
        }
        return builder
      },
    }) as unknown as SupabaseClient,
}))

import { engineSendText } from './meta-send'

describe('automations/meta-send — F-P10-2: never pauses AI', () => {
  it('a text send from an automation never writes assigned_agent_id or ai_autoreply_disabled', async () => {
    conversationUpdates.length = 0
    await engineSendText({
      accountId: 'acct-1',
      userId: 'author-1',
      conversationId: 'cv-1',
      contactId: 'ct-1',
      text: 'Your order shipped!',
    })
    expect(conversationUpdates.length).toBeGreaterThan(0)
    for (const update of conversationUpdates) {
      expect(update).not.toHaveProperty('assigned_agent_id')
      expect(update).not.toHaveProperty('ai_autoreply_disabled')
    }
  })
})
