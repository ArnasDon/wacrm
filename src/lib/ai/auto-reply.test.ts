import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DEFAULT_COMMERCIAL_STRATEGY } from './commercial-strategy'
import type { AiConfig } from './types'

const h = vi.hoisted(() => ({
  loadAiConfig: vi.fn(),
  buildConversationContext: vi.fn(),
  retrieveKnowledge: vi.fn(),
  generateReply: vi.fn(),
  engineSendText: vi.fn(),
  state: {
    conv: null as Record<string, unknown> | null,
    autoResponders: [] as { id: string }[],
    claim: true as boolean,
    updatePayload: null as Record<string, unknown> | null,
    rpcCalls: [] as { name: string; args: unknown }[],
  },
}))

vi.mock('./config', () => ({ loadAiConfig: h.loadAiConfig }))
vi.mock('./context', () => ({ buildConversationContext: h.buildConversationContext }))
vi.mock('./knowledge', () => ({ retrieveKnowledge: h.retrieveKnowledge }))
vi.mock('./generate', () => ({ generateReply: h.generateReply }))
vi.mock('@/lib/flows/meta-send', () => ({ engineSendText: h.engineSendText }))
vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'automations') {
        const chain = { select: () => chain, eq: () => chain, in: () => chain, limit: () => Promise.resolve({ data: h.state.autoResponders, error: null }) }
        return chain
      }
      return {
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: h.state.conv, error: null }) }) }),
        update: (payload: Record<string, unknown>) => { h.state.updatePayload = payload; return { eq: () => Promise.resolve({ error: null }) } },
      }
    },
    rpc: (name: string, args: unknown) => { h.state.rpcCalls.push({ name, args }); return Promise.resolve({ data: h.state.claim, error: null }) },
  }),
}))

import { dispatchInboundToAiReply } from './auto-reply'

const ARGS = { accountId: 'acct-1', conversationId: 'conv-1', contactId: 'contact-1', configOwnerUserId: 'user-1' }

function aiConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    agentId: 'agent-config-1',
    provider: 'openai', model: 'gpt-test', apiKey: 'sk-test', systemPrompt: null,
    commercialStrategy: DEFAULT_COMMERCIAL_STRATEGY,
    isActive: true, autoReplyEnabled: true, autoReplyMaxPerConversation: 3,
    handoffAgentId: null, embeddingsApiKey: null, ...overrides,
  }
}

beforeEach(() => {
  h.state.conv = { assigned_agent_id: null, ai_autoreply_disabled: false, ai_reply_count: 0 }
  h.state.autoResponders = []; h.state.claim = true; h.state.updatePayload = null; h.state.rpcCalls = []
  h.loadAiConfig.mockResolvedValue(aiConfig())
  h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'hi' }])
  h.retrieveKnowledge.mockResolvedValue([])
  h.generateReply.mockResolvedValue({ text: 'Hello!', handoff: false })
  h.engineSendText.mockResolvedValue({ whatsapp_message_id: 'm1' })
})

describe('dispatchInboundToAiReply — eligibility gates', () => {
  it('claims a slot and sends on the happy path', async () => {
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.rpcCalls).toEqual([{ name: 'claim_ai_reply_slot', args: { conversation_id: 'conv-1', max_replies: 3 } }])
    expect(h.engineSendText).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'conv-1', text: 'Hello!' }))
  })
  it('grounds the reply in retrieved knowledge', async () => {
    h.retrieveKnowledge.mockResolvedValue(['Returns accepted within 30 days.']); await dispatchInboundToAiReply(ARGS)
    expect(h.retrieveKnowledge).toHaveBeenCalled(); expect(h.generateReply.mock.calls[0][0].systemPrompt as string).toContain('Returns accepted within 30 days.')
  })
  it('stands down when an active message-level automation exists', async () => { h.state.autoResponders = [{ id: 'auto-1' }]; await dispatchInboundToAiReply(ARGS); expect(h.generateReply).not.toHaveBeenCalled() })
  it('does not send when the atomic slot claim loses the race', async () => { h.state.claim = false; await dispatchInboundToAiReply(ARGS); expect(h.engineSendText).not.toHaveBeenCalled() })
  it('skips when AI is off / not configured', async () => { h.loadAiConfig.mockResolvedValue(null); await dispatchInboundToAiReply(ARGS); expect(h.generateReply).not.toHaveBeenCalled() })
  it('skips when auto-reply is disabled for the account', async () => { h.loadAiConfig.mockResolvedValue(aiConfig({ autoReplyEnabled: false })); await dispatchInboundToAiReply(ARGS); expect(h.engineSendText).not.toHaveBeenCalled() })
  it('skips when a human agent is assigned', async () => { h.state.conv = { assigned_agent_id: 'agent-9', ai_autoreply_disabled: false, ai_reply_count: 0 }; await dispatchInboundToAiReply(ARGS); expect(h.engineSendText).not.toHaveBeenCalled() })
  it('skips when auto-reply was disabled on this conversation', async () => { h.state.conv = { assigned_agent_id: null, ai_autoreply_disabled: true, ai_reply_count: 0 }; await dispatchInboundToAiReply(ARGS); expect(h.engineSendText).not.toHaveBeenCalled() })
  it('skips when the per-conversation cap is reached', async () => { h.state.conv = { assigned_agent_id: null, ai_autoreply_disabled: false, ai_reply_count: 3 }; await dispatchInboundToAiReply(ARGS); expect(h.engineSendText).not.toHaveBeenCalled() })
  it('skips when there is nothing to reply to', async () => { h.buildConversationContext.mockResolvedValue([]); await dispatchInboundToAiReply(ARGS); expect(h.generateReply).not.toHaveBeenCalled() })
})

describe('dispatchInboundToAiReply — handoff', () => {
  it('disables auto-reply, writes a summary, and does not send on handoff', async () => {
    h.generateReply.mockResolvedValue({ text: '', handoff: true }); await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled(); expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true }); expect(h.state.updatePayload?.ai_handoff_summary).toContain('AI agent handed off')
  })
  it('routes to the configured handoff agent on handoff', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ handoffAgentId: 'agent-7' })); h.generateReply.mockResolvedValue({ text: '', handoff: true }); await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true, assigned_agent_id: 'agent-7' })
  })
})