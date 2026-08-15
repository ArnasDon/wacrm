import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  messageAccountFilter: '',
  updatedMessageIds: [] as string[],
  recipientAccountFilter: '',
}))

vi.mock('next/server', () => ({
  after: vi.fn(),
  NextResponse: { json: vi.fn() },
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from(table: string) {
      if (table === 'messages') {
        return {
          select: () => ({
            eq: (column: string) => ({
              eq: (accountColumn: string, accountId: string) => {
                expect(column).toBe('message_id')
                expect(accountColumn).toBe('conversations.account_id')
                h.messageAccountFilter = accountId
                return Promise.resolve({
                  data: [{
                    id: 'message-owned',
                    conversation_id: 'conversation-owned',
                    conversations: { account_id: accountId },
                  }],
                  error: null,
                })
              },
            }),
          }),
          update: () => ({
            in: (_column: string, ids: string[]) => {
              h.updatedMessageIds = ids
              return Promise.resolve({ error: null })
            },
          }),
        }
      }

      if (table === 'broadcast_recipients') {
        return {
          select: () => ({
            eq: () => ({
              eq: (accountColumn: string, accountId: string) => {
                expect(accountColumn).toBe('broadcasts.account_id')
                h.recipientAccountFilter = accountId
                return {
                  maybeSingle: () => Promise.resolve({ data: null, error: null }),
                }
              },
            }),
          }),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    },
  }),
}))

vi.mock('@/lib/webhooks/deliver', () => ({
  dispatchWebhookEvent: vi.fn(async () => undefined),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: vi.fn(),
  encrypt: vi.fn(),
  isLegacyFormat: vi.fn(),
}))
vi.mock('@/lib/whatsapp/meta-api', () => ({ getMediaUrl: vi.fn(), downloadMedia: vi.fn() }))
vi.mock('@/lib/contacts/dedupe', () => ({ findExistingContact: vi.fn(), isUniqueViolation: vi.fn() }))
vi.mock('@/lib/conversations/reopen', () => ({ reopenClosedConversation: vi.fn() }))
vi.mock('@/lib/whatsapp/webhook-signature', () => ({ verifyMetaWebhookSignature: vi.fn() }))
vi.mock('@/lib/automations/engine', () => ({ runAutomationsForTrigger: vi.fn() }))
vi.mock('@/lib/flows/engine', () => ({ dispatchInboundToFlows: vi.fn() }))
vi.mock('@/lib/ai/auto-reply', () => ({ dispatchInboundToAiReply: vi.fn() }))
vi.mock('@/lib/whatsapp/template-webhook', () => ({
  handleTemplateWebhookChange: vi.fn(),
  isTemplateWebhookField: vi.fn(() => false),
}))

import { handleStatusUpdate } from './route'

describe('handleStatusUpdate tenant isolation', () => {
  beforeEach(() => {
    h.messageAccountFilter = ''
    h.updatedMessageIds = []
    h.recipientAccountFilter = ''
  })

  it('scopes message and broadcast lookups to the receiving account', async () => {
    await handleStatusUpdate({
      id: 'shared-provider-message-id',
      status: 'delivered',
      timestamp: '1700000000',
      recipient_id: '15551230000',
    }, 'account-a')

    expect(h.messageAccountFilter).toBe('account-a')
    expect(h.recipientAccountFilter).toBe('account-a')
    expect(h.updatedMessageIds).toEqual(['message-owned'])
  })
})
