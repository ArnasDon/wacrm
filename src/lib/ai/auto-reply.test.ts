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
  state: {
    conv: null as Record<string, unknown> | null,
    autoResponders: [] as { id: string }[],
    claim: true as boolean,
    updatePayload: null as Record<string, unknown> | null,
    rpcCalls: [] as { name: string; args: unknown }[],
    openDeal: null as { id: string; pipeline_id: string; stage_id: string } | null,
    stages: [] as { id: string; name: string }[],
    aiActionLogInserts: [] as Record<string, unknown>[],
  },
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

// `.select().eq().eq().order()` (or without `.order()`) → a multi-row
// select, resolved lazily whenever the chain is awaited (every step
// returns the same thenable chain, so it doesn't matter which call is
// last — mirrors how the real supabase-js query builder is itself a
// thenable, no separate terminal call required for a plain select-many).
function selectManyChain(getData: () => unknown) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    then: (resolve: (v: { data: unknown; error: null }) => void) =>
      resolve({ data: getData(), error: null }),
  }
  return chain
}

vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'automations') {
        // .select().eq().eq().in().limit() → active auto-responders
        const chain = {
          select: () => chain,
          eq: () => chain,
          in: () => chain,
          limit: () =>
            Promise.resolve({ data: h.state.autoResponders, error: null }),
        }
        return chain
      }
      if (table === 'deals') {
        // .select().eq().eq().eq().order().limit().maybeSingle() → most
        // recently updated open deal for the contact.
        const chain = {
          select: () => chain,
          eq: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: () => Promise.resolve({ data: h.state.openDeal, error: null }),
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
  h.state.autoResponders = []
  h.state.claim = true
  h.state.updatePayload = null
  h.state.rpcCalls = []
  h.state.openDeal = null
  h.state.stages = []
  h.state.aiActionLogInserts = []
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

  it('stands down when an active message-level automation exists', async () => {
    h.state.autoResponders = [{ id: 'auto-1' }]
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
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

  it('skips when the per-conversation cap is reached', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: false,
      ai_reply_count: 3,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
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

  it('says nothing about stage options when the contact has no open deal', async () => {
    h.state.openDeal = null
    await dispatchInboundToAiReply(ARGS)
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).not.toContain('ACTION:move_deal')
  })

  it('says nothing about stage options when the deal has no other stage to offer', async () => {
    h.state.openDeal = { id: 'deal-1', pipeline_id: 'pipe-1', stage_id: 'stage-a' }
    h.state.stages = [{ id: 'stage-a', name: 'Cotización' }]
    await dispatchInboundToAiReply(ARGS)
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).not.toContain('ACTION:move_deal')
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

  it('still sends the reply, and logs nothing, when the contact has no open deal', async () => {
    h.generateReply.mockResolvedValue({
      text: 'Sure thing!',
      handoff: false,
      markDealWon: false,
      moveToStageName: 'Negociación',
    })
    h.state.openDeal = null

    await dispatchInboundToAiReply(ARGS)

    expect(h.engineSendText).toHaveBeenCalled()
    expect(h.moveDeal).not.toHaveBeenCalled()
    expect(h.state.aiActionLogInserts).toEqual([])
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
