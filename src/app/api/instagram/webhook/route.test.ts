import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mirrors src/app/api/whatsapp/webhook/route.test.ts's shared-hoisted-state
// pattern.
const h = vi.hoisted(() => ({
  runAutomationsForTrigger: vi.fn(),
  dispatchInboundToFlows: vi.fn(),
  dispatchInboundToAiReply: vi.fn(),
  dispatchWebhookEvent: vi.fn(),
  findExistingInstagramContact: vi.fn(),
  state: {
    messageUpsertResult: [{ id: 'msg-1' }] as { id: string }[],
    priorCustomerMsgCount: 0,
    replyContextParent: null as { id: string } | null,
    conversation: { id: 'conv-1', status: 'open', account_id: 'acc-1' },
    upsertCalls: [] as { row: Record<string, unknown>; options: unknown }[],
    rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
    readReceiptUpdates: [] as string[],
    afterCallbacks: [] as (() => Promise<void> | void)[],
  },
}))

vi.mock('next/server', () => ({
  after: (cb: () => Promise<void> | void) => {
    h.state.afterCallbacks.push(cb)
  },
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ body, init }),
  },
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from(table: string) {
      switch (table) {
        case 'instagram_config':
          // Routing lookup: select('*').eq('ig_account_id', ...) — bare
          // awaited array result, mirrors the WhatsApp route's
          // whatsapp_config lookup by phone_number_id.
          return {
            select: () => ({
              eq: () =>
                Promise.resolve({
                  data: [
                    {
                      account_id: 'acc-1',
                      user_id: 'user-1',
                      ig_account_id: 'ig-acct-1',
                      access_token: 'enc',
                    },
                  ],
                  error: null,
                }),
            }),
          }
        case 'conversations':
          // findOrCreateConversation: select().eq().eq().order().limit()
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  order: () => ({
                    limit: () =>
                      Promise.resolve({ data: [h.state.conversation], error: null }),
                  }),
                }),
              }),
            }),
          }
        case 'messages':
          return {
            select: (_columns: string, options?: { head?: boolean }) =>
              options?.head
                ? {
                    eq: () => ({
                      eq: () =>
                        Promise.resolve({ count: h.state.priorCustomerMsgCount, error: null }),
                    }),
                  }
                : {
                    eq: () => ({
                      eq: () => ({
                        maybeSingle: () =>
                          Promise.resolve({ data: h.state.replyContextParent, error: null }),
                      }),
                    }),
                  },
            upsert: (row: Record<string, unknown>, options: unknown) => {
              h.state.upsertCalls.push({ row, options })
              return {
                select: () => Promise.resolve({ data: h.state.messageUpsertResult, error: null }),
              }
            },
            update: (row: Record<string, unknown>) => {
              if (row.status === 'read') {
                return {
                  eq: (_col: string, mid: string) => {
                    h.state.readReceiptUpdates.push(mid)
                    return Promise.resolve({ error: null })
                  },
                }
              }
              return { eq: () => Promise.resolve({ error: null }) }
            },
          }
        default:
          throw new Error(`unexpected table: ${table}`)
      }
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      h.state.rpcCalls.push({ name, args })
      return Promise.resolve({ data: null, error: null })
    },
  }),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: () => 'plain-token',
}))
vi.mock('@/lib/instagram/api', () => ({
  getIgUserProfile: vi.fn(async () => null),
}))
vi.mock('@/lib/contacts/dedupe', () => ({
  findExistingInstagramContact: h.findExistingInstagramContact,
  // Unused by this suite (Instagram-only), but the shared dm-inbound
  // module imports it unconditionally — must be present or the mock
  // factory throws at import time.
  findExistingFacebookContact: vi.fn(),
  isUniqueViolation: () => false,
}))
vi.mock('@/lib/conversations/reopen', () => ({
  reopenClosedConversation: vi.fn(async () => false),
}))
vi.mock('@/lib/whatsapp/webhook-signature', () => ({
  verifyMetaWebhookSignature: () => true,
}))
vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger: h.runAutomationsForTrigger,
}))
vi.mock('@/lib/flows/engine', () => ({
  dispatchInboundToFlows: h.dispatchInboundToFlows,
}))
vi.mock('@/lib/ai/auto-reply', () => ({
  dispatchInboundToAiReply: h.dispatchInboundToAiReply,
}))
vi.mock('@/lib/webhooks/deliver', () => ({
  dispatchWebhookEvent: h.dispatchWebhookEvent,
}))

import { POST } from './route'

const TEXT_MESSAGE = {
  sender: { id: 'igsid-1' },
  recipient: { id: 'ig-acct-1' },
  timestamp: 1700000000,
  message: { mid: 'ig-mid.1', text: 'hello' },
}

function inboundRequest(event: Record<string, unknown> = TEXT_MESSAGE) {
  const body = { entry: [{ id: 'ig-acct-1', messaging: [event] }] }
  return {
    text: async () => JSON.stringify(body),
    headers: { get: () => 'sha256=stub' },
  } as unknown as Request
}

async function runWebhook(event?: Record<string, unknown>) {
  const res = await POST(inboundRequest(event))
  for (const cb of h.state.afterCallbacks) await cb()
  return res
}

beforeEach(() => {
  vi.clearAllMocks()
  h.state.messageUpsertResult = [{ id: 'msg-1' }]
  h.state.priorCustomerMsgCount = 0
  h.state.replyContextParent = null
  h.state.conversation = { id: 'conv-1', status: 'open', account_id: 'acc-1' }
  h.state.upsertCalls = []
  h.state.rpcCalls = []
  h.state.readReceiptUpdates = []
  h.state.afterCallbacks = []
  h.findExistingInstagramContact.mockResolvedValue({ id: 'contact-1', instagram_id: 'igsid-1' })
  h.dispatchInboundToFlows.mockResolvedValue({ consumed: false })
  h.dispatchInboundToAiReply.mockResolvedValue(undefined)
  h.dispatchWebhookEvent.mockResolvedValue(undefined)
  h.runAutomationsForTrigger.mockResolvedValue(undefined)
})

describe('Instagram inbound webhook: idempotent insert', () => {
  it('a genuine first delivery persists once and fans out downstream', async () => {
    await runWebhook()

    expect(h.state.upsertCalls).toHaveLength(1)
    expect(h.state.upsertCalls[0].options).toMatchObject({
      onConflict: 'conversation_id,message_id',
      ignoreDuplicates: true,
    })
    expect(h.state.upsertCalls[0].row).toMatchObject({
      sender_type: 'customer',
      content_type: 'text',
      content_text: 'hello',
      message_id: 'ig-mid.1',
    })
    expect(h.state.rpcCalls).toHaveLength(1)
    expect(h.dispatchInboundToFlows).toHaveBeenCalledTimes(1)
    expect(h.dispatchWebhookEvent).toHaveBeenCalledWith(
      expect.anything(),
      'acc-1',
      'message.received',
      expect.objectContaining({ channel: 'instagram' }),
    )
  })

  it('a replayed delivery is a no-op: no unread bump, no fan-out', async () => {
    h.state.messageUpsertResult = []

    await runWebhook()

    expect(h.state.upsertCalls).toHaveLength(1)
    expect(h.state.rpcCalls).toHaveLength(0)
    expect(h.dispatchInboundToFlows).not.toHaveBeenCalled()
    expect(h.runAutomationsForTrigger).not.toHaveBeenCalled()
    expect(h.dispatchInboundToAiReply).not.toHaveBeenCalled()
    expect(h.dispatchWebhookEvent).not.toHaveBeenCalled()
  })
})

describe('Instagram inbound webhook: echo filtering', () => {
  it('skips events that mirror our own outbound sends (is_echo)', async () => {
    await runWebhook({
      sender: { id: 'igsid-1' },
      recipient: { id: 'ig-acct-1' },
      timestamp: 1700000000,
      message: { mid: 'ig-mid.echo', text: 'agent reply', is_echo: true },
    })

    expect(h.state.upsertCalls).toHaveLength(0);
    expect(h.dispatchWebhookEvent).not.toHaveBeenCalled();
  })
})

describe('Instagram inbound webhook: quick-reply taps', () => {
  it('routes a quick_reply payload to flows as an interactive_reply and fires the automation trigger', async () => {
    await runWebhook({
      sender: { id: 'igsid-1' },
      recipient: { id: 'ig-acct-1' },
      timestamp: 1700000000,
      message: { mid: 'ig-mid.2', text: 'Yes please', quick_reply: { payload: 'YES' } },
    })

    expect(h.dispatchInboundToFlows).toHaveBeenCalledWith(
      expect.objectContaining({
        message: {
          kind: 'interactive_reply',
          reply_id: 'YES',
          reply_title: 'Yes please',
          meta_message_id: 'ig-mid.2',
        },
      }),
    )
    const triggers = h.runAutomationsForTrigger.mock.calls.map(
      (call) => (call[0] as { triggerType: string }).triggerType,
    )
    expect(triggers).toContain('interactive_reply')
    expect(h.dispatchInboundToAiReply).not.toHaveBeenCalled()
  })
})

describe('Instagram inbound webhook: media attachments', () => {
  it('stores the attachment CDN URL directly, no media-id fetch step', async () => {
    await runWebhook({
      sender: { id: 'igsid-1' },
      recipient: { id: 'ig-acct-1' },
      timestamp: 1700000000,
      message: {
        mid: 'ig-mid.3',
        attachments: [{ type: 'image', payload: { url: 'https://cdn.example/photo.jpg' } }],
      },
    })

    expect(h.state.upsertCalls[0].row).toMatchObject({
      content_type: 'image',
      media_url: 'https://cdn.example/photo.jpg',
    })
  })

  it("maps Instagram's 'file' attachment type to the 'document' content_type", async () => {
    await runWebhook({
      sender: { id: 'igsid-1' },
      recipient: { id: 'ig-acct-1' },
      timestamp: 1700000000,
      message: {
        mid: 'ig-mid.4',
        attachments: [{ type: 'file', payload: { url: 'https://cdn.example/invoice.pdf' } }],
      },
    })

    expect(h.state.upsertCalls[0].row).toMatchObject({ content_type: 'document' });
  })
})

describe('Instagram inbound webhook: read receipts', () => {
  it('mirrors event.read.mid onto messages.status without touching messages/conversations otherwise', async () => {
    await runWebhook({
      sender: { id: 'igsid-1' },
      recipient: { id: 'ig-acct-1' },
      timestamp: 1700000000,
      read: { mid: 'ig-mid.read-me' },
    })

    expect(h.state.readReceiptUpdates).toEqual(['ig-mid.read-me'])
    expect(h.state.upsertCalls).toHaveLength(0)
    expect(h.dispatchInboundToFlows).not.toHaveBeenCalled()
  })
})
