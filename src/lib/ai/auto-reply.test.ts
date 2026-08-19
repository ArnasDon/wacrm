import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AiConfig } from './types'

// Shared, hoisted mock state so the module mocks can close over it.
const h = vi.hoisted(() => ({
  loadAiConfig: vi.fn(),
  buildConversationContext: vi.fn(),
  retrieveKnowledge: vi.fn(),
  loadCatalogContext: vi.fn(),
  generateReply: vi.fn(),
  engineSendText: vi.fn(),
  moveDeal: vi.fn(),
  dispatchWebhookEvent: vi.fn(),
  sendCatalogToConversation: vi.fn(),
  checkFreeBusy: vi.fn(),
  createEvent: vi.fn(),
  state: {
    conv: null as Record<string, unknown> | null,
    claim: true as boolean,
    updatePayload: null as Record<string, unknown> | null,
    rpcCalls: [] as { name: string; args: unknown }[],
    openDeal: null as { id: string; pipeline_id: string; stage_id: string } | null,
    stages: [] as { id: string; name: string; is_won?: boolean }[],
    aiActionLogInserts: [] as Record<string, unknown>[],
    pipeline: null as { id: string } | null,
    contact: { lead_temperature: null as string | null, name: 'Juan Pérez', phone: '50255551234', email: null as string | null },
    account: { default_currency: 'USD' } as { default_currency: string; timezone?: string },
    dealInserts: [] as Record<string, unknown>[],
    createdDeal: { id: 'new-deal-1', pipeline_id: 'pipe-1', stage_id: 'stage-a' } as Record<string, unknown>,
    contactUpdates: [] as Record<string, unknown>[],
    /** `google_calendar_config.status` — null means no row (not connected). */
    gcalStatus: null as string | null,
  },
}))

vi.mock('@/lib/google-calendar/api', () => ({
  checkFreeBusy: h.checkFreeBusy,
  createEvent: h.createEvent,
  APPOINTMENT_LOOKAHEAD_MS: 7 * 24 * 60 * 60 * 1000,
}))

vi.mock('./config', () => ({ loadAiConfig: h.loadAiConfig }))
vi.mock('./context', () => ({ buildConversationContext: h.buildConversationContext }))
vi.mock('./knowledge', () => ({ retrieveKnowledge: h.retrieveKnowledge }))
vi.mock('./catalog-context', () => ({ loadCatalogContext: h.loadCatalogContext }))
vi.mock('./generate', () => ({ generateReply: h.generateReply }))
vi.mock('@/lib/flows/meta-send', () => ({ engineSendText: h.engineSendText }))
vi.mock('@/lib/webhooks/deliver', () => ({ dispatchWebhookEvent: h.dispatchWebhookEvent }))
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
// The real limiter is an in-memory counter shared across every test in
// this file (same accountId) — mocked so the growing number of tests
// here can't tip a shared counter over the real 30/min cap and start
// skipping later tests. Rate-limiting itself isn't what's under test.
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
        return {
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
              maybeSingle: () => Promise.resolve({ data: h.state.account, error: null }),
            }),
          }),
        }
      }
      // conversations
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: h.state.conv, error: null }),
          }),
        }),
        update: (payload: Record<string, unknown>) => {
          h.state.updatePayload = payload
          return { eq: () => Promise.resolve({ error: null }) }
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
  }
  h.state.claim = true
  h.state.updatePayload = null
  h.state.rpcCalls = []
  h.state.openDeal = null
  h.state.stages = []
  h.state.aiActionLogInserts = []
  h.state.pipeline = null
  h.state.contact = { lead_temperature: null, name: 'Juan Pérez', phone: '50255551234', email: null }
  h.state.account = { default_currency: 'USD' }
  h.state.dealInserts = []
  h.state.createdDeal = { id: 'new-deal-1', pipeline_id: 'pipe-1', stage_id: 'stage-a' }
  h.state.contactUpdates = []
  h.state.gcalStatus = null
  h.checkFreeBusy.mockReset().mockResolvedValue([])
  h.createEvent.mockReset().mockResolvedValue({ eventId: 'evt-1', htmlLink: 'https://calendar.google.com/evt-1', meetLink: 'https://meet.google.com/abc' })
  h.loadAiConfig.mockResolvedValue(aiConfig())
  h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'hi' }])
  h.retrieveKnowledge.mockResolvedValue([])
  h.loadCatalogContext.mockResolvedValue(null)
  h.generateReply.mockResolvedValue({
    text: 'Hello!',
    handoff: false,
    markDealWon: false,
    moveToStageName: null,
    sendCatalog: false,
  })
  h.engineSendText.mockResolvedValue({ whatsapp_message_id: 'm1' })
  h.moveDeal.mockResolvedValue({
    deal: { id: 'deal-1', pipeline_id: 'pipe-1', stage_id: 'stage-b', status: 'open' },
    isWonStage: false,
  })
  h.dispatchWebhookEvent.mockResolvedValue(undefined)
  h.sendCatalogToConversation.mockResolvedValue({ catalogUrl: 'https://example.com/catalog/acct-1' })
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
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
    expect(h.state.updatePayload?.ai_handoff_summary).toContain('reply limit')
  })

  it('skips when there is nothing to reply to', async () => {
    h.buildConversationContext.mockResolvedValue([])
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
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
      'AI agent handed off',
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

  it('swallows a send failure — the already-sent reply is unaffected', async () => {
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
  })
})
