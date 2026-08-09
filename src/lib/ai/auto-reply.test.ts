import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DEFAULT_COMMERCIAL_STRATEGY } from './commercial-strategy'
import type { AiConfig } from './types'

const h = vi.hoisted(() => ({
  loadAiConfig: vi.fn(),
  buildConversationContext: vi.fn(),
  generateReply: vi.fn(),
  engineSendText: vi.fn(),
  engineSendTypingIndicator: vi.fn(),
  triggerMatches: vi.fn(),
  state: {
    conv: null as Record<string, unknown> | null,
    autoResponders: [] as Record<string, unknown>[],
    claim: true as boolean,
    updatePayload: null as Record<string, unknown> | null,
    rpcCalls: [] as { name: string; args: unknown }[],
    toolHandoff: null as { reason: string; summary: string | null } | null,
    tracePayload: null as Record<string, unknown> | null,
  },
}))

vi.mock('./config', () => ({ loadAiConfig: h.loadAiConfig }))
vi.mock('./context', () => ({ buildConversationContext: h.buildConversationContext }))
vi.mock('./generate', () => ({ generateReply: h.generateReply }))
vi.mock('@/lib/flows/meta-send', () => ({
  engineSendText: h.engineSendText,
  engineSendTypingIndicator: h.engineSendTypingIndicator,
}))
vi.mock('@/lib/automations/engine', () => ({ triggerMatches: h.triggerMatches }))
vi.mock('@/lib/rate-limit', () => ({
  RATE_LIMITS: { aiAutoReplyAccount: { limit: 100, windowMs: 60_000 } },
  checkRateLimit: () => ({ success: true }),
}))
vi.mock('./catalog-prefetch', () => ({
  prefetchCatalogueForConversation: vi.fn().mockResolvedValue({ attempted: false, query: '', products: [] }),
  cataloguePrefetchPrompt: vi.fn().mockReturnValue(null),
}))
vi.mock('./crm-context', () => ({
  loadCrmCustomerContext: vi.fn().mockResolvedValue({}),
  crmCustomerContextPrompt: vi.fn().mockReturnValue('CRM context'),
}))
vi.mock('./contact-memory', () => ({
  retrieveContactMemory: vi.fn().mockResolvedValue([
    'Prefere receber entregas ao sábado.',
  ]),
  contactMemoryPrompt: vi.fn().mockReturnValue('Contact memory'),
}))
vi.mock('./tools', () => ({
  createAutoReplyTools: () => ({
    tools: [
      { name: 'search_catalog' },
      { name: 'send_product' },
      { name: 'search_knowledge' },
    ],
    executeTool: vi.fn(),
    hasPendingActions: () => false,
    getHandoffRequest: () => h.state.toolHandoff,
  }),
}))
vi.mock('./usage', () => ({ logAiUsage: vi.fn() }))
vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'automations') {
        const chain = {
          select: () => chain,
          eq: () => chain,
          in: () => chain,
          then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
            Promise.resolve({ data: h.state.autoResponders, error: null }).then(resolve),
        }
        return chain
      }
      if (table === 'agent_tools') {
        const chain = {
          select: () => chain,
          eq: () => chain,
          then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
            Promise.resolve({ data: [], error: null }).then(resolve),
        }
        return chain
      }
      if (table === 'notifications') {
        return { insert: () => Promise.resolve({ error: null }) }
      }
      if (table === 'agent_traces') {
        return {
          insert: (payload: Record<string, unknown>) => {
            h.state.tracePayload = payload
            return Promise.resolve({ error: null })
          },
        }
      }
      return {
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: h.state.conv, error: null }) }) }),
        update: (payload: Record<string, unknown>) => {
          h.state.updatePayload = payload
          const chain = {
            eq: () => chain,
            then: (resolve: (value: { error: null }) => unknown) => Promise.resolve({ error: null }).then(resolve),
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

const ARGS = { accountId: 'acct-1', conversationId: 'conv-1', contactId: 'contact-1', configOwnerUserId: 'user-1', inboundMessageId: 'wamid.inbound-1' }

function aiConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    agentId: 'agent-config-1',
    provider: 'openai', model: 'gpt-test', apiKey: 'sk-test', systemPrompt: null,
    commercialStrategy: DEFAULT_COMMERCIAL_STRATEGY,
    isActive: true, autoReplyEnabled: true, autoReplyMaxPerConversation: 3,
    bufferWindowSeconds: 12,
    maxReplyChunks: 3,
    handoffAgentId: null, embeddingsApiKey: null, ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.state.conv = { assigned_agent_id: null, ai_autoreply_disabled: false, ai_reply_count: 0 }
  h.state.autoResponders = []
  h.state.claim = true
  h.state.updatePayload = null
  h.state.rpcCalls = []
  h.state.toolHandoff = null
  h.state.tracePayload = null
  h.loadAiConfig.mockResolvedValue(aiConfig())
  h.buildConversationContext.mockResolvedValue([
    { role: 'user', content: 'Como funciona a entrega?' },
  ])
  h.generateReply.mockResolvedValue({ text: 'Hello!', handoff: false })
  h.engineSendText.mockResolvedValue({ whatsapp_message_id: 'm1' })
  h.engineSendTypingIndicator.mockResolvedValue(undefined)
  h.triggerMatches.mockReturnValue(false)
})

describe('dispatchInboundToAiReply — eligibility gates', () => {
  it('claims a slot and sends on the happy path', async () => {
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.rpcCalls).toEqual([{ name: 'claim_ai_reply_slot', args: { conversation_id: 'conv-1', max_replies: 3 } }])
    expect(h.engineSendText).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'conv-1', text: 'Hello!' }))
    expect(h.engineSendTypingIndicator).toHaveBeenCalledWith({
      accountId: 'acct-1',
      inboundMessageId: 'wamid.inbound-1',
    })
    expect(h.state.tracePayload).toMatchObject({
      account_id: 'acct-1',
      conversation_id: 'conv-1',
      final_action: 'reply',
    })
  })

  it('sends explicit reply chunks in order with a human-like pause', async () => {
    vi.useFakeTimers()
    h.generateReply.mockResolvedValue({
      text: 'Primeiro balão.[[SPLIT]]Segundo balão.',
      handoff: false,
    })

    const pending = dispatchInboundToAiReply(ARGS)
    await vi.runAllTimersAsync()
    await pending
    vi.useRealTimers()

    expect(h.engineSendText).toHaveBeenCalledTimes(2)
    expect(h.engineSendText.mock.calls.map(([call]) => call.text)).toEqual([
      'Primeiro balão.',
      'Segundo balão.',
    ])
    expect(h.engineSendTypingIndicator).toHaveBeenCalledTimes(2)
  })

  it('exposes the knowledge tool to OpenAI generation', async () => {
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).toHaveBeenCalledWith(expect.objectContaining({
      tools: expect.arrayContaining([expect.objectContaining({ name: 'search_knowledge' })]),
      executeTool: expect.any(Function),
      systemPrompt: expect.stringContaining('Contact memory'),
    }))
  })

  it('stands down when an active message-level automation matches', async () => {
    h.state.autoResponders = [{ id: 'auto-1' }]
    h.triggerMatches.mockReturnValue(true)
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('hands off with a static notice when the atomic slot claim loses the race', async () => {
    h.state.claim = false
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
    expect(h.engineSendText).toHaveBeenCalledOnce()
    expect(h.engineSendText).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'conv-1', aiGenerated: true }))
  })

  it('skips when AI is off / not configured', async () => {
    h.loadAiConfig.mockResolvedValue(null)
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
  })

  it('skips when auto-reply is disabled for the account', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoReplyEnabled: false }))
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when a human agent is assigned', async () => {
    h.state.conv = { assigned_agent_id: 'agent-9', ai_autoreply_disabled: false, ai_reply_count: 0 }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when auto-reply was disabled on this conversation', async () => {
    h.state.conv = { assigned_agent_id: null, ai_autoreply_disabled: true, ai_reply_count: 0 }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('hands off when the per-conversation cap is reached', async () => {
    h.state.conv = { assigned_agent_id: null, ai_autoreply_disabled: false, ai_reply_count: 3 }
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
    expect(h.engineSendText).toHaveBeenCalledOnce()
  })

  it('hands a clear complaint off before calling the main model', async () => {
    h.buildConversationContext.mockResolvedValue([
      {
        role: 'user',
        content: 'Isto é inadmissível, quero falar com uma pessoa agora.',
      },
    ])
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
    expect(h.state.tracePayload).toMatchObject({
      intent: 'complaint',
      model_tier: 'smart',
      final_action: 'handoff',
    })
  })

  it('skips when there is nothing to reply to', async () => {
    h.buildConversationContext.mockResolvedValue([])
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
  })
})

describe('dispatchInboundToAiReply — handoff', () => {
  it('uses the structured tool reason and summary for a human handoff', async () => {
    h.state.toolHandoff = {
      reason: 'Cliente pediu cancelamento com validação humana.',
      summary: 'Confirmar a identidade antes de cancelar.',
    }
    h.generateReply.mockResolvedValue({ text: '', handoff: false })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
    expect(h.state.updatePayload?.ai_handoff_summary).toContain(
      'Cliente pediu cancelamento com validação humana.',
    )
    expect(h.state.updatePayload?.ai_handoff_summary).toContain(
      'Confirmar a identidade antes de cancelar.',
    )
    expect(h.state.tracePayload).toMatchObject({ final_action: 'handoff' })
  })

  it('disables auto-reply, writes a summary, and sends the handoff notice', async () => {
    h.generateReply.mockResolvedValue({ text: '', handoff: true })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
    expect(h.state.updatePayload?.ai_handoff_summary).toContain('Motivo:')
    expect(h.engineSendText).toHaveBeenCalledOnce()
  })

  it('routes to the configured handoff agent on handoff', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ handoffAgentId: 'agent-7' }))
    h.generateReply.mockResolvedValue({ text: '', handoff: true })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true, assigned_agent_id: 'agent-7' })
  })
})
