import { beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// WHATSAPP A3 fix — handleStatusUpdate() used to match `messages` and
// `broadcast_recipients` by `status.id` (Meta's message_id) ALONE, with
// no tenant scope. Migration 037 documents that message_id is NOT
// globally unique across phone numbers, so two different accounts can
// each have a row whose message_id equals the same value. A status
// webhook delivered for one account's phone number could therefore:
//   - flip another account's `messages.status`,
//   - flip another account's `broadcast_recipients.status` (and its
//     aggregate counts),
//   - resolve `message.status_updated`'s target account_id to the
//     WRONG tenant, leaking that event to their public webhook.
//
// The fix resolves the account that owns the incoming phone_number_id
// FIRST, then scopes every query below by that account (via the
// conversations/broadcasts join — neither `messages` nor
// `broadcast_recipients` carries its own `account_id` column) instead
// of matching by message_id alone.
//
// This file is separate from route.test.ts (which only exercises the
// inbound-message path) so its fake DB can model the exact
// account-scoped queries the fix introduces without touching that
// file's existing, already-passing test setup.
// ============================================================

interface FakeMessage {
  id: string
  message_id: string | null
  conversation_id: string
  status: string
}
interface FakeConversation {
  id: string
  account_id: string
}
interface FakeBroadcastRecipient {
  id: string
  whatsapp_message_id: string | null
  broadcast_id: string
  status: string
  sent_at?: string | null
  delivered_at?: string | null
  read_at?: string | null
}
interface FakeBroadcast {
  id: string
  account_id: string
}
interface FakeWhatsappConfig {
  account_id: string
  phone_number_id: string
}

const h = vi.hoisted(() => ({
  state: {
    messages: [] as FakeMessage[],
    conversations: [] as FakeConversation[],
    broadcastRecipients: [] as FakeBroadcastRecipient[],
    broadcasts: [] as FakeBroadcast[],
    whatsappConfigs: [] as FakeWhatsappConfig[],
    afterCallbacks: [] as (() => Promise<void> | void)[],
  },
  dispatchWebhookEvent: vi.fn(),
}))

function accountIdForConversation(conversationId: string): string | undefined {
  return h.state.conversations.find((c) => c.id === conversationId)?.account_id
}
function accountIdForBroadcast(broadcastId: string): string | undefined {
  return h.state.broadcasts.find((b) => b.id === broadcastId)?.account_id
}

vi.mock('next/server', () => ({
  after: (cb: () => Promise<void> | void) => {
    h.state.afterCallbacks.push(cb)
  },
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ body, init }),
  },
}))

// A minimal, hand-rolled fake matching EXACTLY the query shapes
// handleStatusUpdate / resolveAccountIdForPhoneNumber issue — not a
// generic PostgREST emulator, so the mapping from mock to real query is
// easy to audit line by line.
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from(table: string) {
      if (table === 'whatsapp_config') {
        return {
          select: () => ({
            eq: (_col: 'phone_number_id', val: string) =>
              Promise.resolve({
                data: h.state.whatsappConfigs.filter(
                  (c) => c.phone_number_id === val,
                ),
                error: null,
              }),
          }),
        }
      }

      if (table === 'messages') {
        return {
          // Two shapes read this table:
          //   select('id, conversations!inner(account_id)').eq('message_id', X).eq('conversations.account_id', Y)
          //   select('conversation_id, conversations!inner(account_id)').eq('message_id', X).eq('conversations.account_id', Y).limit(1).maybeSingle()
          select: () => {
            const filters: Record<string, string> = {}
            const matches = () =>
              h.state.messages.filter((m) => {
                for (const [col, val] of Object.entries(filters)) {
                  if (col === 'conversations.account_id') {
                    if (accountIdForConversation(m.conversation_id) !== val) return false
                  } else if ((m as unknown as Record<string, unknown>)[col] !== val) {
                    return false
                  }
                }
                return true
              })
            const api = {
              eq: (col: string, val: string) => {
                filters[col] = val
                return api
              },
              limit: () => api,
              maybeSingle: () =>
                Promise.resolve({ data: matches()[0] ?? null, error: null }),
              then: (resolve: (v: unknown) => unknown) =>
                resolve({ data: matches(), error: null }),
            }
            return api
          },
          // update({...}).in('id', ids)  — the account-scoped mirror
          // update({...}).eq(col, val)   — not used post-fix, kept for safety
          update: (payload: Record<string, unknown>) => ({
            in: (col: string, ids: string[]) => {
              for (const m of h.state.messages) {
                if (col === 'id' && ids.includes(m.id)) Object.assign(m, payload)
              }
              return Promise.resolve({ data: null, error: null })
            },
            eq: (col: string, val: string) => {
              for (const m of h.state.messages) {
                if ((m as unknown as Record<string, unknown>)[col] === val) Object.assign(m, payload)
              }
              return Promise.resolve({ data: null, error: null })
            },
          }),
        }
      }

      if (table === 'broadcast_recipients') {
        return {
          // select('id, status, broadcasts!inner(account_id)').eq('whatsapp_message_id', X).eq('broadcasts.account_id', Y).maybeSingle()
          select: () => {
            const filters: Record<string, string> = {}
            const matches = () =>
              h.state.broadcastRecipients.filter((r) => {
                for (const [col, val] of Object.entries(filters)) {
                  if (col === 'broadcasts.account_id') {
                    if (accountIdForBroadcast(r.broadcast_id) !== val) return false
                  } else if ((r as unknown as Record<string, unknown>)[col] !== val) {
                    return false
                  }
                }
                return true
              })
            const api = {
              eq: (col: string, val: string) => {
                filters[col] = val
                return api
              },
              // Real Supabase `.maybeSingle()` (no `.limit(1)` upstream,
              // unlike the `messages` query below) errors — it does not
              // silently pick one — when more than one row matches. Model
              // that faithfully so an unscoped query that matches rows
              // across two accounts surfaces as a real failure here too,
              // not a lucky "first row wins" pass.
              maybeSingle: () => {
                const found = matches()
                if (found.length > 1) {
                  return Promise.resolve({
                    data: null,
                    error: { code: 'PGRST116', message: 'multiple rows returned' },
                  })
                }
                return Promise.resolve({ data: found[0] ?? null, error: null })
              },
            }
            return api
          },
          // update({...}).eq('id', recipientId)
          update: (payload: Record<string, unknown>) => ({
            eq: (col: string, val: string) => {
              for (const r of h.state.broadcastRecipients) {
                if ((r as unknown as Record<string, unknown>)[col] === val) Object.assign(r, payload)
              }
              return Promise.resolve({ data: null, error: null })
            },
          }),
        }
      }

      throw new Error(`unexpected table in status-update test fake: ${table}`)
    },
  }),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: () => 'plain-token',
  encrypt: (v: string) => v,
  isLegacyFormat: () => false,
}))
vi.mock('@/lib/whatsapp/meta-api', () => ({
  getMediaUrl: vi.fn(),
  downloadMedia: vi.fn(),
}))
vi.mock('@/lib/contacts/dedupe', () => ({
  findExistingContact: vi.fn(),
  isUniqueViolation: () => false,
}))
vi.mock('@/lib/whatsapp/webhook-signature', () => ({
  verifyMetaWebhookSignature: () => true,
}))
vi.mock('@/lib/whatsapp/template-webhook', () => ({
  isTemplateWebhookField: () => false,
  handleTemplateWebhookChange: vi.fn(),
}))
vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger: vi.fn(),
}))
vi.mock('@/lib/flows/engine', () => ({
  dispatchInboundToFlows: vi.fn(),
}))
vi.mock('@/lib/ai/auto-reply', () => ({
  dispatchInboundToAiReply: vi.fn(),
}))
vi.mock('@/lib/webhooks/deliver', () => ({
  dispatchWebhookEvent: h.dispatchWebhookEvent,
}))

import { POST } from './route'

// The mocked `NextResponse.json` above returns a plain `{ body, init }`
// object at runtime, but `POST`'s compile-time return type is the real
// `NextResponse` — read the mocked shape back out through an explicit
// cast rather than a property TypeScript doesn't know about.
function responseStatus(res: unknown): number | undefined {
  return (res as { init?: { status?: number } }).init?.status
}

function statusWebhookRequest(phoneNumberId: string, statuses: Array<Record<string, unknown>>) {
  const body = {
    entry: [
      {
        changes: [
          {
            field: 'messages',
            value: {
              metadata: { phone_number_id: phoneNumberId },
              statuses,
            },
          },
        ],
      },
    ],
  }
  return {
    text: async () => JSON.stringify(body),
    headers: { get: () => 'sha256=stub' },
  } as unknown as Request
}

async function runStatusWebhook(
  phoneNumberId: string,
  statuses: Array<Record<string, unknown>>,
) {
  const res = await POST(statusWebhookRequest(phoneNumberId, statuses))
  // Drain the after() callback exactly as the runtime would.
  for (const cb of h.state.afterCallbacks) await cb()
  return res
}

beforeEach(() => {
  vi.clearAllMocks()
  h.state.messages = []
  h.state.conversations = []
  h.state.broadcastRecipients = []
  h.state.broadcasts = []
  h.state.whatsappConfigs = []
  h.state.afterCallbacks = []
  h.dispatchWebhookEvent.mockResolvedValue(undefined)
})

describe('WhatsApp A3 — handleStatusUpdate is scoped to the receiving account', () => {
  it('1. legitimate status: message_id X on phone_number_id A updates A\'s message', async () => {
    h.state.whatsappConfigs = [{ account_id: 'acc-A', phone_number_id: 'pn-A' }]
    h.state.conversations = [{ id: 'conv-A', account_id: 'acc-A' }]
    h.state.messages = [
      { id: 'msg-A', message_id: 'wamid.SOLO', conversation_id: 'conv-A', status: 'sent' },
    ]

    const res = await runStatusWebhook('pn-A', [
      { id: 'wamid.SOLO', status: 'delivered', timestamp: '1700000000', recipient_id: '1' },
    ])

    expect(responseStatus(res) ?? 200).toBe(200)
    expect(h.state.messages.find((m) => m.id === 'msg-A')?.status).toBe('delivered')
  })

  it('2. collision: message_id X exists in both A and B — a status on phone_number_id A only updates A', async () => {
    h.state.whatsappConfigs = [
      { account_id: 'acc-A', phone_number_id: 'pn-A' },
      { account_id: 'acc-B', phone_number_id: 'pn-B' },
    ]
    h.state.conversations = [
      { id: 'conv-A', account_id: 'acc-A' },
      { id: 'conv-B', account_id: 'acc-B' },
    ]
    // Same Meta message_id landed in two different tenants' conversations
    // — the exact collision migration 037 documents as real.
    h.state.messages = [
      { id: 'msg-A', message_id: 'wamid.COLLIDE', conversation_id: 'conv-A', status: 'sent' },
      { id: 'msg-B', message_id: 'wamid.COLLIDE', conversation_id: 'conv-B', status: 'sent' },
    ]

    await runStatusWebhook('pn-A', [
      { id: 'wamid.COLLIDE', status: 'delivered', timestamp: '1700000000', recipient_id: '1' },
    ])

    expect(h.state.messages.find((m) => m.id === 'msg-A')?.status).toBe('delivered')
    // Account B's message with the SAME message_id must be untouched.
    expect(h.state.messages.find((m) => m.id === 'msg-B')?.status).toBe('sent')
  })

  it('3. broadcast collision: whatsapp_message_id X exists on recipients of both A and B — only A\'s recipient updates', async () => {
    h.state.whatsappConfigs = [
      { account_id: 'acc-A', phone_number_id: 'pn-A' },
      { account_id: 'acc-B', phone_number_id: 'pn-B' },
    ]
    h.state.broadcasts = [
      { id: 'bc-A', account_id: 'acc-A' },
      { id: 'bc-B', account_id: 'acc-B' },
    ]
    h.state.broadcastRecipients = [
      { id: 'rec-A', whatsapp_message_id: 'wamid.COLLIDE2', broadcast_id: 'bc-A', status: 'sent' },
      { id: 'rec-B', whatsapp_message_id: 'wamid.COLLIDE2', broadcast_id: 'bc-B', status: 'sent' },
    ]

    await runStatusWebhook('pn-A', [
      { id: 'wamid.COLLIDE2', status: 'delivered', timestamp: '1700000000', recipient_id: '1' },
    ])

    expect(h.state.broadcastRecipients.find((r) => r.id === 'rec-A')?.status).toBe('delivered')
    expect(h.state.broadcastRecipients.find((r) => r.id === 'rec-B')?.status).toBe('sent')
  })

  it('4. public webhook: on collision, message.status_updated is delivered to the correct account only', async () => {
    h.state.whatsappConfigs = [
      { account_id: 'acc-A', phone_number_id: 'pn-A' },
      { account_id: 'acc-B', phone_number_id: 'pn-B' },
    ]
    h.state.conversations = [
      { id: 'conv-A', account_id: 'acc-A' },
      { id: 'conv-B', account_id: 'acc-B' },
    ]
    h.state.messages = [
      { id: 'msg-A', message_id: 'wamid.COLLIDE3', conversation_id: 'conv-A', status: 'sent' },
      { id: 'msg-B', message_id: 'wamid.COLLIDE3', conversation_id: 'conv-B', status: 'sent' },
    ]

    await runStatusWebhook('pn-A', [
      { id: 'wamid.COLLIDE3', status: 'read', timestamp: '1700000000', recipient_id: '1' },
    ])

    expect(h.dispatchWebhookEvent).toHaveBeenCalledTimes(1)
    const [, deliveredAccountId, event, data] = h.dispatchWebhookEvent.mock.calls[0]
    expect(deliveredAccountId).toBe('acc-A')
    expect(deliveredAccountId).not.toBe('acc-B')
    expect(event).toBe('message.status_updated')
    expect(data).toMatchObject({ conversation_id: 'conv-A' })
  })

  it('5. no match: an unknown message_id updates nothing and never 500s', async () => {
    h.state.whatsappConfigs = [{ account_id: 'acc-A', phone_number_id: 'pn-A' }]
    h.state.conversations = [{ id: 'conv-A', account_id: 'acc-A' }]
    h.state.messages = [
      { id: 'msg-A', message_id: 'wamid.OTHER', conversation_id: 'conv-A', status: 'sent' },
    ]

    const res = await runStatusWebhook('pn-A', [
      { id: 'wamid.UNKNOWN', status: 'delivered', timestamp: '1700000000', recipient_id: '1' },
    ])

    expect(responseStatus(res) ?? 200).toBe(200)
    expect(h.state.messages.find((m) => m.id === 'msg-A')?.status).toBe('sent')
    expect(h.dispatchWebhookEvent).not.toHaveBeenCalled()
  })

  it('bonus: an unrecognized phone_number_id drops the status instead of guessing an account', async () => {
    h.state.whatsappConfigs = [{ account_id: 'acc-A', phone_number_id: 'pn-A' }]
    h.state.conversations = [{ id: 'conv-A', account_id: 'acc-A' }]
    h.state.messages = [
      { id: 'msg-A', message_id: 'wamid.SOLO2', conversation_id: 'conv-A', status: 'sent' },
    ]

    const res = await runStatusWebhook('pn-UNREGISTERED', [
      { id: 'wamid.SOLO2', status: 'delivered', timestamp: '1700000000', recipient_id: '1' },
    ])

    expect(responseStatus(res) ?? 200).toBe(200)
    expect(h.state.messages.find((m) => m.id === 'msg-A')?.status).toBe('sent')
    expect(h.dispatchWebhookEvent).not.toHaveBeenCalled()
  })
})
