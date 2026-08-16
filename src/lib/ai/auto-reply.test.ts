import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AiConfig } from './types'

// Shared, hoisted mock state so the module mocks can close over it.
const h = vi.hoisted(() => ({
  loadAiConfig: vi.fn(),
  buildConversationContext: vi.fn(),
  retrieveKnowledge: vi.fn(),
  generateReply: vi.fn(),
  engineSendText: vi.fn(),
  moveDeal: vi.fn(),
  findWonStageId: vi.fn(),
  dispatchWebhookEvent: vi.fn(),
  state: {
    conv: null as Record<string, unknown> | null,
    autoResponders: [] as { id: string }[],
    claim: true as boolean,
    updatePayload: null as Record<string, unknown> | null,
    rpcCalls: [] as { name: string; args: unknown }[],
    openDeal: null as { id: string; pipeline_id: string } | null,
    aiActionLogInserts: [] as Record<string, unknown>[],
  },
}))

vi.mock('./config', () => ({ loadAiConfig: h.loadAiConfig }))
vi.mock('./context', () => ({ buildConversationContext: h.buildConversationContext }))
vi.mock('./knowledge', () => ({ retrieveKnowledge: h.retrieveKnowledge }))
vi.mock('./generate', () => ({ generateReply: h.generateReply }))
vi.mock('@/lib/flows/meta-send', () => ({ engineSendText: h.engineSendText }))
vi.mock('@/lib/webhooks/deliver', () => ({ dispatchWebhookEvent: h.dispatchWebhookEvent }))
vi.mock('@/lib/pipelines/move-deal', () => ({
  moveDeal: h.moveDeal,
  findWonStageId: h.findWonStageId,
  MoveDealError: class MoveDealError extends Error {
    status: number
    constructor(message: string, status = 400) {
      super(message)
      this.status = status
    }
  },
}))
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
  h.state.aiActionLogInserts = []
  h.loadAiConfig.mockResolvedValue(aiConfig())
  h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'hi' }])
  h.retrieveKnowledge.mockResolvedValue([])
  h.generateReply.mockResolvedValue({ text: 'Hello!', handoff: false, markDealWon: false })
  h.engineSendText.mockResolvedValue({ whatsapp_message_id: 'm1' })
  h.moveDeal.mockResolvedValue({
    deal: { id: 'deal-1', pipeline_id: 'pipe-1', stage_id: 'stage-won-1', status: 'won' },
    isWonStage: true,
  })
  h.findWonStageId.mockResolvedValue('stage-won-1')
  h.dispatchWebhookEvent.mockResolvedValue(undefined)
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
    h.generateReply.mockResolvedValue({ text: '', handoff: true })
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
    h.generateReply.mockResolvedValue({ text: '', handoff: true })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).toMatchObject({
      ai_autoreply_disabled: true,
      assigned_agent_id: 'agent-7',
    })
  })
})

describe('dispatchInboundToAiReply — autonomous mark_deal_won', () => {
  it('marks the contact\'s open deal won, with no confirmation gate, when the model signals it', async () => {
    h.generateReply.mockResolvedValue({ text: 'All set, thanks!', handoff: false, markDealWon: true })
    h.state.openDeal = { id: 'deal-1', pipeline_id: 'pipe-1' }

    await dispatchInboundToAiReply(ARGS)

    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'All set, thanks!' }),
    )
    expect(h.findWonStageId).toHaveBeenCalledWith(expect.anything(), 'acct-1', 'pipe-1')
    expect(h.moveDeal).toHaveBeenCalledWith(expect.anything(), 'acct-1', 'deal-1', 'stage-won-1')
    expect(h.state.aiActionLogInserts).toEqual([
      expect.objectContaining({
        account_id: 'acct-1',
        actor_user_id: 'user-1',
        action: 'mark_deal_won',
        target_id: 'deal-1',
        input: { source: 'auto_reply_autonomous' },
      }),
    ])
    expect(h.dispatchWebhookEvent).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      'deal.won',
      { deal_id: 'deal-1', source: 'auto_reply_autonomous' },
    )
  })

  it('does not touch any deal when the model does not signal confirmation', async () => {
    h.state.openDeal = { id: 'deal-1', pipeline_id: 'pipe-1' }
    await dispatchInboundToAiReply(ARGS) // default mock: markDealWon: false
    expect(h.moveDeal).not.toHaveBeenCalled()
    expect(h.state.aiActionLogInserts).toEqual([])
  })

  it('still sends the reply, and logs nothing, when the contact has no open deal', async () => {
    h.generateReply.mockResolvedValue({ text: 'Sure thing!', handoff: false, markDealWon: true })
    h.state.openDeal = null

    await dispatchInboundToAiReply(ARGS)

    expect(h.engineSendText).toHaveBeenCalled()
    expect(h.findWonStageId).not.toHaveBeenCalled()
    expect(h.moveDeal).not.toHaveBeenCalled()
    expect(h.state.aiActionLogInserts).toEqual([])
  })

  it('does not move the deal when the pipeline has no stage flagged is_won', async () => {
    h.generateReply.mockResolvedValue({ text: 'Sure thing!', handoff: false, markDealWon: true })
    h.state.openDeal = { id: 'deal-1', pipeline_id: 'pipe-1' }
    h.findWonStageId.mockResolvedValue(null)

    await dispatchInboundToAiReply(ARGS)

    expect(h.moveDeal).not.toHaveBeenCalled()
    expect(h.state.aiActionLogInserts).toEqual([])
  })

  it('swallows a moveDeal failure — the already-sent reply is unaffected', async () => {
    h.generateReply.mockResolvedValue({ text: 'Sure thing!', handoff: false, markDealWon: true })
    h.state.openDeal = { id: 'deal-1', pipeline_id: 'pipe-1' }
    h.moveDeal.mockRejectedValue(new Error('deal not found in this pipeline'))

    await expect(dispatchInboundToAiReply(ARGS)).resolves.toBeUndefined()
    expect(h.engineSendText).toHaveBeenCalled()
    expect(h.state.aiActionLogInserts).toEqual([])
  })
})
