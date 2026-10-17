import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// Punto 10, F-P10-2 — this is the first test file for this module.
// Scoped narrowly, per this phase's own authorization, to the one
// property that matters for F-P10-2: `engineSendText`/`engineSendMedia`
// here are shared by TWO non-human callers — the deterministic Flow
// runner AND the AI auto-reply bot itself (src/lib/ai/auto-reply.ts
// imports these same functions to deliver its own generated replies).
// Neither may ever pause the AI auto-reply bot (write
// `assigned_agent_id` / `ai_autoreply_disabled`) — doing so here would
// mean the bot disabled itself the instant it sent its own reply. The
// only send path allowed to is `src/lib/whatsapp/send-message.ts`'s
// `humanAgentUserId` parameter.
// ============================================================

vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTextMessage: vi.fn(async () => ({ messageId: 'wamid.flow' })),
  sendMediaMessage: vi.fn(async () => ({ messageId: 'wamid.flow-media' })),
  sendInteractiveButtons: vi.fn(async () => ({ messageId: 'wamid.flow-btn' })),
  sendInteractiveList: vi.fn(async () => ({ messageId: 'wamid.flow-list' })),
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
        }
        return builder
      },
    }) as unknown as SupabaseClient,
}))

import { engineSendText, engineSendMedia } from './meta-send'

describe('flows/meta-send — F-P10-2: never pauses AI (Flow runner AND the AI bot both call this)', () => {
  it('a text send never writes assigned_agent_id or ai_autoreply_disabled', async () => {
    conversationUpdates.length = 0
    await engineSendText({
      accountId: 'acct-1',
      userId: 'author-1',
      conversationId: 'cv-1',
      contactId: 'ct-1',
      text: 'Hello from a flow (or the AI bot)',
    })
    expect(conversationUpdates.length).toBeGreaterThan(0)
    for (const update of conversationUpdates) {
      expect(update).not.toHaveProperty('assigned_agent_id')
      expect(update).not.toHaveProperty('ai_autoreply_disabled')
    }
  })

  it('a media send never writes assigned_agent_id or ai_autoreply_disabled either', async () => {
    conversationUpdates.length = 0
    await engineSendMedia({
      accountId: 'acct-1',
      userId: 'author-1',
      conversationId: 'cv-1',
      contactId: 'ct-1',
      kind: 'image',
      link: 'https://example.com/photo.jpg',
    })
    expect(conversationUpdates.length).toBeGreaterThan(0)
    for (const update of conversationUpdates) {
      expect(update).not.toHaveProperty('assigned_agent_id')
      expect(update).not.toHaveProperty('ai_autoreply_disabled')
    }
  })
})
