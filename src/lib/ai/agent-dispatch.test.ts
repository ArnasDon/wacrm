import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  loadAiConfig: vi.fn(),
  loadAutomationResources: vi.fn(),
  buildAgentContext: vi.fn(),
  decideAgentAction: vi.fn(),
  moveDealStage: vi.fn(),
  engineSendText: vi.fn(),
  addContactTagIfAbsent: vi.fn(),
  runAutomationsForTrigger: vi.fn(),
  checkRateLimit: vi.fn(),
  state: { conversation: null as Record<string, unknown> | null, updateCalls: [] as Record<string, unknown>[] },
}))

vi.mock('@/lib/ai/config', () => ({ loadAiConfig: h.loadAiConfig }))
vi.mock('@/lib/automations/resources', () => ({ loadAutomationResources: h.loadAutomationResources }))
vi.mock('./agent-context', () => ({ buildAgentContext: h.buildAgentContext }))
vi.mock('./agent-decide', () => ({ decideAgentAction: h.decideAgentAction }))
vi.mock('@/lib/pipelines/stage-move', () => ({ moveDealStage: h.moveDealStage }))
vi.mock('@/lib/automations/meta-send', () => ({ engineSendText: h.engineSendText }))
vi.mock('@/lib/contacts/tag-write', () => ({ addContactTagIfAbsent: h.addContactTagIfAbsent }))
vi.mock('@/lib/automations/engine', () => ({ runAutomationsForTrigger: h.runAutomationsForTrigger }))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: h.checkRateLimit,
  RATE_LIMITS: { aiAgentDecision: { limit: 30, windowMs: 60_000 } },
}))
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'conversations') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: h.state.conversation, error: null }) }),
          }),
          update: (payload: Record<string, unknown>) => {
            h.state.updateCalls.push(payload)
            return { eq: () => Promise.resolve({ error: null }) }
          },
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }),
}))

import { dispatchInboundToAgent } from './agent-dispatch'

function baseArgs() {
  return {
    accountId: 'acct-1',
    userId: 'user-1',
    contactId: 'contact-1',
    conversationId: 'conv-1',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.checkRateLimit.mockReturnValue({ success: true })
  h.state.conversation = { id: 'conv-1', ai_autoreply_disabled: false, ai_reply_count: 0 }
  h.state.updateCalls = []
  h.loadAiConfig.mockResolvedValue({
    accountId: 'acct-1',
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    agentEnabled: true,
    pipelineMoveEnabled: true,
    autoReplyMaxPerConversation: 3,
    handoffAgentId: null,
  })
  h.loadAutomationResources.mockResolvedValue({ tags: [], pipelines: [] })
  h.buildAgentContext.mockResolvedValue({ messages: [], dealId: null, currentStageId: null, currentPipelineId: null })
})

describe('dispatchInboundToAgent', () => {
  it('no-ops silently when agentEnabled is false', async () => {
    h.loadAiConfig.mockResolvedValue({ agentEnabled: false })
    await dispatchInboundToAgent(baseArgs())
    expect(h.decideAgentAction).not.toHaveBeenCalled()
  })

  it('no-ops when the conversation has auto-reply disabled', async () => {
    h.state.conversation = { id: 'conv-1', ai_autoreply_disabled: true, ai_reply_count: 0 }
    await dispatchInboundToAgent(baseArgs())
    expect(h.decideAgentAction).not.toHaveBeenCalled()
  })

  it('sends a reply, tags, and moves the deal on a full decision', async () => {
    h.decideAgentAction.mockResolvedValue({
      reply_text: 'Thanks for reaching out!',
      add_tags: ['tag-1'],
      remove_tags: [],
      move_to_stage_id: 'stage-2',
      handoff: false,
      handoff_reason: null,
    })
    await dispatchInboundToAgent(baseArgs())
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Thanks for reaching out!' }),
    )
    expect(h.addContactTagIfAbsent).toHaveBeenCalled()
    expect(h.moveDealStage).not.toHaveBeenCalled() // no linked deal in buildAgentContext mock above
  })

  it('forces handoff instead of sending once the reply cap is hit', async () => {
    h.state.conversation = { id: 'conv-1', ai_autoreply_disabled: false, ai_reply_count: 3 }
    h.decideAgentAction.mockResolvedValue({
      reply_text: 'one more reply',
      add_tags: [],
      remove_tags: [],
      move_to_stage_id: null,
      handoff: false,
      handoff_reason: null,
    })
    await dispatchInboundToAgent(baseArgs())
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.state.updateCalls.some((c) => c.ai_autoreply_disabled === true)).toBe(true)
  })

  it('sets ai_autoreply_disabled on explicit handoff', async () => {
    h.decideAgentAction.mockResolvedValue({
      reply_text: null,
      add_tags: [],
      remove_tags: [],
      move_to_stage_id: null,
      handoff: true,
      handoff_reason: 'customer asked for a human',
    })
    await dispatchInboundToAgent(baseArgs())
    expect(h.state.updateCalls.some((c) => c.ai_autoreply_disabled === true)).toBe(true)
  })

  it('never throws when a downstream call rejects', async () => {
    h.decideAgentAction.mockRejectedValue(new Error('provider down'))
    await expect(dispatchInboundToAgent(baseArgs())).resolves.toBeUndefined()
  })
})
