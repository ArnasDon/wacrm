import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AiError, type AiConfig } from './types'
import { checkSharedRateLimit } from '@/lib/rate-limit'

// Shared, hoisted mock state so the module mocks can close over it.
const h = vi.hoisted(() => ({
  loadAiConfig: vi.fn(),
  buildConversationContext: vi.fn(),
  retrieveKnowledge: vi.fn(),
  loadCatalogContext: vi.fn(),
  loadQuickReplyContext: vi.fn(),
  loadClinicAppointmentContext: vi.fn(),
  transitionAppointment: vi.fn(),
  generateReply: vi.fn(),
  engineSendText: vi.fn(),
  moveDeal: vi.fn(),
  dispatchWebhookEvent: vi.fn(),
  dispatchSystemAlert: vi.fn().mockResolvedValue({ opened: false, notified: false, alertId: null }),
  resolveSystemAlert: vi.fn().mockResolvedValue(undefined),
  sendCatalogToConversation: vi.fn(),
  sendRestaurantMenuToConversation: vi.fn(),
  checkFreeBusy: vi.fn(),
  createEvent: vi.fn(),
  waitForQuietPeriod: vi.fn(),
  createQuote: vi.fn(),
  sendQuoteAsText: vi.fn(),
  sendQuoteToConversation: vi.fn(),
  sendQuoteByAccountPreference: vi.fn(),
  sendMessageToConversation: vi.fn(),
  state: {
    conv: null as Record<string, unknown> | null,
    claim: true as boolean,
    updatePayload: null as Record<string, unknown> | null,
    rpcCalls: [] as { name: string; args: unknown }[],
    openDeal: null as { id: string; pipeline_id: string; stage_id: string } | null,
    stages: [] as { id: string; name: string; is_won?: boolean }[],
    aiActionLogInserts: [] as Record<string, unknown>[],
    /** Prior successful `schedule_appointment` rows the idempotency guard reads back. */
    priorScheduleBookings: [] as { input: Record<string, unknown> }[],
    pipeline: null as { id: string } | null,
    contact: { lead_temperature: null as string | null, name: 'Juan Pérez', phone: '50255551234', email: null as string | null },
    account: { default_currency: 'USD' } as { default_currency: string; timezone?: string; catalog_delivery_mode?: string; industry_vertical?: string; restaurant_menu_url?: string | null },
    accountError: null as { code: string; message: string } | null,
    dealInserts: [] as Record<string, unknown>[],
    createdDeal: { id: 'new-deal-1', pipeline_id: 'pipe-1', stage_id: 'stage-a' } as Record<string, unknown>,
    contactUpdates: [] as Record<string, unknown>[],
    /** `google_calendar_config.status` — null means no row (not connected). */
    gcalStatus: null as string | null,
    /** `quick_replies` row the mocked resolution lookup returns, or null. */
    quickReplyRow: null as { id: string; content_text: string } | null,
    /** Account's active `products` rows, for the create_quote_chat item-matching
     *  and send_photo product-name lookups. */
    products: [] as { id: string; name: string; image_url?: string | null; image_urls?: string[] | null; category_id?: string | null }[],
    /** `reservation_requests` row `sendHotelBookingNudge`/`sendQuoteFollowUp`
     *  look up (the in-progress booking for this conversation/product), or
     *  null when there isn't one yet. */
    reservationRow: null as Record<string, unknown> | null,
    /** `product_categories.name` for whatever `category_id` a test's
     *  product carries — feeds `sendHotelBookingNudge`'s cold-start path. */
    productCategoryName: null as string | null,
    /** Rows inserted via `db.from('messages').insert(...)` — currently only handOffToHuman's internal note. */
    messageInserts: [] as Record<string, unknown>[],
    /** `messages` read for `tryRecoverTransientHandoff` — a human's own
     *  reply after the handoff, or null (nobody engaged → recover). */
    humanMsgAfterHandoff: null as { id: string } | null,
    convFullSelectError: false,
    /** Rows `tryRecoverTransientHandoff`'s guarded UPDATE ... .select('id') returns. */
    recoveryUpdateRows: [{ id: 'conv-1' }] as { id: string }[],
  },
}))

vi.mock('@/lib/google-calendar/api', () => ({
  checkFreeBusy: h.checkFreeBusy,
  createEvent: h.createEvent,
  APPOINTMENT_LOOKAHEAD_MS: 7 * 24 * 60 * 60 * 1000,
}))

// Resolves instantly and "wins" by default so every existing test below
// exercises the real eligibility/send logic unchanged — the handful of
// debounce-specific tests override this per-case.
vi.mock('./debounce', () => ({ waitForQuietPeriod: h.waitForQuietPeriod }))
vi.mock('./config', () => ({ loadAiConfig: h.loadAiConfig }))
vi.mock('./context', () => ({ buildConversationContext: h.buildConversationContext }))
vi.mock('./knowledge', () => ({ retrieveKnowledge: h.retrieveKnowledge }))
vi.mock('./catalog-context', () => ({ loadCatalogContext: h.loadCatalogContext }))
vi.mock('./quick-reply-context', () => ({ loadQuickReplyContext: h.loadQuickReplyContext }))
vi.mock('@/lib/clinic/appointment-context', () => ({
  loadClinicAppointmentContext: h.loadClinicAppointmentContext,
}))
vi.mock('@/lib/clinic/appointments', () => ({
  transitionAppointment: h.transitionAppointment,
}))
// Only `generateReply` is stubbed — `isRetryableAiError` (used by the
// dispatch's one-retry wrapper) keeps its real implementation.
vi.mock('./generate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./generate')>()
  return { ...actual, generateReply: h.generateReply }
})
vi.mock('@/lib/observability/alerts', () => ({
  dispatchSystemAlert: h.dispatchSystemAlert,
  resolveSystemAlert: h.resolveSystemAlert,
}))
vi.mock('@/lib/flows/meta-send', () => ({ engineSendText: h.engineSendText }))
vi.mock('@/lib/webhooks/deliver', () => ({ dispatchWebhookEvent: h.dispatchWebhookEvent }))
vi.mock('@/lib/quotes/create-quote', () => ({
  createQuote: h.createQuote,
  CreateQuoteError: class CreateQuoteError extends Error {
    status: number
    constructor(message: string, status = 400) {
      super(message)
      this.status = status
    }
  },
}))
vi.mock('@/lib/quotes/send-quote', () => ({
  sendQuoteAsText: h.sendQuoteAsText,
  sendQuoteToConversation: h.sendQuoteToConversation,
  sendQuoteByAccountPreference: h.sendQuoteByAccountPreference,
  SendQuoteError: class SendQuoteError extends Error {
    status: number
    constructor(message: string, status = 400) {
      super(message)
      this.status = status
    }
  },
}))
vi.mock('@/lib/whatsapp/send-message', () => ({
  sendMessageToConversation: h.sendMessageToConversation,
  SendMessageError: class SendMessageError extends Error {
    status: number
    constructor(code: string, message: string, status = 400) {
      super(message)
      this.status = status
    }
  },
}))
vi.mock('@/lib/pipelines/move-deal', () => ({
  moveDeal: h.moveDeal,
  MoveDealError: class MoveDealError extends Error {
    status: number
    constructor(message: string, status = 400) {
      super(message)
      this.status = status
    }
  },
}))
vi.mock('@/lib/products/send-catalog', () => ({
  sendCatalogToConversation: h.sendCatalogToConversation,
  SendCatalogError: class SendCatalogError extends Error {
    status: number
    constructor(message: string, status = 400) {
      super(message)
      this.status = status
    }
  },
}))
vi.mock('@/lib/products/send-restaurant-menu', () => ({
  sendRestaurantMenuToConversation: h.sendRestaurantMenuToConversation,
  SendRestaurantMenuError: class SendRestaurantMenuError extends Error {
    status: number
    constructor(message: string, status = 400) {
      super(message)
      this.status = status
    }
  },
}))
// The real limiter is an in-memory counter shared across every test in
// this file (same accountId) — mocked so the growing number of tests
// here can't tip a shared counter over the real 30/min cap and start
// skipping later tests. One focused test overrides the next result to
// verify that an exhausted account does not leave its customer silent.
vi.mock('@/lib/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/rate-limit')>()
  return { ...actual, checkSharedRateLimit: vi.fn().mockResolvedValue({ success: true }) }
})

// `.select().eq().eq().order()` (or without `.order()`) → a multi-row
// select, resolved lazily whenever the chain is awaited (every step
// returns the same thenable chain, so it doesn't matter which call is
// last — mirrors how the real supabase-js query builder is itself a
// thenable, no separate terminal call required for a plain select-many).
function selectManyChain(getData: () => unknown) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    order: () => chain,
    then: (resolve: (v: { data: unknown; error: null }) => void) =>
      resolve({ data: getData(), error: null }),
  }
  return chain
}

vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'deals') {
        // .select().eq().eq().eq().order().limit().maybeSingle() → most
        // recently updated open deal for the contact.
        const readChain = {
          select: () => readChain,
          eq: () => readChain,
          order: () => readChain,
          limit: () => readChain,
          maybeSingle: () => Promise.resolve({ data: h.state.openDeal, error: null }),
        }
        return {
          ...readChain,
          // .insert(payload).select().single() → autonomous deal creation
          // when the contact has no open deal yet.
          insert: (payload: Record<string, unknown>) => {
            h.state.dealInserts.push(payload)
            const insertChain = {
              select: () => insertChain,
              single: () => Promise.resolve({ data: h.state.createdDeal, error: null }),
            }
            return insertChain
          },
        }
      }
      if (table === 'pipelines') {
        // .select('id').eq().order().limit().maybeSingle() → account's
        // default (oldest) pipeline.
        const chain = {
          select: () => chain,
          eq: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: () => Promise.resolve({ data: h.state.pipeline, error: null }),
        }
        return chain
      }
      if (table === 'pipeline_stages') {
        return selectManyChain(() => h.state.stages)
      }
      if (table === 'ai_action_log') {
        // Read path: autoScheduleAppointment's idempotency guard does
        // .select('input').eq().eq().eq().order().limit(20) → prior
        // successful schedule_appointment rows for the contact.
        const readChain = {
          select: () => readChain,
          eq: () => readChain,
          order: () => readChain,
          limit: () =>
            Promise.resolve({ data: h.state.priorScheduleBookings ?? [], error: null }),
        }
        return {
          ...readChain,
          insert: (payload: Record<string, unknown>) => {
            h.state.aiActionLogInserts.push(payload)
            return Promise.resolve({ data: null, error: null })
          },
        }
      }
      if (table === 'contacts') {
        // .select('lead_temperature' | 'name, phone').eq()...maybeSingle()
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: () => Promise.resolve({ data: h.state.contact, error: null }),
        }
        return {
          ...chain,
          update: (payload: Record<string, unknown>) => {
            h.state.contactUpdates.push(payload)
            const updateChain = { eq: () => updateChain }
            return updateChain
          },
        }
      }
      if (table === 'google_calendar_config') {
        // .select('status').eq('account_id', ...).maybeSingle()
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: () =>
            Promise.resolve({
              data: h.state.gcalStatus ? { status: h.state.gcalStatus } : null,
              error: null,
            }),
        }
        return chain
      }
      if (table === 'accounts') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: h.state.account, error: h.state.accountError }),
            }),
          }),
        }
      }
      if (table === 'quick_replies') {
        // .select('id, content_text').eq('id', ...).eq('account_id', ...).eq('kind', 'text').maybeSingle()
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: () => Promise.resolve({ data: h.state.quickReplyRow, error: null }),
        }
        return chain
      }
      if (table === 'products') {
        // .select('id, name').eq('account_id', ...).eq('is_active', true) → thenable
        // AND .select('category_id').eq('id', ...).maybeSingle() → sendHotelBookingNudge's cold-start lookup.
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          then: (onFulfilled: (v: unknown) => unknown) =>
            Promise.resolve({ data: h.state.products, error: null }).then(onFulfilled),
          maybeSingle: () =>
            Promise.resolve({
              data: h.state.products[0] ? { category_id: h.state.products[0].category_id ?? null } : null,
              error: null,
            }),
        }
        return chain
      }
      if (table === 'product_categories') {
        // .select('name').eq('id', ...).maybeSingle()
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: () =>
            Promise.resolve({
              data: h.state.productCategoryName ? { name: h.state.productCategoryName } : null,
              error: null,
            }),
        }
        return chain
      }
      if (table === 'reservation_requests') {
        // .select(...).eq(...).eq(...).eq(...).eq(...).maybeSingle() →
        // sendHotelBookingNudge's own-product lookup.
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: () => Promise.resolve({ data: h.state.reservationRow, error: null }),
        }
        return chain
      }
      if (table === 'messages') {
        // handOffToHuman's best-effort internal-note insert +
        // tryRecoverTransientHandoff's "did a human reply?" read.
        const readChain = {
          select: () => readChain,
          eq: () => readChain,
          neq: () => readChain,
          gt: () => readChain,
          limit: () => readChain,
          maybeSingle: () =>
            Promise.resolve({ data: h.state.humanMsgAfterHandoff, error: null }),
        }
        return {
          ...readChain,
          insert: (payload: Record<string, unknown>) => {
            h.state.messageInserts.push(payload)
            return Promise.resolve({ error: null })
          },
        }
      }
      // conversations
      return {
        select: (cols: string) => ({
          eq: () => ({
            maybeSingle: () => {
              // Simulate "code deployed ahead of its migration": the full
              // eligibility select (which names the newest column) 42703s,
              // the stable-columns retry succeeds.
              if (
                h.state.convFullSelectError &&
                cols.includes('ai_flow_directive')
              ) {
                return Promise.resolve({
                  data: null,
                  error: { code: '42703', message: 'column c.ai_flow_directive does not exist' },
                })
              }
              return Promise.resolve({ data: h.state.conv, error: null })
            },
          }),
        }),
        update: (payload: Record<string, unknown>) => {
          h.state.updatePayload = payload
          // Chainable + thenable: `handOffToHuman` awaits `.update().eq()`
          // (→ { error }); `tryRecoverTransientHandoff` does
          // `.update().eq().eq().select('id')` (→ { data: rows }).
          const chain: Record<string, unknown> = {
            eq: () => chain,
            select: () =>
              Promise.resolve({ data: h.state.recoveryUpdateRows, error: null }),
            then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
              Promise.resolve({ error: null }).then(onF, onR),
          }
          return chain
        },
      }
    },
    rpc: (name: string, args: unknown) => {
      h.state.rpcCalls.push({ name, args })
      return Promise.resolve({ data: h.state.claim, error: null })
    },
  }),
}))

import { dispatchInboundToAiReply } from './auto-reply'
import { SendCatalogError } from '@/lib/products/send-catalog'

const ARGS = {
  accountId: 'acct-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  configOwnerUserId: 'user-1',
}

function aiConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: true,
    autoReplyMaxPerConversation: 3,
    autoScheduleAppointmentsEnabled: false,
    askCustomerTaxInfo: false,
    handoffAgentId: null,
    embeddingsApiKey: null,
    ...overrides,
  }
}

beforeEach(() => {
  h.state.conv = {
    assigned_agent_id: null,
    ai_autoreply_disabled: false,
    ai_reply_count: 0,
    ai_handoff_transient: null,
    ai_handoff_at: null,
  }
  h.state.humanMsgAfterHandoff = null
  h.state.convFullSelectError = false
  h.state.recoveryUpdateRows = [{ id: 'conv-1' }]
  h.state.claim = true
  h.state.updatePayload = null
  h.state.rpcCalls = []
  h.state.openDeal = null
  h.state.stages = []
  h.state.aiActionLogInserts = []
  h.state.pipeline = null
  h.state.contact = { lead_temperature: null, name: 'Juan Pérez', phone: '50255551234', email: null }
  h.state.account = { default_currency: 'USD' }
  h.state.accountError = null
  h.state.dealInserts = []
  h.state.createdDeal = { id: 'new-deal-1', pipeline_id: 'pipe-1', stage_id: 'stage-a' }
  h.state.contactUpdates = []
  h.state.gcalStatus = null
  h.state.priorScheduleBookings = []
  h.state.quickReplyRow = null
  h.state.products = []
  h.state.reservationRow = null
  h.state.productCategoryName = null
  h.state.messageInserts = []
  h.createQuote.mockReset()
  h.sendQuoteAsText.mockReset().mockResolvedValue(undefined)
  h.sendQuoteToConversation.mockReset().mockResolvedValue(undefined)
  h.sendQuoteByAccountPreference.mockReset().mockResolvedValue({ mode: 'message', pdfUrl: null })
  h.sendMessageToConversation.mockReset().mockResolvedValue({ messageId: 'm1', whatsappMessageId: 'wamid1' })
  h.checkFreeBusy.mockReset().mockResolvedValue([])
  h.createEvent.mockReset().mockResolvedValue({ eventId: 'evt-1', htmlLink: 'https://calendar.google.com/evt-1', meetLink: 'https://meet.google.com/abc' })
  h.waitForQuietPeriod.mockReset().mockResolvedValue(true)
  h.loadAiConfig.mockResolvedValue(aiConfig())
  h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'hi' }])
  h.retrieveKnowledge.mockResolvedValue([])
  h.loadCatalogContext.mockResolvedValue(null)
  h.loadQuickReplyContext.mockResolvedValue(null)
  h.loadClinicAppointmentContext.mockResolvedValue(null)
  h.transitionAppointment.mockResolvedValue({
    ok: true,
    appointment: { id: 'appt-clinic-1', status: 'CONFIRMED' },
  })
  h.generateReply.mockResolvedValue({
    text: 'Hello!',
    handoff: false,
    markDealWon: false,
    moveToStageName: null,
    sendCatalog: false,
    sendRestaurantMenu: false,
  })
  h.engineSendText.mockResolvedValue({ whatsapp_message_id: 'm1' })
  h.moveDeal.mockResolvedValue({
    deal: { id: 'deal-1', pipeline_id: 'pipe-1', stage_id: 'stage-b', status: 'open' },
    isWonStage: false,
  })
  h.dispatchWebhookEvent.mockResolvedValue(undefined)
  h.sendCatalogToConversation.mockResolvedValue({ catalogUrl: 'https://example.com/catalog/acct-1' })
  h.sendRestaurantMenuToConversation.mockReset().mockResolvedValue(undefined)
})

describe('dispatchInboundToAiReply — debounce', () => {
  it('does nothing when superseded by a newer inbound before the quiet period elapses', async () => {
    h.waitForQuietPeriod.mockResolvedValue(false)
    await dispatchInboundToAiReply(ARGS)
    expect(h.loadAiConfig).not.toHaveBeenCalled()
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('waits for its conversation specifically', async () => {
    await dispatchInboundToAiReply(ARGS)
    expect(h.waitForQuietPeriod).toHaveBeenCalledWith('conv-1')
  })
})

describe('dispatchInboundToAiReply — eligibility gates', () => {
  it('claims a slot and sends on the happy path', async () => {
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.rpcCalls).toEqual([
      {
        name: 'claim_ai_reply_slot',
        args: { conversation_id: 'conv-1', max_replies: 3 },
      },
    ])
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1', text: 'Hello!' }),
    )
  })

  it('grounds the reply in retrieved knowledge', async () => {
    h.retrieveKnowledge.mockResolvedValue(['Returns accepted within 30 days.'])
    await dispatchInboundToAiReply(ARGS)
    expect(h.retrieveKnowledge).toHaveBeenCalled()
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).toContain('Returns accepted within 30 days.')
  })

  it('never stands down for automations — Angel\'s explicit product decision (2026-08-19): the AI must always reply regardless of what automations exist on the account', async () => {
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).toHaveBeenCalled()
    expect(h.engineSendText).toHaveBeenCalled()
  })

  it('does not send when the atomic slot claim loses the race', async () => {
    h.state.claim = false
    await dispatchInboundToAiReply(ARGS)
    // It still attempts the claim, but the send is skipped.
    expect(h.state.rpcCalls).toHaveLength(1)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('keeps replying in DEGRADED mode when the eligibility select 42703s (column deployed ahead of its migration)', async () => {
    h.state.convFullSelectError = true
    await dispatchInboundToAiReply(ARGS)
    // The stable-columns retry carried the eligibility check, so the bot
    // still generated and sent a reply instead of going account-wide silent.
    expect(h.generateReply).toHaveBeenCalled()
    expect(h.engineSendText).toHaveBeenCalled()
  })

  it('skips when AI is off / not configured', async () => {
    h.loadAiConfig.mockResolvedValue(null)
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when auto-reply is disabled for the account', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoReplyEnabled: false }))
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when a human agent is assigned', async () => {
    h.state.conv = {
      assigned_agent_id: 'agent-9',
      ai_autoreply_disabled: false,
      ai_reply_count: 0,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when auto-reply was disabled on this conversation', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: true,
      ai_reply_count: 0,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('hands off instead of going silent when the per-conversation cap is reached', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: false,
      ai_reply_count: 3,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('dificultad temporal') }),
    )
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
    expect(h.state.updatePayload?.ai_handoff_summary).toContain('límite de')
  })

  it('alerts (critical) when even the continuity fallback message itself fails to send', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: false,
      ai_reply_count: 3,
    }
    h.engineSendText.mockRejectedValueOnce(new Error('channel down'))

    await expect(dispatchInboundToAiReply(ARGS)).resolves.toBeUndefined()

    expect(h.dispatchSystemAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'critical',
        source: 'ai_dispatch_error',
        dedupKey: 'ai_fallback_send_failed:acct-1',
      }),
    )
    // The handoff itself must still happen — the fallback failing to
    // send is not a reason to leave the bot stuck replying forever.
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
  })

  it('sends a deterministic fallback when the account-wide AI limit is reached', async () => {
    vi.mocked(checkSharedRateLimit).mockResolvedValueOnce({
      success: false,
      remaining: 0,
      reset: Date.now() + 60_000,
      limit: 30,
    })

    await dispatchInboundToAiReply(ARGS)

    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('dificultad temporal') }),
    )
    expect(h.state.updatePayload).toMatchObject({
      ai_autoreply_disabled: true,
      ai_handoff_transient: true,
    })
    expect(h.state.updatePayload?.ai_handoff_summary).toContain('límite de generación')
  })

  it('skips when there is nothing to reply to', async () => {
    h.buildConversationContext.mockResolvedValue([])
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('stands down without calling the model when a racing dispatch already answered (2026-09-03/04 incident)', async () => {
    // The newest message is the bot's own reply, not the customer's —
    // the signal that an earlier debounced dispatch for this same
    // burst already ran and answered. Regenerating here risks a
    // duplicate reply; erroring risks an unnecessary handoff (Anthropic
    // 400s a transcript that doesn't end on `user`, unretryable).
    h.buildConversationContext.mockResolvedValue([
      { role: 'user', content: 'Se dedica a dar créditos' },
      { role: 'assistant', content: '¡Buenos días! Contame más...' },
    ])
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.state.updatePayload).toBeNull()
  })
})

describe('dispatchInboundToAiReply — handoff', () => {
  it('disables auto-reply, writes a summary, and does not send on handoff', async () => {
    h.generateReply.mockResolvedValue({ text: '', handoff: true, markDealWon: false, moveToStageName: null })
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.state.rpcCalls).toHaveLength(0)
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
    expect(h.state.updatePayload?.ai_handoff_summary).toContain(
      'La IA transfirió la conversación',
    )
    // No handoff target configured → conversation left unassigned.
    expect(h.state.updatePayload).not.toHaveProperty('assigned_agent_id')
  })

  it('routes to the configured handoff agent on handoff', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ handoffAgentId: 'agent-7' }))
    h.generateReply.mockResolvedValue({ text: '', handoff: true, markDealWon: false, moveToStageName: null })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).toMatchObject({
      ai_autoreply_disabled: true,
      assigned_agent_id: 'agent-7',
    })
  })

  it('leaves an internal_note message in the thread explaining the handoff, matching the banner summary (migration 083)', async () => {
    h.generateReply.mockResolvedValue({ text: '', handoff: true, markDealWon: false, moveToStageName: null })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.messageInserts).toEqual([
      expect.objectContaining({
        conversation_id: 'conv-1',
        sender_type: 'bot',
        content_type: 'internal_note',
        content_text: h.state.updatePayload?.ai_handoff_summary,
      }),
    ])
  })

  it('an EXPLICIT handoff is not transient — the flag is cleared, no auto-recovery', async () => {
    h.generateReply.mockResolvedValue({ text: '', handoff: true, markDealWon: false, moveToStageName: null })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload?.ai_handoff_transient).toBeNull()
  })

  it('the reply-cap handoff IS marked transient', async () => {
    h.state.conv = { assigned_agent_id: null, ai_autoreply_disabled: false, ai_reply_count: 3 }
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).toMatchObject({
      ai_autoreply_disabled: true,
      ai_handoff_transient: true,
    })
  })
})

describe('dispatchInboundToAiReply — transient-handoff auto-recovery', () => {
  const OLD = new Date(Date.now() - 60 * 60_000).toISOString() // 60 min ago
  const RECENT = new Date(Date.now() - 5 * 60_000).toISOString() // 5 min ago

  it('resets a capped conversation so recovery does not immediately pause it again', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: true,
      ai_reply_count: 3,
      ai_handoff_transient: true,
      ai_handoff_at: OLD,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).toHaveBeenCalled()
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Hello!' }),
    )
  })

  it('re-enables the bot and replies when the grace period passed and no human engaged', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: true,
      ai_reply_count: 0,
      ai_handoff_transient: true,
      ai_handoff_at: OLD,
    }
    await dispatchInboundToAiReply(ARGS)
    // first update = the recovery (re-enable + consume the flag)
    expect(h.state.updatePayload).toMatchObject({
      ai_autoreply_disabled: false,
      ai_handoff_transient: null,
      ai_reply_count: 0,
    })
    expect(h.engineSendText).toHaveBeenCalled()
  })

  it('does NOT recover before the grace period', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: true,
      ai_reply_count: 0,
      ai_handoff_transient: true,
      ai_handoff_at: RECENT,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).toBeNull()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('does NOT recover when a human already replied after the handoff', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: true,
      ai_reply_count: 0,
      ai_handoff_transient: true,
      ai_handoff_at: OLD,
    }
    h.state.humanMsgAfterHandoff = { id: 'msg-agent-1' }
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).toBeNull()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('does NOT recover a non-transient (explicit) handoff', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: true,
      ai_reply_count: 0,
      ai_handoff_transient: null,
      ai_handoff_at: OLD,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).toBeNull()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('does NOT recover if the guarded UPDATE matched no row (a concurrent explicit handoff won)', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: true,
      ai_reply_count: 0,
      ai_handoff_transient: true,
      ai_handoff_at: OLD,
    }
    h.state.recoveryUpdateRows = [] // update matched nothing
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })
})

describe('dispatchInboundToAiReply — provider failure handling', () => {
  // Keep the retry instant so these cases don't each sleep the real
  // backoff, and pin the retry count so the assertions are exact.
  beforeEach(() => {
    process.env.AI_AUTOREPLY_RETRY_DELAY_MS = '0'
    process.env.AI_AUTOREPLY_MAX_RETRIES = '2'
  })
  afterEach(() => {
    delete process.env.AI_AUTOREPLY_RETRY_DELAY_MS
    delete process.env.AI_AUTOREPLY_MAX_RETRIES
  })

  it('retries a transient provider error, then sends the recovered reply', async () => {
    h.generateReply
      .mockRejectedValueOnce(new AiError('overloaded', { code: 'provider_error' }))
      .mockResolvedValueOnce({
        text: 'Recuperado!',
        handoff: false,
        markDealWon: false,
        moveToStageName: null,
        sendCatalog: false,
      })

    await dispatchInboundToAiReply(ARGS)

    expect(h.generateReply).toHaveBeenCalledTimes(2)
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Recuperado!' }),
    )
    // A recovered call must not also trip the failure handoff.
    expect(h.state.updatePayload).toBeNull()
  })

  it('hands off to a human when a transient provider error outlives every retry', async () => {
    h.generateReply.mockRejectedValue(new AiError('529 overloaded', { code: 'provider_error' }))

    await dispatchInboundToAiReply(ARGS)

    expect(h.generateReply).toHaveBeenCalledTimes(3) // 1 initial + 2 retries
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('dificultad temporal') }),
    )
    expect(h.state.rpcCalls).toHaveLength(0) // never claimed a reply slot
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
    expect(h.state.updatePayload?.ai_handoff_summary).toContain('error temporal')
    // …and leaves the matching internal note in the thread.
    expect(h.state.messageInserts).toEqual([
      expect.objectContaining({
        content_type: 'internal_note',
        content_text: h.state.updatePayload?.ai_handoff_summary,
      }),
    ])
  })

  it('routes the failure handoff to the configured agent', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ handoffAgentId: 'agent-7' }))
    h.generateReply.mockRejectedValue(new AiError('timed out', { code: 'timeout' }))

    await dispatchInboundToAiReply(ARGS)

    expect(h.state.updatePayload).toMatchObject({
      ai_autoreply_disabled: true,
      assigned_agent_id: 'agent-7',
    })
  })

  it('does not retry, but sends a deterministic fallback and hands off on an invalid-key error', async () => {
    h.generateReply.mockRejectedValue(new AiError('rejected', { code: 'invalid_key' }))

    await dispatchInboundToAiReply(ARGS)

    expect(h.generateReply).toHaveBeenCalledTimes(1)
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('dificultad temporal') }),
    )
    expect(h.state.updatePayload).toMatchObject({
      ai_autoreply_disabled: true,
      ai_handoff_transient: true,
    })
  })

  it('never throws out of dispatch even when generation keeps failing', async () => {
    h.generateReply.mockRejectedValue(new AiError('boom', { code: 'network_error' }))
    await expect(dispatchInboundToAiReply(ARGS)).resolves.toBeUndefined()
  })
})

describe('dispatchInboundToAiReply — deal-stage prompt context', () => {
  it('tells the model the current stage and the other non-won stages it can move to', async () => {
    h.state.openDeal = { id: 'deal-1', pipeline_id: 'pipe-1', stage_id: 'stage-a' }
    h.state.stages = [
      { id: 'stage-a', name: 'Cotización' },
      { id: 'stage-b', name: 'Negociación' },
      { id: 'stage-c', name: 'Convencimiento' },
    ]
    await dispatchInboundToAiReply(ARGS)
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).toContain('"Cotización"')
    expect(systemPrompt).toContain('"Negociación"')
    expect(systemPrompt).toContain('"Convencimiento"')
  })

  it('says nothing about stage options when the contact has no open deal and no pipeline is configured', async () => {
    h.state.openDeal = null
    h.state.pipeline = null
    await dispatchInboundToAiReply(ARGS)
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).not.toContain('ACTION:move_deal')
  })

  it('offers the default pipeline\'s stages to create a deal into when the contact has none yet', async () => {
    h.state.openDeal = null
    h.state.pipeline = { id: 'pipe-1' }
    h.state.stages = [
      { id: 'stage-a', name: 'Cotización' },
      { id: 'stage-b', name: 'Negociación' },
    ]
    await dispatchInboundToAiReply(ARGS)
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).toContain('does not have a deal yet')
    expect(systemPrompt).toContain('"Cotización"')
    expect(systemPrompt).toContain('"Negociación"')
  })

  it('says nothing about stage options when the deal has no other stage to offer', async () => {
    h.state.openDeal = { id: 'deal-1', pipeline_id: 'pipe-1', stage_id: 'stage-a' }
    h.state.stages = [{ id: 'stage-a', name: 'Cotización' }]
    await dispatchInboundToAiReply(ARGS)
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).not.toContain('ACTION:move_deal')
  })

  it('excludes a non-won stage positioned after the won stage (e.g. a post-sale "delivery follow-up" stage)', async () => {
    h.state.openDeal = { id: 'deal-1', pipeline_id: 'pipe-1', stage_id: 'stage-a' }
    h.state.stages = [
      { id: 'stage-a', name: 'Cotización', is_won: false },
      { id: 'stage-b', name: 'Convencimiento', is_won: false },
      { id: 'stage-c', name: 'Venta cerrada', is_won: true },
      { id: 'stage-d', name: 'Seguimiento entrega', is_won: false },
    ]
    await dispatchInboundToAiReply(ARGS)
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).toContain('"Convencimiento"')
    expect(systemPrompt).not.toContain('Seguimiento entrega')
  })
})

describe('dispatchInboundToAiReply — purchase confirmation hands off to close', () => {
  it('pauses the bot, assigns the handoff agent, and logs flag_deal_closing — never touches the deal', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ handoffAgentId: 'agent-7' }))
    h.generateReply.mockResolvedValue({
      text: 'All set, thanks!',
      handoff: false,
      markDealWon: true,
      moveToStageName: null,
    })

    await dispatchInboundToAiReply(ARGS)

    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'All set, thanks!' }),
    )
    expect(h.state.updatePayload).toMatchObject({
      ai_autoreply_disabled: true,
      assigned_agent_id: 'agent-7',
    })
    expect(h.moveDeal).not.toHaveBeenCalled()
    expect(h.state.aiActionLogInserts).toEqual([
      expect.objectContaining({
        account_id: 'acct-1',
        actor_user_id: 'user-1',
        action: 'flag_deal_closing',
        target_id: 'conv-1',
        input: { source: 'auto_reply_autonomous' },
      }),
    ])
  })

  it('leaves the conversation unassigned when no handoff agent is configured', async () => {
    h.generateReply.mockResolvedValue({
      text: 'All set!',
      handoff: false,
      markDealWon: true,
      moveToStageName: null,
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).not.toHaveProperty('assigned_agent_id')
    expect(h.state.aiActionLogInserts).toHaveLength(1)
  })

  it('does not touch any deal when the model does not signal confirmation', async () => {
    h.state.openDeal = { id: 'deal-1', pipeline_id: 'pipe-1', stage_id: 'stage-a' }
    await dispatchInboundToAiReply(ARGS) // default mock: markDealWon: false
    expect(h.moveDeal).not.toHaveBeenCalled()
    expect(h.state.aiActionLogInserts).toEqual([])
  })
})

describe('dispatchInboundToAiReply — autonomous move_deal', () => {
  it('advances the deal to the named stage and logs it', async () => {
    h.state.openDeal = { id: 'deal-1', pipeline_id: 'pipe-1', stage_id: 'stage-a' }
    h.state.stages = [
      { id: 'stage-a', name: 'Cotización' },
      { id: 'stage-b', name: 'Negociación' },
    ]
    h.generateReply.mockResolvedValue({
      text: 'Perfecto, seguimos.',
      handoff: false,
      markDealWon: false,
      moveToStageName: 'Negociación',
    })

    await dispatchInboundToAiReply(ARGS)

    expect(h.moveDeal).toHaveBeenCalledWith(expect.anything(), 'acct-1', 'deal-1', 'stage-b')
    expect(h.state.aiActionLogInserts).toEqual([
      expect.objectContaining({
        account_id: 'acct-1',
        actor_user_id: 'user-1',
        action: 'move_deal',
        target_id: 'deal-1',
        input: { stageId: 'stage-b', stageName: 'Negociación', source: 'auto_reply_autonomous' },
      }),
    ])
    expect(h.dispatchWebhookEvent).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      'deal.stage_changed',
      expect.objectContaining({ deal_id: 'deal-1', source: 'auto_reply_autonomous' }),
    )
  })

  it('matches the stage name case-insensitively', async () => {
    h.state.openDeal = { id: 'deal-1', pipeline_id: 'pipe-1', stage_id: 'stage-a' }
    h.state.stages = [
      { id: 'stage-a', name: 'Cotización' },
      { id: 'stage-b', name: 'Negociación' },
    ]
    h.generateReply.mockResolvedValue({
      text: 'ok',
      handoff: false,
      markDealWon: false,
      moveToStageName: 'negociación',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.moveDeal).toHaveBeenCalledWith(expect.anything(), 'acct-1', 'deal-1', 'stage-b')
  })

  it('does nothing when the named stage does not match any of the pipeline\'s non-won stages', async () => {
    h.state.openDeal = { id: 'deal-1', pipeline_id: 'pipe-1', stage_id: 'stage-a' }
    h.state.stages = [{ id: 'stage-a', name: 'Cotización' }]
    h.generateReply.mockResolvedValue({
      text: 'ok',
      handoff: false,
      markDealWon: false,
      moveToStageName: 'Etapa inventada',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.moveDeal).not.toHaveBeenCalled()
    expect(h.state.aiActionLogInserts).toEqual([])
  })

  it('refuses to move into a post-sale stage even if the model names it exactly', async () => {
    h.state.openDeal = { id: 'deal-1', pipeline_id: 'pipe-1', stage_id: 'stage-a' }
    h.state.stages = [
      { id: 'stage-a', name: 'Cotización', is_won: false },
      { id: 'stage-c', name: 'Venta cerrada', is_won: true },
      { id: 'stage-d', name: 'Seguimiento entrega', is_won: false },
    ]
    h.generateReply.mockResolvedValue({
      text: 'ok',
      handoff: false,
      markDealWon: false,
      moveToStageName: 'Seguimiento entrega',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.moveDeal).not.toHaveBeenCalled()
    expect(h.state.aiActionLogInserts).toEqual([])
  })

  it('does nothing when the named stage is already the deal\'s current stage', async () => {
    h.state.openDeal = { id: 'deal-1', pipeline_id: 'pipe-1', stage_id: 'stage-a' }
    h.state.stages = [
      { id: 'stage-a', name: 'Cotización' },
      { id: 'stage-b', name: 'Negociación' },
    ]
    h.generateReply.mockResolvedValue({
      text: 'ok',
      handoff: false,
      markDealWon: false,
      moveToStageName: 'Cotización',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.moveDeal).not.toHaveBeenCalled()
  })

  it('creates a deal at the named stage instead of moving one, when the contact has no open deal', async () => {
    h.generateReply.mockResolvedValue({
      text: 'Sure thing!',
      handoff: false,
      markDealWon: false,
      moveToStageName: 'Negociación',
    })
    h.state.openDeal = null
    h.state.pipeline = { id: 'pipe-1' }
    h.state.stages = [
      { id: 'stage-a', name: 'Cotización' },
      { id: 'stage-b', name: 'Negociación' },
    ]

    await dispatchInboundToAiReply(ARGS)

    expect(h.engineSendText).toHaveBeenCalled()
    expect(h.moveDeal).not.toHaveBeenCalled()
    expect(h.state.dealInserts).toHaveLength(1)
    expect(h.state.dealInserts[0]).toMatchObject({
      account_id: 'acct-1',
      pipeline_id: 'pipe-1',
      stage_id: 'stage-b',
      contact_id: 'contact-1',
      title: 'Juan Pérez',
      value: 0,
      currency: 'USD',
      status: 'open',
    })
    expect(h.state.aiActionLogInserts).toEqual([
      expect.objectContaining({ action: 'create_deal', target_id: 'new-deal-1' }),
    ])
  })

  it('swallows a moveDeal failure — the already-sent reply is unaffected', async () => {
    h.state.openDeal = { id: 'deal-1', pipeline_id: 'pipe-1', stage_id: 'stage-a' }
    h.state.stages = [
      { id: 'stage-a', name: 'Cotización' },
      { id: 'stage-b', name: 'Negociación' },
    ]
    h.generateReply.mockResolvedValue({
      text: 'Sure thing!',
      handoff: false,
      markDealWon: false,
      moveToStageName: 'Negociación',
    })
    h.moveDeal.mockRejectedValue(new Error('deal not found in this pipeline'))

    await expect(dispatchInboundToAiReply(ARGS)).resolves.toBeUndefined()
    expect(h.engineSendText).toHaveBeenCalled()
    expect(h.state.aiActionLogInserts).toEqual([])
  })

  it('a purchase confirmation takes priority over a same-turn stage-move signal', async () => {
    h.state.openDeal = { id: 'deal-1', pipeline_id: 'pipe-1', stage_id: 'stage-a' }
    h.state.stages = [
      { id: 'stage-a', name: 'Cotización' },
      { id: 'stage-b', name: 'Negociación' },
    ]
    h.generateReply.mockResolvedValue({
      text: 'All set!',
      handoff: false,
      markDealWon: true,
      moveToStageName: 'Negociación',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.moveDeal).not.toHaveBeenCalled()
    expect(h.state.aiActionLogInserts).toEqual([
      expect.objectContaining({ action: 'flag_deal_closing' }),
    ])
  })
})

describe('dispatchInboundToAiReply — autonomous create_deal', () => {
  it('does nothing when no pipeline is configured at all', async () => {
    h.state.openDeal = null
    h.state.pipeline = null
    h.generateReply.mockResolvedValue({
      text: 'ok',
      handoff: false,
      markDealWon: false,
      moveToStageName: 'Negociación',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.dealInserts).toEqual([])
    expect(h.state.aiActionLogInserts).toEqual([])
  })

  it('does nothing when the named stage does not match any of the default pipeline\'s stages', async () => {
    h.state.openDeal = null
    h.state.pipeline = { id: 'pipe-1' }
    h.state.stages = [{ id: 'stage-a', name: 'Cotización' }]
    h.generateReply.mockResolvedValue({
      text: 'ok',
      handoff: false,
      markDealWon: false,
      moveToStageName: 'Etapa inventada',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.dealInserts).toEqual([])
    expect(h.state.aiActionLogInserts).toEqual([])
  })

  it('falls back to the phone number as the title when the contact has no name', async () => {
    h.state.openDeal = null
    h.state.pipeline = { id: 'pipe-1' }
    h.state.stages = [{ id: 'stage-a', name: 'Cotización' }]
    h.state.contact = { lead_temperature: null, name: '', phone: '50255551234' } as unknown as typeof h.state.contact
    h.generateReply.mockResolvedValue({
      text: 'ok',
      handoff: false,
      markDealWon: false,
      moveToStageName: 'Cotización',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.dealInserts[0]).toMatchObject({ title: '50255551234' })
  })

  it('dispatches deal.stage_changed for a newly created deal', async () => {
    h.state.openDeal = null
    h.state.pipeline = { id: 'pipe-1' }
    h.state.stages = [{ id: 'stage-a', name: 'Cotización' }]
    h.generateReply.mockResolvedValue({
      text: 'ok',
      handoff: false,
      markDealWon: false,
      moveToStageName: 'Cotización',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.dispatchWebhookEvent).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      'deal.stage_changed',
      expect.objectContaining({ deal_id: 'new-deal-1', source: 'auto_reply_autonomous' }),
    )
  })
})

describe('dispatchInboundToAiReply — autonomous set_temperature', () => {
  it('sets the temperature and logs it when the model signals a new value', async () => {
    h.state.contact = { lead_temperature: null, name: 'Juan Pérez', phone: '50255551234', email: null }
    h.generateReply.mockResolvedValue({
      text: 'Claro que sí!',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      leadTemperature: 'hot',
    })

    await dispatchInboundToAiReply(ARGS)

    expect(h.state.contactUpdates).toEqual([
      expect.objectContaining({ lead_temperature: 'hot' }),
    ])
    expect(h.state.aiActionLogInserts).toEqual([
      expect.objectContaining({
        action: 'set_lead_temperature',
        target_id: 'contact-1',
        input: { temperature: 'hot', source: 'auto_reply_autonomous' },
      }),
    ])
    expect(h.dispatchWebhookEvent).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      'contact.lead_temperature_changed',
      expect.objectContaining({ contact_id: 'contact-1', lead_temperature: 'hot' }),
    )
  })

  it('does nothing when the model does not signal a temperature', async () => {
    await dispatchInboundToAiReply(ARGS) // default mock: no leadTemperature
    expect(h.state.contactUpdates).toEqual([])
  })

  it('skips the write when the temperature is unchanged', async () => {
    h.state.contact = { lead_temperature: 'warm', name: 'Juan Pérez', phone: '50255551234', email: null }
    h.generateReply.mockResolvedValue({
      text: 'ok',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      leadTemperature: 'warm',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.contactUpdates).toEqual([])
    expect(h.state.aiActionLogInserts).toEqual([])
  })

  it('fires independently alongside an autonomous stage move in the same turn', async () => {
    h.state.openDeal = { id: 'deal-1', pipeline_id: 'pipe-1', stage_id: 'stage-a' }
    h.state.stages = [
      { id: 'stage-a', name: 'Cotización' },
      { id: 'stage-b', name: 'Negociación' },
    ]
    h.generateReply.mockResolvedValue({
      text: 'Perfecto, seguimos.',
      handoff: false,
      markDealWon: false,
      moveToStageName: 'Negociación',
      leadTemperature: 'hot',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.moveDeal).toHaveBeenCalled()
    expect(h.state.contactUpdates).toEqual([
      expect.objectContaining({ lead_temperature: 'hot' }),
    ])
  })
})

describe('dispatchInboundToAiReply — autonomous schedule_appointment', () => {
  it('never mentions scheduling in the prompt when the toggle is off, even with Calendar connected', async () => {
    h.state.gcalStatus = 'connected'
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoScheduleAppointmentsEnabled: false }))
    await dispatchInboundToAiReply(ARGS)
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).not.toContain('ACTION:schedule_appointment')
    expect(h.checkFreeBusy).not.toHaveBeenCalled()
  })

  it('never mentions scheduling when the toggle is on but Calendar is not connected', async () => {
    h.state.gcalStatus = null
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoScheduleAppointmentsEnabled: true }))
    await dispatchInboundToAiReply(ARGS)
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).not.toContain('ACTION:schedule_appointment')
    expect(h.checkFreeBusy).not.toHaveBeenCalled()
  })

  it('offers real free/busy data and the contact email in the prompt when toggle is on and Calendar is connected', async () => {
    h.state.gcalStatus = 'connected'
    h.state.contact = { lead_temperature: null, name: 'Ana', phone: '502...', email: 'ana@example.com' }
    h.checkFreeBusy.mockResolvedValue([{ start: '2026-06-01T10:00:00Z', end: '2026-06-01T11:00:00Z' }])
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoScheduleAppointmentsEnabled: true }))
    await dispatchInboundToAiReply(ARGS)
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).toContain('ACTION:schedule_appointment')
    expect(systemPrompt).toContain('ana@example.com')
    // Reformatted with an explicit offset (falls back to UTC here since
    // the mocked account has no `timezone` field) — never a bare "Z".
    expect(systemPrompt).toContain('2026-06-01T10:00:00+00:00')
  })

  it('formats "now" using the account\'s real timezone, not bare UTC', async () => {
    h.state.gcalStatus = 'connected'
    h.state.account = { default_currency: 'USD', timezone: 'America/Guatemala' }
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoScheduleAppointmentsEnabled: true }))
    await dispatchInboundToAiReply(ARGS)
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).toContain('America/Guatemala')
    expect(systemPrompt).toContain('-06:00')
    expect(systemPrompt).not.toMatch(/is \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/)
  })

  it('books the event, logs it, and dispatches the webhook when the model proposes a free slot', async () => {
    h.state.gcalStatus = 'connected'
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoScheduleAppointmentsEnabled: true }))
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const start = future.toISOString()
    const end = new Date(future.getTime() + 60 * 60 * 1000).toISOString()
    h.generateReply.mockResolvedValue({
      text: 'Listo, tu cita queda confirmada.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      appointmentProposal: { start, end, email: 'ana@example.com' },
    })
    h.checkFreeBusy.mockResolvedValue([]) // both the prompt-time and pre-booking re-check see it free

    await dispatchInboundToAiReply(ARGS)

    expect(h.createEvent).toHaveBeenCalledWith(
      expect.anything(), 'acct-1',
      expect.objectContaining({ startISO: start, endISO: end, attendeeEmail: 'ana@example.com', timeZone: 'UTC' }),
    )
    expect(h.state.aiActionLogInserts).toContainEqual(
      expect.objectContaining({
        action: 'schedule_appointment', target_id: 'contact-1',
        input: expect.objectContaining({ attendeeEmail: 'ana@example.com', source: 'auto_reply_autonomous' }),
      }),
    )
    expect(h.dispatchWebhookEvent).toHaveBeenCalledWith(
      expect.anything(), 'acct-1', 'appointment.scheduled',
      expect.objectContaining({ contact_id: 'contact-1', event_id: 'evt-1', source: 'auto_reply_autonomous' }),
    )
  })

  it('never books when the toggle is off, even if the model output somehow contains a proposal', async () => {
    h.state.gcalStatus = 'connected'
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoScheduleAppointmentsEnabled: false }))
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000)
    h.generateReply.mockResolvedValue({
      text: 'ok',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      appointmentProposal: {
        start: future.toISOString(),
        end: new Date(future.getTime() + 60 * 60 * 1000).toISOString(),
        email: 'ana@example.com',
      },
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.createEvent).not.toHaveBeenCalled()
  })

  it('skips booking when the fresh free/busy re-check shows the slot is no longer free', async () => {
    h.state.gcalStatus = 'connected'
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoScheduleAppointmentsEnabled: true }))
    const start = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const end = new Date(start.getTime() + 60 * 60 * 1000)
    h.generateReply.mockResolvedValue({
      text: 'ok',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      appointmentProposal: { start: start.toISOString(), end: end.toISOString(), email: 'ana@example.com' },
    })
    // Prompt-time freebusy sees it free; the pre-booking re-check (2nd
    // call) sees it's since been taken.
    h.checkFreeBusy.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { start: start.toISOString(), end: end.toISOString() },
    ])
    await dispatchInboundToAiReply(ARGS)
    expect(h.createEvent).not.toHaveBeenCalled()
  })

  it('does not re-book or false-alarm when the same slot is already booked for the contact', async () => {
    // Real incident (2026-09-01): after the customer replied "gracias",
    // the model emitted the schedule marker again for the SAME slot; the
    // freebusy re-check then saw the event this flow had just created as
    // a conflict and handed off with a misleading "slot no longer
    // available" note. The idempotency guard makes the repeat a no-op.
    h.state.gcalStatus = 'connected'
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoScheduleAppointmentsEnabled: true }))
    const start = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const end = new Date(start.getTime() + 60 * 60 * 1000)
    h.state.priorScheduleBookings = [
      { input: { startTime: start.toISOString(), endTime: end.toISOString(), attendeeEmail: 'ana@example.com' } },
    ]
    h.generateReply.mockResolvedValue({
      text: 'Perfecto, tu cita queda confirmada.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      appointmentProposal: { start: start.toISOString(), end: end.toISOString(), email: 'ana@example.com' },
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.createEvent).not.toHaveBeenCalled()
    // Only the prompt-time freebusy ran — no pre-booking re-check.
    expect(h.checkFreeBusy).toHaveBeenCalledTimes(1)
    // No "couldn't schedule" handoff note left in the thread.
    expect(h.state.messageInserts).not.toContainEqual(
      expect.objectContaining({ content_type: 'internal_note' }),
    )
  })

  it('skips booking when the proposed email is invalid', async () => {
    h.state.gcalStatus = 'connected'
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoScheduleAppointmentsEnabled: true }))
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000)
    h.generateReply.mockResolvedValue({
      text: 'ok',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      appointmentProposal: {
        start: future.toISOString(),
        end: new Date(future.getTime() + 60 * 60 * 1000).toISOString(),
        email: 'not-an-email',
      },
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.createEvent).not.toHaveBeenCalled()
  })
})

describe('dispatchInboundToAiReply — catalog context in prompt', () => {
  it('retains catalog grounding when knowledge retrieval fails', async () => {
    h.retrieveKnowledge.mockRejectedValue(new Error('knowledge unavailable'))
    h.loadCatalogContext.mockResolvedValue(['- Suite Familiar (Q950)'])
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply.mock.calls[0][0].systemPrompt).toContain('Suite Familiar (Q950)')
  })
  it('includes catalog lines in the system prompt when the account has active products', async () => {
    h.loadCatalogContext.mockResolvedValue(['- Camisa (Q150)', '- Pantalón (Q250)'])
    await dispatchInboundToAiReply(ARGS)
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).toContain('Camisa (Q150)')
    expect(systemPrompt).toContain('Pantalón (Q250)')
  })

  it('says nothing about a catalog when the account has no active products', async () => {
    h.loadCatalogContext.mockResolvedValue(null)
    await dispatchInboundToAiReply(ARGS)
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).not.toContain('ACTION:send_catalog')
    expect(systemPrompt).not.toContain('Product catalog')
  })
})

describe('dispatchInboundToAiReply — autonomous send_catalog', () => {
  it('sends the catalog when the model asks for it', async () => {
    h.generateReply.mockResolvedValue({
      text: 'Claro, aquí tienes nuestro catálogo.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: true,
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendCatalogToConversation).toHaveBeenCalledWith(expect.anything(), 'acct-1', 'conv-1')
  })

  it('does not send the catalog when the model does not ask for it', async () => {
    await dispatchInboundToAiReply(ARGS) // default mock: sendCatalog false
    expect(h.sendCatalogToConversation).not.toHaveBeenCalled()
  })

  it('still sends the catalog when the model forgets the marker but the customer plainly asked for it (2026-09-11 incident)', async () => {
    h.loadCatalogContext.mockResolvedValue(['- Suite Premium (Q350)'])
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'Me envían su catálogo porfavor?' }])
    h.generateReply.mockResolvedValue({
      text: 'Claro, te comparto el catálogo 😊', // the marker never made it into the raw output
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
    })

    await dispatchInboundToAiReply(ARGS)

    expect(h.sendCatalogToConversation).toHaveBeenCalledWith(expect.anything(), 'acct-1', 'conv-1')
    expect(h.dispatchSystemAlert).toHaveBeenCalledWith(
      expect.objectContaining({ dedupKey: 'ai_marker_missed_send_catalog:acct-1' }),
    )
  })

  it('does not force-send when there is no catalog to offer, even if the customer asks', async () => {
    h.loadCatalogContext.mockResolvedValue(null)
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: '¿Tienen catálogo?' }])
    await dispatchInboundToAiReply(ARGS) // default mock: sendCatalog false
    expect(h.sendCatalogToConversation).not.toHaveBeenCalled()
  })

  it('fires alongside an autonomous stage move in the same turn', async () => {
    h.state.openDeal = { id: 'deal-1', pipeline_id: 'pipe-1', stage_id: 'stage-a' }
    h.state.stages = [
      { id: 'stage-a', name: 'Cotización' },
      { id: 'stage-b', name: 'Negociación' },
    ]
    h.generateReply.mockResolvedValue({
      text: 'Aquí tienes el catálogo, y seguimos negociando.',
      handoff: false,
      markDealWon: false,
      moveToStageName: 'Negociación',
      sendCatalog: true,
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendCatalogToConversation).toHaveBeenCalled()
    expect(h.moveDeal).toHaveBeenCalledWith(expect.anything(), 'acct-1', 'deal-1', 'stage-b')
  })

  it('swallows a send failure and alerts — the already-sent reply is unaffected', async () => {
    h.generateReply.mockResolvedValue({
      text: 'Aquí tienes.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: true,
    })
    h.sendCatalogToConversation.mockRejectedValue(new SendCatalogError('No active products in the catalog yet.'))

    await expect(dispatchInboundToAiReply(ARGS)).resolves.toBeUndefined()
    expect(h.engineSendText).toHaveBeenCalled()
    expect(h.dispatchSystemAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'warning',
        dedupKey: 'ai_send_catalog_failed:acct-1',
        detail: expect.objectContaining({ message: 'No active products in the catalog yet.' }),
      }),
    )
  })

  it('does not cascade — a non-SendCatalogError still alerts but lets an independent same-turn action run', async () => {
    h.state.contact = { lead_temperature: null, name: 'Juan Pérez', phone: '50255551234', email: null }
    h.generateReply.mockResolvedValue({
      text: 'Aquí tienes el catálogo.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: true,
      leadTemperature: 'hot',
    })
    h.sendCatalogToConversation.mockRejectedValue(new Error('network blip'))

    await expect(dispatchInboundToAiReply(ARGS)).resolves.toBeUndefined()

    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Aquí tienes el catálogo.' }),
    )
    expect(h.dispatchSystemAlert).toHaveBeenCalledWith(
      expect.objectContaining({ dedupKey: 'ai_send_catalog_failed:acct-1' }),
    )
    // Previously this rethrew a non-SendCatalogError straight to the
    // outer catch, silently skipping every autonomous action listed
    // after send_catalog — including this one.
    expect(h.state.contactUpdates).toEqual([
      expect.objectContaining({ lead_temperature: 'hot' }),
    ])
  })
})

describe('dispatchInboundToAiReply — autonomous send_photo', () => {
  it('sends the matched product\'s photo when the model asks for one', async () => {
    h.state.products = [
      { id: 'p1', name: 'Suite Premium', image_url: 'https://cdn.example.com/suite.jpg' },
    ]
    h.generateReply.mockResolvedValue({
      text: 'Claro, aquí la tienes.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      sendPhotoProductName: 'Suite Premium',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({
        conversationId: 'conv-1',
        messageType: 'image',
        mediaUrl: 'https://cdn.example.com/suite.jpg',
        senderType: 'bot',
      }),
    )
  })

  it('does not send anything when the model does not ask for a photo', async () => {
    await dispatchInboundToAiReply(ARGS) // default mock: sendPhotoProductName undefined
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
  })

  it('matches the product name case-insensitively', async () => {
    h.state.products = [
      { id: 'p1', name: 'Paquete Romántico', image_url: 'https://cdn.example.com/romantico.jpg' },
    ]
    h.generateReply.mockResolvedValue({
      text: 'Aquí tienes.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      sendPhotoProductName: 'paquete romántico',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({ mediaUrl: 'https://cdn.example.com/romantico.jpg' }),
    )
  })

  it('sends every photo in the product\'s gallery, not just the first', async () => {
    h.state.products = [
      {
        id: 'p1',
        name: 'Junior Suite Familiar',
        image_url: 'https://cdn.example.com/familiar-1.jpg',
        image_urls: [
          'https://cdn.example.com/familiar-1.jpg',
          'https://cdn.example.com/familiar-2.jpg',
          'https://cdn.example.com/familiar-3.jpg',
        ],
      },
    ]
    h.generateReply.mockResolvedValue({
      text: 'Con gusto le comparto las fotos.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      sendPhotoProductName: 'Junior Suite Familiar',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).toHaveBeenCalledTimes(3)
    ;['familiar-1', 'familiar-2', 'familiar-3'].forEach((slug, i) => {
      expect(h.sendMessageToConversation).toHaveBeenNthCalledWith(
        i + 1,
        expect.anything(),
        'acct-1',
        expect.objectContaining({
          conversationId: 'conv-1',
          messageType: 'image',
          mediaUrl: `https://cdn.example.com/${slug}.jpg`,
          senderType: 'bot',
        }),
      )
    })
  })

  it('falls back to the single image_url when the gallery is empty (pre-migration data)', async () => {
    h.state.products = [
      { id: 'p1', name: 'Suite Premium', image_url: 'https://cdn.example.com/suite.jpg', image_urls: [] },
    ]
    h.generateReply.mockResolvedValue({
      text: 'Aquí tienes.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      sendPhotoProductName: 'Suite Premium',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).toHaveBeenCalledTimes(1)
    expect(h.sendMessageToConversation).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({ mediaUrl: 'https://cdn.example.com/suite.jpg' }),
    )
  })

  it('sends nothing when the name matches no real active product — never an arbitrary image', async () => {
    h.state.products = [{ id: 'p1', name: 'Suite Premium', image_url: 'https://cdn.example.com/suite.jpg' }]
    h.generateReply.mockResolvedValue({
      text: 'Aquí tienes.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      sendPhotoProductName: 'Producto Inventado',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
  })

  it('sends nothing when the matched product has no photo on file — not an error', async () => {
    h.state.products = [{ id: 'p1', name: 'Suite Premium', image_url: null }]
    h.generateReply.mockResolvedValue({
      text: 'Aquí tienes.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      sendPhotoProductName: 'Suite Premium',
    })
    await expect(dispatchInboundToAiReply(ARGS)).resolves.toBeUndefined()
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
    expect(h.dispatchSystemAlert).not.toHaveBeenCalledWith(
      expect.objectContaining({ dedupKey: 'ai_send_photo_failed:acct-1' }),
    )
  })

  it('swallows an actual send failure and alerts — the already-sent reply is unaffected', async () => {
    h.state.products = [{ id: 'p1', name: 'Suite Premium', image_url: 'https://cdn.example.com/suite.jpg' }]
    h.generateReply.mockResolvedValue({
      text: 'Aquí la tienes.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      sendPhotoProductName: 'Suite Premium',
    })
    h.sendMessageToConversation.mockRejectedValue(new Error('network blip'))

    await expect(dispatchInboundToAiReply(ARGS)).resolves.toBeUndefined()
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Aquí la tienes.' }),
    )
    expect(h.dispatchSystemAlert).toHaveBeenCalledWith(
      expect.objectContaining({ dedupKey: 'ai_send_photo_failed:acct-1' }),
    )
  })

  it('non-hotel account: sends the photo and nothing else (no booking nudge)', async () => {
    h.state.products = [{ id: 'p1', name: 'Suite Premium', image_url: 'https://cdn.example.com/suite.jpg' }]
    h.generateReply.mockResolvedValue({
      text: 'Aquí tienes.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      sendPhotoProductName: 'Suite Premium',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).toHaveBeenCalledTimes(1)
  })

  it('hotel vertical, no reservation started yet: nudges for the category\'s missing fields', async () => {
    h.state.account = { default_currency: 'USD', industry_vertical: 'hotel' }
    h.state.products = [
      { id: 'p1', name: 'Suite Premium', image_url: 'https://cdn.example.com/suite.jpg', category_id: 'cat-1' },
    ]
    h.state.productCategoryName = 'Habitaciones'
    h.generateReply.mockResolvedValue({
      text: 'Aquí tienes.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      sendPhotoProductName: 'Suite Premium',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).toHaveBeenCalledTimes(2)
    expect(h.sendMessageToConversation).toHaveBeenLastCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({
        messageType: 'text',
        contentText:
          '¿Le gustaría confirmar la reservación? Me falta las fechas de entrada y salida y el número de personas para dejarla lista.',
      }),
    )
  })

  it('hotel vertical, a reservation is already in progress for this product: only names what is still missing', async () => {
    h.state.account = { default_currency: 'USD', industry_vertical: 'hotel' }
    h.state.products = [
      { id: 'p1', name: 'Suite Premium', image_url: 'https://cdn.example.com/suite.jpg', category_id: 'cat-1' },
    ]
    h.state.reservationRow = {
      category: 'habitaciones',
      guests: null,
      check_in: '2026-10-01',
      check_out: '2026-10-03',
      use_date: null,
      hall: null,
    }
    h.generateReply.mockResolvedValue({
      text: 'Aquí tienes.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      sendPhotoProductName: 'Suite Premium',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).toHaveBeenLastCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({
        contentText: '¿Le gustaría confirmar la reservación? Me falta el número de personas para dejarla lista.',
      }),
    )
  })

  it('hotel vertical, product is in a non-bookable category: no nudge, just the photo', async () => {
    h.state.account = { default_currency: 'USD', industry_vertical: 'hotel' }
    h.state.products = [
      { id: 'p1', name: 'Llavero recuerdo', image_url: 'https://cdn.example.com/llavero.jpg', category_id: 'cat-9' },
    ]
    h.state.productCategoryName = 'Souvenirs'
    h.generateReply.mockResolvedValue({
      text: 'Aquí tienes.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      sendPhotoProductName: 'Llavero recuerdo',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).toHaveBeenCalledTimes(1)
  })
})

describe('dispatchInboundToAiReply — autonomous send_restaurant_menu', () => {
  it('sends the menu when the model asks for it and a menu URL is configured', async () => {
    h.state.account = { default_currency: 'USD', restaurant_menu_url: 'https://x/menu.pdf' }
    h.generateReply.mockResolvedValue({
      text: 'Claro, aquí tienes el menú.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      sendRestaurantMenu: true,
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendRestaurantMenuToConversation).toHaveBeenCalledWith(expect.anything(), 'acct-1', 'conv-1')
  })

  it('does not send the menu when no menu URL is configured, even if the model asks', async () => {
    h.state.account = { default_currency: 'USD' } // no restaurant_menu_url
    h.generateReply.mockResolvedValue({
      text: 'Aquí tienes el menú.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      sendRestaurantMenu: true,
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendRestaurantMenuToConversation).not.toHaveBeenCalled()
  })

  it('does not send the menu when the model does not ask for it', async () => {
    h.state.account = { default_currency: 'USD', restaurant_menu_url: 'https://x/menu.pdf' }
    await dispatchInboundToAiReply(ARGS) // default mock: sendRestaurantMenu false
    expect(h.sendRestaurantMenuToConversation).not.toHaveBeenCalled()
  })

  it('still sends the menu when the model forgets the marker but the customer plainly asked for it', async () => {
    h.state.account = { default_currency: 'USD', restaurant_menu_url: 'https://x/menu.pdf' }
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'me pueden compartir el menú?' }])
    h.generateReply.mockResolvedValue({
      text: 'Claro, te lo envío enseguida',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendRestaurantMenu: false,
    })

    await dispatchInboundToAiReply(ARGS)

    expect(h.sendRestaurantMenuToConversation).toHaveBeenCalledWith(expect.anything(), 'acct-1', 'conv-1')
    expect(h.dispatchSystemAlert).toHaveBeenCalledWith(
      expect.objectContaining({ dedupKey: 'ai_marker_missed_send_restaurant_menu:acct-1' }),
    )
  })

  it('swallows a send failure and alerts, without cancelling the already-sent reply', async () => {
    h.state.account = { default_currency: 'USD', restaurant_menu_url: 'https://x/menu.pdf' }
    h.generateReply.mockResolvedValue({
      text: 'Claro, aquí tienes el menú.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      sendRestaurantMenu: true,
    })
    h.sendRestaurantMenuToConversation.mockRejectedValueOnce(new Error('pdf host unreachable'))

    await expect(dispatchInboundToAiReply(ARGS)).resolves.toBeUndefined()

    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Claro, aquí tienes el menú.' }),
    )
    expect(h.dispatchSystemAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'warning',
        dedupKey: 'ai_send_restaurant_menu_failed:acct-1',
      }),
    )
  })
})

describe('dispatchInboundToAiReply — quick replies in the prompt', () => {
  it('includes quick-reply lines in the system prompt when the account has some', async () => {
    h.loadQuickReplyContext.mockResolvedValue([{ id: 'qr-1', title: 'Horario', preview: 'Abrimos 8am-6pm.' }])
    await dispatchInboundToAiReply(ARGS)
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).toContain('qr-1')
    expect(systemPrompt).toContain('Horario')
    expect(systemPrompt).toContain('Abrimos 8am-6pm.')
  })

  it('says nothing about quick replies when the account has none', async () => {
    h.loadQuickReplyContext.mockResolvedValue(null)
    await dispatchInboundToAiReply(ARGS)
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).not.toContain('QUICK_REPLY')
  })
})

describe('dispatchInboundToAiReply — autonomous send_quick_reply', () => {
  it('sends the quick reply\'s own stored text, not the model\'s own text, and logs it', async () => {
    h.state.quickReplyRow = { id: 'qr-1', content_text: 'Abrimos de lunes a sábado, 8am a 6pm.' }
    h.generateReply.mockResolvedValue({
      text: 'this should never be sent',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      quickReplyId: 'qr-1',
    })

    await dispatchInboundToAiReply(ARGS)

    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Abrimos de lunes a sábado, 8am a 6pm.' }),
    )
    expect(h.state.aiActionLogInserts).toEqual([
      expect.objectContaining({
        account_id: 'acct-1',
        actor_user_id: 'user-1',
        action: 'send_quick_reply',
        target_id: 'qr-1',
        input: { quick_reply_id: 'qr-1', source: 'auto_reply_autonomous' },
      }),
    ])
  })

  it('falls back to the model\'s own text when the id does not resolve to a real quick reply (hallucinated / stale id)', async () => {
    h.state.quickReplyRow = null
    h.generateReply.mockResolvedValue({
      text: 'Written by the model itself.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      quickReplyId: 'ghost-id',
    })

    await dispatchInboundToAiReply(ARGS)

    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Written by the model itself.' }),
    )
    expect(h.state.aiActionLogInserts).toEqual([])
  })

  it('does not send or log anything quick-reply related when the model does not use the marker', async () => {
    await dispatchInboundToAiReply(ARGS) // default mock: no quickReplyId
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Hello!' }),
    )
    expect(h.state.aiActionLogInserts).toEqual([])
  })
})

describe('dispatchInboundToAiReply — autonomous create_quote_chat', () => {
  const QUOTE_PROPOSAL = {
    format: 'text' as const,
    items: [{ name: 'Montessori Oslo Imperial', qty: 1 }],
    customerNit: '',
    customerEmail: '',
    customerAddress: 'Villa Canales',
  }

  beforeEach(() => {
    h.state.account.catalog_delivery_mode = 'photos'
    h.generateReply.mockResolvedValue({
      text: '¡Perfecto! Ya puedo prepararte la cotización.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      quoteProposal: QUOTE_PROPOSAL,
    })
  })

  it('creates and sends the quote when the item matches a real catalog product', async () => {
    h.state.products = [{ id: 'p1', name: 'Montessori Oslo Imperial' }]
    h.createQuote.mockResolvedValue({ quote: { id: 'quote-1', total: 2250 }, items: [] })

    await dispatchInboundToAiReply(ARGS)

    expect(h.createQuote).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: 'contact-1',
        items: [{ product_id: 'p1', quantity: 1 }],
        allowFreeItems: false,
      }),
    )
    expect(h.sendQuoteByAccountPreference).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      'quote-1',
      'conv-1',
      true, // proposal.format === 'text' forces a text quote
      true, // askFollowUp — this path bypasses the AI's own text generation entirely
    )
    // A successful quote must never also trip the silent-failure handoff.
    expect(h.state.updatePayload).toBeNull()
  })

  it('hands off to a human instead of going silent when no item matches a real product (2026-08-25 incident)', async () => {
    h.state.products = [{ id: 'p1', name: 'Montessori Tree Individual' }] // no "Oslo Imperial"

    await dispatchInboundToAiReply(ARGS)

    expect(h.createQuote).not.toHaveBeenCalled()
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
    expect(h.state.updatePayload?.ai_handoff_summary).toContain('Montessori Oslo Imperial')
  })

  it('hands off to a human when createQuote itself fails', async () => {
    h.state.products = [{ id: 'p1', name: 'Montessori Oslo Imperial' }]
    const { CreateQuoteError } = await import('@/lib/quotes/create-quote')
    h.createQuote.mockRejectedValue(new CreateQuoteError('customerPhone and customerAddress are required'))

    await dispatchInboundToAiReply(ARGS)

    expect(h.sendQuoteByAccountPreference).not.toHaveBeenCalled()
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
    expect(h.state.updatePayload?.ai_handoff_summary).toContain('no se pudo crear la cotización')
  })

  it('hands off to a human when the quote is created but sending it fails', async () => {
    h.state.products = [{ id: 'p1', name: 'Montessori Oslo Imperial' }]
    h.createQuote.mockResolvedValue({ quote: { id: 'quote-1', total: 2250 }, items: [] })
    const { SendQuoteError } = await import('@/lib/quotes/send-quote')
    h.sendQuoteByAccountPreference.mockRejectedValue(new SendQuoteError('messaging window is closed'))

    await dispatchInboundToAiReply(ARGS)

    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
    expect(h.state.updatePayload?.ai_handoff_summary).toContain('se creó pero no se pudo enviar')
  })

  it('does nothing quote-related when the catalog is delivered digitally (own self-service cart)', async () => {
    h.state.account.catalog_delivery_mode = 'digital'
    h.state.products = [{ id: 'p1', name: 'Montessori Oslo Imperial' }]

    await dispatchInboundToAiReply(ARGS)

    expect(h.createQuote).not.toHaveBeenCalled()
    expect(h.state.updatePayload).toBeNull()
  })
})

describe('dispatchInboundToAiReply - clinic appointment safety', () => {
  beforeEach(() => {
    h.state.account = {
      default_currency: 'GTQ',
      industry_vertical: 'clinica',
      timezone: 'America/Guatemala',
    }
    h.loadClinicAppointmentContext.mockResolvedValue({
      id: 'appt-clinic-1',
      summary: 'Consulta, jueves 10 a las 9:00 a. m., con Dra. Ruiz',
      confirmationStatus: 'pending',
      status: 'SCHEDULED',
    })
    h.generateReply.mockResolvedValue({
      text: 'Tu cita quedó confirmada. Te esperamos.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      appointmentAction: 'confirm',
    })
  })

  it('persists the confirmation before telling the patient it succeeded', async () => {
    await dispatchInboundToAiReply(ARGS)

    expect(h.transitionAppointment).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      'user-1',
      'appt-clinic-1',
      'CONFIRMED',
      expect.objectContaining({ confirmation_status: 'confirmed' }),
    )
    expect(h.transitionAppointment.mock.invocationCallOrder[0]).toBeLessThan(
      h.engineSendText.mock.invocationCallOrder[0],
    )
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Tu cita quedó confirmada. Te esperamos.' }),
    )
    expect(h.state.aiActionLogInserts).toContainEqual(
      expect.objectContaining({
        action: 'appointment_action',
        target_id: 'appt-clinic-1',
        result: { status: 'CONFIRMED' },
      }),
    )
  })

  it('alerts (critical) and hands off — without a false "sent" claim — when the mutation succeeds but the send itself fails', async () => {
    h.engineSendText.mockRejectedValueOnce(new Error('WhatsApp send failed'))

    await expect(dispatchInboundToAiReply(ARGS)).resolves.toBeUndefined()

    // The database mutation already committed before the send was attempted.
    expect(h.transitionAppointment).toHaveBeenCalledWith(
      expect.anything(), 'acct-1', 'user-1', 'appt-clinic-1', 'CONFIRMED',
      expect.objectContaining({ confirmation_status: 'confirmed' }),
    )
    expect(h.dispatchSystemAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'critical',
        dedupKey: 'ai_send_after_mutation_failed:appt-clinic-1',
      }),
    )
    expect(h.state.updatePayload).toMatchObject({
      ai_autoreply_disabled: true,
      ai_handoff_transient: true,
    })
    expect(h.state.updatePayload?.ai_handoff_summary).toContain('no se pudo enviar el mensaje')
  })

  it('withholds a false success, sends a safe reply, and routes to reception when persistence fails', async () => {
    h.transitionAppointment.mockResolvedValue({
      ok: false,
      error: 'La cita cambió mientras se procesaba la respuesta',
      status: 409,
    })

    await dispatchInboundToAiReply(ARGS)

    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('No pude actualizar tu cita') }),
    )
    expect(h.engineSendText).not.toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Tu cita quedó confirmada. Te esperamos.' }),
    )
    expect(h.state.updatePayload).toMatchObject({
      ai_autoreply_disabled: true,
      ai_handoff_transient: true,
    })
    expect(h.state.updatePayload?.ai_handoff_summary).toContain('base de datos rechazó')
  })

  it('does not expose generic Google Calendar booking to a clinic account', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoScheduleAppointmentsEnabled: true }))
    h.state.gcalStatus = 'active'
    h.generateReply.mockResolvedValue({
      text: '¿Qué día prefieres?',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
    })

    await dispatchInboundToAiReply(ARGS)

    const prompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(prompt).not.toContain('[[SCHEDULE_APPOINTMENT:')
    expect(prompt).toContain('no live clinic-booking tool')
  })

  it('keeps medical safety limits when account metadata is temporarily unreadable', async () => {
    h.state.accountError = { code: '57014', message: 'statement timeout' }
    h.loadClinicAppointmentContext.mockResolvedValue(null)
    h.generateReply.mockResolvedValue({
      text: 'Un profesional de la clínica puede orientarte.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
    })

    await dispatchInboundToAiReply(ARGS)

    const prompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(prompt).toContain('This is a medical clinic')
    expect(prompt).toContain('NEVER give a diagnosis')
    expect(h.engineSendText).toHaveBeenCalled()
  })

})
