import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  loadAiConfig: vi.fn(),
  loadAutomationResources: vi.fn(),
  buildAgentContext: vi.fn(),
  attachKnowledgeToAgentContext: vi.fn(),
  decideAgentAction: vi.fn(),
  moveDealStage: vi.fn(),
  engineSendText: vi.fn(),
  addContactTagIfAbsent: vi.fn(),
  removeContactTag: vi.fn(),
  runAutomationsForTrigger: vi.fn(),
  checkRateLimit: vi.fn(),
  createAiRun: vi.fn(),
  completeAiRun: vi.fn(),
  logAiRetrievalEvent: vi.fn(),
  logAiToolCall: vi.fn(),
  routeAgentRole: vi.fn(),
  loadAgentDefinitions: vi.fn(),
  // Mocks the `claim_ai_reply_slot` RPC (the real atomicity now lives in
  // the Postgres function body itself — supabase/migrations/
  // 039_ai_reply_cap_rpc.sql — not in this mock).
  claimAiReplySlot: vi.fn(),
  state: {
    conversation: null as Record<string, unknown> | null,
    conversationSelectFilters: [] as Array<Array<[string, unknown]>>,
    updateCalls: [] as Record<string, unknown>[],
    updateFilters: [] as Array<Array<[string, unknown]>>,
  },
}))

vi.mock('@/lib/ai/config', () => ({ loadAiConfig: h.loadAiConfig }))
vi.mock('@/lib/automations/resources', () => ({
  loadAutomationResources: h.loadAutomationResources,
}))
vi.mock('./agent-context', () => ({
  buildAgentContext: h.buildAgentContext,
  attachKnowledgeToAgentContext: h.attachKnowledgeToAgentContext,
}))
vi.mock('./agent-decide', () => ({ decideAgentAction: h.decideAgentAction }))
vi.mock('@/lib/pipelines/stage-move', () => ({
  moveDealStage: h.moveDealStage,
}))
vi.mock('@/lib/automations/zapi-send', () => ({
  engineSendText: h.engineSendText,
}))
vi.mock('@/lib/contacts/tag-write', () => ({
  addContactTagIfAbsent: h.addContactTagIfAbsent,
  removeContactTag: h.removeContactTag,
}))
vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger: h.runAutomationsForTrigger,
}))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: h.checkRateLimit,
  RATE_LIMITS: { aiAgentDecision: { limit: 30, windowMs: 60_000 } },
}))
vi.mock('./run-log', () => ({
  createAiRun: h.createAiRun,
  completeAiRun: h.completeAiRun,
  logAiRetrievalEvent: h.logAiRetrievalEvent,
  logAiToolCall: h.logAiToolCall,
}))
vi.mock('./agent-router', () => ({ routeAgentRole: h.routeAgentRole }))
vi.mock('./agent-registry', () => ({
  loadAgentDefinitions: h.loadAgentDefinitions,
}))
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'conversations') {
        return {
          select: () => {
            const filters: Array<[string, unknown]> = []
            h.state.conversationSelectFilters.push(filters)
            const query = {
              eq: (column: string, value: unknown) => {
                filters.push([column, value])
                return query
              },
              maybeSingle: () => Promise.resolve({ data: h.state.conversation, error: null }),
            }
            return query
          },
          update: (payload: Record<string, unknown>) => {
            h.state.updateCalls.push(payload)
            const filters: Array<[string, unknown]> = []
            h.state.updateFilters.push(filters)
            const query = {
              eq: (column: string, value: unknown) => {
                filters.push([column, value])
                return query
              },
              error: null,
            }
            return query
          },
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
    rpc: (fn: string, args: Record<string, unknown>) => {
      if (fn === 'claim_ai_reply_slot') return h.claimAiReplySlot(args)
      throw new Error(`unexpected rpc ${fn}`)
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
  h.state.conversation = {
    id: 'conv-1',
    ai_autoreply_disabled: false,
    last_message_text: 'Can I get a refund?',
  }
  h.state.conversationSelectFilters = []
  h.state.updateCalls = []
  h.state.updateFilters = []
  // Default: the reply-cap RPC claims successfully. Tests that need the
  // cap already hit override this per-test.
  h.claimAiReplySlot.mockResolvedValue({ data: true, error: null })
  h.loadAiConfig.mockResolvedValue({
    accountId: 'acct-1',
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    agentEnabled: true,
    pipelineMoveEnabled: true,
    knowledgeEnabled: true,
    embeddingsModel: 'text-embedding-3-small',
    embeddingsApiKey: null,
    autoReplyMaxPerConversation: 3,
    handoffAgentId: null,
  })
  h.loadAutomationResources.mockResolvedValue({ tags: [], pipelines: [] })
  h.buildAgentContext.mockResolvedValue({
    messages: [{ role: 'customer', text: 'Can I get a refund?' }],
    dealId: null,
    currentStageId: null,
    currentPipelineId: null,
    knowledge: [],
  })
  h.attachKnowledgeToAgentContext.mockResolvedValue({
    messages: [{ role: 'customer', text: 'Can I get a refund?' }],
    dealId: null,
    currentStageId: null,
    currentPipelineId: null,
    knowledge: [
      {
        chunkId: 'c1',
        documentId: 'd1',
        content: 'Refunds within 7 days',
        score: 0.8,
        mode: 'fts',
      },
    ],
  })
  h.addContactTagIfAbsent.mockResolvedValue(true)
  h.removeContactTag.mockResolvedValue(undefined)
  h.engineSendText.mockResolvedValue({ whatsapp_message_id: 'wamid-1' })
  h.createAiRun.mockResolvedValue('run-1')
  h.completeAiRun.mockResolvedValue(undefined)
  h.logAiRetrievalEvent.mockResolvedValue(undefined)
  h.logAiToolCall.mockResolvedValue(undefined)
  h.routeAgentRole.mockResolvedValue('support')
  h.loadAgentDefinitions.mockResolvedValue([
    {
      role: 'support',
      name: 'Support',
      instructions: 'Answer account questions.',
      enabled: true,
      allowedActions: ['send_message', 'add_tag', 'remove_tag', 'move_deal_stage', 'assign_conversation'],
      knowledgeEnabled: true,
    },
  ])
})

describe('dispatchInboundToAgent', () => {
  it('no-ops silently when agentEnabled is false', async () => {
    h.loadAiConfig.mockResolvedValue({ agentEnabled: false })
    await dispatchInboundToAgent(baseArgs())
    expect(h.decideAgentAction).not.toHaveBeenCalled()
    expect(h.createAiRun).not.toHaveBeenCalled()
  })

  it('no-ops when the conversation has auto-reply disabled', async () => {
    h.state.conversation = { id: 'conv-1', ai_autoreply_disabled: true }
    await dispatchInboundToAgent(baseArgs())
    expect(h.decideAgentAction).not.toHaveBeenCalled()
  })

  it('stops before transcript or provider work when the conversation is outside the account', async () => {
    h.state.conversation = null

    await dispatchInboundToAgent({ ...baseArgs(), accountId: 'acct-2' })

    expect(h.state.conversationSelectFilters).toEqual([
      [
        ['id', 'conv-1'],
        ['account_id', 'acct-2'],
      ],
    ])
    expect(h.buildAgentContext).not.toHaveBeenCalled()
    expect(h.loadAutomationResources).not.toHaveBeenCalled()
    expect(h.loadAgentDefinitions).not.toHaveBeenCalled()
    expect(h.routeAgentRole).not.toHaveBeenCalled()
    expect(h.decideAgentAction).not.toHaveBeenCalled()
    expect(h.attachKnowledgeToAgentContext).not.toHaveBeenCalled()
    expect(h.claimAiReplySlot).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('sends a reply, tags, and moves the deal on a full decision', async () => {
    const initialContext = {
      messages: [{ role: 'customer' as const, text: 'Can I get a refund?' }],
      dealId: null,
      currentStageId: null,
      currentPipelineId: null,
      knowledge: [],
    }
    const contextWithKnowledge = {
      ...initialContext,
      knowledge: [
        {
          chunkId: 'c1',
          documentId: 'd1',
          content: 'Refunds within 7 days',
          score: 0.8,
          mode: 'fts',
        },
      ],
    }
    h.buildAgentContext.mockResolvedValue(initialContext)
    h.attachKnowledgeToAgentContext.mockResolvedValue(contextWithKnowledge)
    h.claimAiReplySlot.mockResolvedValue({ data: true, error: null })
    h.decideAgentAction.mockResolvedValue({
      reply_text: 'Thanks for reaching out!',
      add_tags: ['tag-1'],
      remove_tags: [],
      move_to_stage_id: 'stage-2',
      handoff: false,
      handoff_reason: null,
      citations: [],
    })
    await dispatchInboundToAgent(baseArgs())
    expect(h.createAiRun).toHaveBeenCalledTimes(1)
    expect(h.createAiRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        accountId: 'acct-1',
        conversationId: 'conv-1',
        userId: 'user-1',
        surface: 'whatsapp_agent',
        agentRole: 'support',
        provider: 'openai',
        model: 'gpt-test',
        metadata: {
          routedAgentRole: 'support',
          effectiveAgentRole: 'support',
          specialistName: 'Support',
        },
      }),
    )
    expect(h.routeAgentRole).toHaveBeenCalledWith({
      config: expect.objectContaining({
        provider: 'openai',
        model: 'gpt-test',
      }),
      message: 'Can I get a refund?',
    })
    expect(h.loadAgentDefinitions).toHaveBeenCalledWith(expect.anything(), 'acct-1')
    expect(h.buildAgentContext).toHaveBeenCalledTimes(1)
    expect(h.buildAgentContext).toHaveBeenCalledWith(expect.anything(), {
      accountId: 'acct-1',
      conversationId: 'conv-1',
    })
    expect(h.attachKnowledgeToAgentContext).toHaveBeenCalledWith(
      expect.anything(),
      initialContext,
      { enabled: true, query: 'Can I get a refund?', embedding: null },
      'acct-1',
    )
    expect(h.decideAgentAction).toHaveBeenCalledWith(expect.objectContaining({ context: contextWithKnowledge }))
    expect(h.logAiRetrievalEvent).toHaveBeenCalledWith(expect.anything(), {
      accountId: 'acct-1',
      runId: 'run-1',
      query: 'Can I get a refund?',
      retrievalMode: 'fts',
      chunkIds: ['c1'],
      scores: [{ chunkId: 'c1', score: 0.8, mode: 'fts' }],
    })
    expect(h.claimAiReplySlot).toHaveBeenCalledWith({
      conversation_id: 'conv-1',
      max_replies: 3,
    })
    expect(h.engineSendText).toHaveBeenCalledWith(expect.objectContaining({ text: 'Thanks for reaching out!' }))
    expect(h.logAiToolCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        accountId: 'acct-1',
        runId: 'run-1',
        toolName: 'send_message',
        status: 'proposed',
      }),
    )
    expect(h.logAiToolCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        accountId: 'acct-1',
        runId: 'run-1',
        toolName: 'send_message',
        status: 'executed',
      }),
    )
    expect(h.completeAiRun).toHaveBeenCalledWith(expect.anything(), {
      runId: 'run-1',
      accountId: 'acct-1',
      status: 'completed',
    })
    expect(h.addContactTagIfAbsent).toHaveBeenCalled()
    expect(h.moveDealStage).not.toHaveBeenCalled() // no linked deal in buildAgentContext mock above
  })

  it('uses the latest customer message when an agent message is the final context entry', async () => {
    const customerMessage = 'I need help with my invoice'
    const outboundMessage = 'Your invoice has been sent'
    const initialContext = {
      messages: [
        { role: 'customer', text: customerMessage },
        { role: 'agent', text: outboundMessage },
      ],
      dealId: null,
      currentStageId: null,
      currentPipelineId: null,
      knowledge: [],
    }
    h.buildAgentContext.mockResolvedValue(initialContext)
    h.attachKnowledgeToAgentContext.mockResolvedValue({
      ...initialContext,
      knowledge: [],
    })
    h.decideAgentAction.mockResolvedValue({
      reply_text: null,
      add_tags: [],
      remove_tags: [],
      move_to_stage_id: null,
      handoff: false,
      handoff_reason: null,
      citations: [],
    })

    await dispatchInboundToAgent(baseArgs())

    expect(h.buildAgentContext).toHaveBeenCalledTimes(1)
    expect(h.attachKnowledgeToAgentContext).toHaveBeenCalledWith(
      expect.anything(),
      initialContext,
      { enabled: true, query: customerMessage, embedding: null },
      'acct-1',
    )
    expect(h.routeAgentRole).toHaveBeenCalledWith({
      config: expect.anything(),
      message: customerMessage,
    })
    expect(h.logAiRetrievalEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ query: customerMessage }),
    )
    expect(h.routeAgentRole).not.toHaveBeenCalledWith(expect.objectContaining({ message: outboundMessage }))
    expect(h.logAiRetrievalEvent).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ query: outboundMessage }),
    )
  })

  it('removes tags listed in decision.remove_tags', async () => {
    h.decideAgentAction.mockResolvedValue({
      reply_text: null,
      add_tags: [],
      remove_tags: ['tag-2'],
      move_to_stage_id: null,
      handoff: false,
      handoff_reason: null,
      citations: [],
    })
    await dispatchInboundToAgent(baseArgs())
    expect(h.removeContactTag).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        accountId: 'acct-1',
        contactId: 'contact-1',
        tagId: 'tag-2',
      }),
    )
  })

  it('forces handoff instead of sending once the reply cap is hit', async () => {
    // The RPC's own `WHERE ai_reply_count < max_replies` evaluates false
    // once the cap is already reached, so it returns false without
    // incrementing anything.
    h.claimAiReplySlot.mockResolvedValue({ data: false, error: null })
    h.decideAgentAction.mockResolvedValue({
      reply_text: 'one more reply',
      add_tags: [],
      remove_tags: [],
      move_to_stage_id: null,
      handoff: false,
      handoff_reason: null,
      citations: [],
    })
    await dispatchInboundToAgent(baseArgs())
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.state.updateCalls.some((c) => c.ai_autoreply_disabled === true)).toBe(true)
  })

  it('disables autoreply on reply cap even when the specialist cannot assign conversations', async () => {
    h.routeAgentRole.mockResolvedValue('sales')
    h.loadAgentDefinitions.mockResolvedValue([
      {
        role: 'sales',
        name: 'Sales',
        instructions: 'Qualify leads.',
        enabled: true,
        allowedActions: ['send_message'],
        knowledgeEnabled: true,
      },
    ])
    h.claimAiReplySlot.mockResolvedValue({ data: false, error: null })
    h.decideAgentAction.mockResolvedValue({
      reply_text: 'one more reply',
      add_tags: [],
      remove_tags: [],
      move_to_stage_id: null,
      handoff: false,
      handoff_reason: null,
      citations: [],
    })

    await dispatchInboundToAgent(baseArgs())

    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.state.updateCalls).toContainEqual({
      ai_autoreply_disabled: true,
      ai_handoff_summary: 'auto-reply cap reached',
    })
    expect(h.state.updateFilters).toContainEqual([
      ['id', 'conv-1'],
      ['account_id', 'acct-1'],
    ])
    expect(h.logAiToolCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        toolName: 'assign_conversation',
        status: 'skipped',
      }),
    )
  })

  it('hands off instead of sending when the reply-cap RPC reports the slot already claimed', async () => {
    // Wiring-correctness only: this asserts that dispatchInboundToAgent
    // calls the RPC with the right arguments and correctly branches on its
    // boolean result (true -> send, anything else -> handoff). It does NOT
    // exercise true concurrency — a JS-level mock can't simulate the
    // database-level atomicity of a Postgres function racing two real
    // connections. That guarantee now lives entirely in the
    // claim_ai_reply_slot function body itself (supabase/migrations/
    // 039_ai_reply_cap_rpc.sql), where the cap check and the increment
    // happen inside one server-side UPDATE. Two sequential dispatches here
    // stand in for "the second call raced against the first and lost":
    // the mock returns true then false, as claim_ai_reply_slot would for
    // two real concurrent callers with only one slot of headroom.
    h.claimAiReplySlot.mockResolvedValueOnce({ data: true, error: null })
    h.claimAiReplySlot.mockResolvedValueOnce({ data: false, error: null })
    h.engineSendText.mockResolvedValue({ whatsapp_message_id: 'wamid-1' })
    h.decideAgentAction.mockResolvedValue({
      reply_text: 'racing reply',
      add_tags: [],
      remove_tags: [],
      move_to_stage_id: null,
      handoff: false,
      handoff_reason: null,
      citations: [],
    })

    await dispatchInboundToAgent(baseArgs())
    await dispatchInboundToAgent(baseArgs())

    expect(h.claimAiReplySlot).toHaveBeenCalledTimes(2)
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
    expect(
      h.state.updateCalls.some(
        (c) => c.ai_autoreply_disabled === true && c.ai_handoff_summary === 'auto-reply cap reached',
      ),
    ).toBe(true)
  })

  it('sets ai_autoreply_disabled on explicit handoff', async () => {
    h.decideAgentAction.mockResolvedValue({
      reply_text: null,
      add_tags: [],
      remove_tags: [],
      move_to_stage_id: null,
      handoff: true,
      handoff_reason: 'customer asked for a human',
      citations: [],
    })
    await dispatchInboundToAgent(baseArgs())
    expect(h.state.updateCalls.some((c) => c.ai_autoreply_disabled === true)).toBe(true)
    expect(h.state.updateFilters).toContainEqual([
      ['id', 'conv-1'],
      ['account_id', 'acct-1'],
    ])
  })

  it('never throws when a downstream call rejects', async () => {
    h.decideAgentAction.mockRejectedValue(new Error('provider down'))
    await expect(dispatchInboundToAgent(baseArgs())).resolves.toBeUndefined()
    expect(h.completeAiRun).toHaveBeenCalledWith(expect.anything(), {
      runId: 'run-1',
      accountId: 'acct-1',
      status: 'failed',
      error: 'provider down',
    })
  })

  it('skips a routed specialist when its account definition is disabled', async () => {
    h.loadAgentDefinitions.mockResolvedValue([
      {
        role: 'support',
        name: 'Disabled Support',
        instructions: 'Do not run.',
        enabled: false,
        allowedActions: ['send_message'],
        knowledgeEnabled: true,
      },
    ])

    await dispatchInboundToAgent(baseArgs())

    expect(h.createAiRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        agentRole: 'support',
        metadata: expect.objectContaining({
          effectiveAgentRole: 'support',
          specialistName: 'Disabled Support',
        }),
      }),
    )
    expect(h.attachKnowledgeToAgentContext).not.toHaveBeenCalled()
    expect(h.decideAgentAction).not.toHaveBeenCalled()
    expect(h.completeAiRun).toHaveBeenCalledWith(expect.anything(), {
      accountId: 'acct-1',
      runId: 'run-1',
      status: 'skipped',
    })
  })

  it('rejects specialist actions outside allowedActions before CRM writes', async () => {
    h.loadAgentDefinitions.mockResolvedValue([
      {
        role: 'support',
        name: 'Restricted Support',
        instructions: 'Reply only.',
        enabled: true,
        allowedActions: ['send_message'],
        knowledgeEnabled: true,
      },
    ])
    h.buildAgentContext.mockResolvedValue({
      messages: [{ role: 'customer', text: 'Can I get a refund?' }],
      dealId: 'deal-1',
      currentStageId: 'stage-1',
      currentPipelineId: 'pipeline-1',
      knowledge: [],
    })
    h.attachKnowledgeToAgentContext.mockImplementation(async (_db, context) => context)
    h.decideAgentAction.mockResolvedValue({
      reply_text: null,
      add_tags: ['tag-1'],
      remove_tags: [],
      move_to_stage_id: 'stage-2',
      handoff: false,
      handoff_reason: null,
      citations: [],
    })

    await dispatchInboundToAgent(baseArgs())

    expect(h.addContactTagIfAbsent).not.toHaveBeenCalled()
    expect(h.moveDealStage).not.toHaveBeenCalled()
    expect(h.logAiToolCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        toolName: 'add_tag',
        status: 'rejected',
      }),
    )
  })

  it('does not retrieve or pass embeddings when account knowledge is disabled', async () => {
    h.loadAiConfig.mockResolvedValue({
      accountId: 'acct-1',
      provider: 'openai',
      model: 'gpt-test',
      apiKey: 'sk-test',
      agentEnabled: true,
      pipelineMoveEnabled: true,
      knowledgeEnabled: false,
      embeddingsModel: 'text-embedding-test',
      embeddingsApiKey: 'sk-embeddings',
      autoReplyMaxPerConversation: 3,
      handoffAgentId: null,
    })
    const initialContext = {
      messages: [{ role: 'customer' as const, text: 'Can I get a refund?' }],
      dealId: null,
      currentStageId: null,
      currentPipelineId: null,
      knowledge: [],
    }
    h.buildAgentContext.mockResolvedValue(initialContext)
    h.attachKnowledgeToAgentContext.mockResolvedValue(initialContext)
    h.decideAgentAction.mockResolvedValue({
      reply_text: null,
      add_tags: [],
      remove_tags: [],
      move_to_stage_id: null,
      handoff: false,
      handoff_reason: null,
      citations: [],
    })

    await dispatchInboundToAgent(baseArgs())

    expect(h.attachKnowledgeToAgentContext).toHaveBeenCalledWith(
      expect.anything(),
      initialContext,
      {
        enabled: false,
        query: 'Can I get a refund?',
        embedding: null,
      },
      'acct-1',
    )
    expect(h.logAiRetrievalEvent).not.toHaveBeenCalled()
    expect(h.decideAgentAction).toHaveBeenCalledWith(expect.objectContaining({ context: initialContext }))
  })

  it('passes embedding configuration only when account and specialist knowledge are enabled', async () => {
    h.loadAiConfig.mockResolvedValue({
      accountId: 'acct-1',
      provider: 'openai',
      model: 'gpt-test',
      apiKey: 'sk-test',
      agentEnabled: true,
      pipelineMoveEnabled: true,
      knowledgeEnabled: true,
      embeddingsModel: 'text-embedding-test',
      embeddingsApiKey: 'sk-embeddings',
      autoReplyMaxPerConversation: 3,
      handoffAgentId: null,
    })

    await dispatchInboundToAgent(baseArgs())

    expect(h.attachKnowledgeToAgentContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      {
        enabled: true,
        query: 'Can I get a refund?',
        embedding: {
          apiKey: 'sk-embeddings',
          model: 'text-embedding-test',
        },
      },
      'acct-1',
    )
  })

  it('disables retrieval when the routed specialist opts out of knowledge', async () => {
    h.loadAiConfig.mockResolvedValue({
      accountId: 'acct-1',
      provider: 'openai',
      model: 'gpt-test',
      apiKey: 'sk-test',
      agentEnabled: true,
      pipelineMoveEnabled: true,
      knowledgeEnabled: true,
      embeddingsModel: 'text-embedding-test',
      embeddingsApiKey: 'sk-embeddings',
      autoReplyMaxPerConversation: 3,
      handoffAgentId: null,
    })
    h.loadAgentDefinitions.mockResolvedValue([
      {
        role: 'support',
        name: 'Support Without Knowledge',
        instructions: 'Reply without knowledge retrieval.',
        enabled: true,
        allowedActions: ['send_message'],
        knowledgeEnabled: false,
      },
    ])

    await dispatchInboundToAgent(baseArgs())

    expect(h.attachKnowledgeToAgentContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      {
        enabled: false,
        query: 'Can I get a refund?',
        embedding: null,
      },
      'acct-1',
    )
    expect(h.logAiRetrievalEvent).not.toHaveBeenCalled()
  })
})
