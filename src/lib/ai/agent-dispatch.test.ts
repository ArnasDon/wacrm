import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  loadAiConfig: vi.fn(),
  loadAutomationResources: vi.fn(),
  buildAgentContext: vi.fn(),
  decideAgentAction: vi.fn(),
  moveDealStage: vi.fn(),
  engineSendText: vi.fn(),
  addContactTagIfAbsent: vi.fn(),
  removeContactTag: vi.fn(),
  runAutomationsForTrigger: vi.fn(),
  checkRateLimit: vi.fn(),
  state: {
    conversation: null as Record<string, unknown> | null,
    updateCalls: [] as Record<string, unknown>[],
    // Controls the outcome of the atomic reply-cap claim update
    // (`.update(...).eq(...).lt(...).select(...).maybeSingle()`).
    // Defaults to "claim succeeds"; tests can override per-call via
    // `claimResults` (shifted off for each successive claim attempt) or
    // fall back to `claimResult` for a single fixed outcome.
    claimResult: { data: { id: 'conv-1' }, error: null } as { data: Record<string, unknown> | null; error: unknown },
    claimResults: null as Array<{ data: Record<string, unknown> | null; error: unknown }> | null,
  },
}))

vi.mock('@/lib/ai/config', () => ({ loadAiConfig: h.loadAiConfig }))
vi.mock('@/lib/automations/resources', () => ({ loadAutomationResources: h.loadAutomationResources }))
vi.mock('./agent-context', () => ({ buildAgentContext: h.buildAgentContext }))
vi.mock('./agent-decide', () => ({ decideAgentAction: h.decideAgentAction }))
vi.mock('@/lib/pipelines/stage-move', () => ({ moveDealStage: h.moveDealStage }))
vi.mock('@/lib/automations/meta-send', () => ({ engineSendText: h.engineSendText }))
vi.mock('@/lib/contacts/tag-write', () => ({
  addContactTagIfAbsent: h.addContactTagIfAbsent,
  removeContactTag: h.removeContactTag,
}))
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
            // The reply-cap claim chains `.eq().lt().select().maybeSingle()`.
            // The handoff/other updates just `await` the `.eq(...)` call
            // directly. Support both shapes off the same `.eq()` return
            // value: it's a thenable (so a bare `await` resolves it like the
            // old `{ error: null }` update) that also exposes `.lt()`.
            return {
              eq: () => {
                const chain = {
                  lt: () => ({
                    select: () => ({
                      maybeSingle: () => {
                        const next = h.state.claimResults?.shift() ?? h.state.claimResult
                        return Promise.resolve(next)
                      },
                    }),
                  }),
                  then: (
                    resolve: (value: { error: null }) => void,
                    reject?: (reason: unknown) => void,
                  ) => Promise.resolve({ error: null }).then(resolve, reject),
                }
                return chain
              },
            }
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
  h.state.claimResult = { data: { id: 'conv-1' }, error: null }
  h.state.claimResults = null
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
  h.addContactTagIfAbsent.mockResolvedValue(true)
  h.removeContactTag.mockResolvedValue(undefined)
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

  it('removes tags listed in decision.remove_tags', async () => {
    h.decideAgentAction.mockResolvedValue({
      reply_text: null,
      add_tags: [],
      remove_tags: ['tag-2'],
      move_to_stage_id: null,
      handoff: false,
      handoff_reason: null,
    })
    await dispatchInboundToAgent(baseArgs())
    expect(h.removeContactTag).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ accountId: 'acct-1', contactId: 'contact-1', tagId: 'tag-2' }),
    )
  })

  it('forces handoff instead of sending once the reply cap is hit', async () => {
    h.state.conversation = { id: 'conv-1', ai_autoreply_disabled: false, ai_reply_count: 3 }
    // The conditional claim update's `.lt('ai_reply_count', cap)` finds no
    // matching row once the count is already at (or past) the cap, so
    // `maybeSingle()` resolves with no data — same as a lost race.
    h.state.claimResult = { data: null, error: null }
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

  it('skips sending when the atomic claim loses a race even though the initial read was under the cap', async () => {
    // Simulates two concurrent dispatches for the same conversation: both
    // read `ai_reply_count` under the cap, but only one's conditional
    // `.lt()` update can match the row. This test represents the loser:
    // the initial read looked fine, yet the claim still comes back empty
    // because a concurrent run already pushed the count to the cap.
    h.state.conversation = { id: 'conv-1', ai_autoreply_disabled: false, ai_reply_count: 2 }
    h.state.claimResult = { data: null, error: null }
    h.decideAgentAction.mockResolvedValue({
      reply_text: 'racing reply',
      add_tags: [],
      remove_tags: [],
      move_to_stage_id: null,
      handoff: false,
      handoff_reason: null,
    })
    await dispatchInboundToAgent(baseArgs())
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(
      h.state.updateCalls.some((c) => c.ai_autoreply_disabled === true && c.ai_handoff_summary === 'auto-reply cap reached'),
    ).toBe(true)
  })

  it('only sends for the first of two concurrent claims when only one slot remains', async () => {
    // Two concurrent dispatchInboundToAgent calls for the same conversation
    // where only one more reply slot is available: the first claim's
    // conditional update matches, the second's does not.
    h.state.conversation = { id: 'conv-1', ai_autoreply_disabled: false, ai_reply_count: 2 }
    h.state.claimResults = [
      { data: { id: 'conv-1' }, error: null },
      { data: null, error: null },
    ]
    h.engineSendText.mockResolvedValue({ whatsapp_message_id: 'wamid-1' })
    h.decideAgentAction.mockResolvedValue({
      reply_text: 'racing reply',
      add_tags: [],
      remove_tags: [],
      move_to_stage_id: null,
      handoff: false,
      handoff_reason: null,
    })
    await Promise.all([dispatchInboundToAgent(baseArgs()), dispatchInboundToAgent(baseArgs())])
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
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
