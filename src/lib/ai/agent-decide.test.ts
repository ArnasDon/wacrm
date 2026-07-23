import { describe, it, expect, vi } from 'vitest'

const h = vi.hoisted(() => ({ generateJson: vi.fn() }))
vi.mock('./generate-json', () => ({ generateJson: h.generateJson }))

import { decideAgentAction } from './agent-decide'
import type { AiConfig } from './types'
import type { AutomationResources } from '@/lib/automations/resources'
import type { AgentContext } from './agent-context'

function config(): AiConfig {
  return {
    accountId: 'acct-1',
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    agentEnabled: true,
    pipelineMoveEnabled: true,
    autoReplyMaxPerConversation: 3,
    handoffAgentId: null,
  }
}

const RESOURCES: AutomationResources = {
  tags: [{ id: 'tag-vip', name: 'VIP' }],
  pipelines: [
    {
      id: 'pipe-1',
      name: 'Sales',
      stages: [
        { id: 'stage-1', name: 'New' },
        { id: 'stage-2', name: 'Won' },
      ],
    },
  ],
}

const CONTEXT: AgentContext = {
  messages: [{ role: 'customer', text: 'I want to buy the pro plan' }],
  dealId: 'deal-1',
  currentStageId: 'stage-1',
  currentPipelineId: 'pipe-1',
  knowledge: [],
}

describe('decideAgentAction', () => {
  it('passes through a well-formed decision untouched', async () => {
    h.generateJson.mockResolvedValue({
      data: {
        reply_text: 'Great, let me help you with that!',
        add_tags: ['tag-vip'],
        remove_tags: [],
        move_to_stage_id: 'stage-2',
        handoff: false,
        handoff_reason: null,
      },
      usage: null,
    })
    const result = await decideAgentAction({
      config: config(),
      resources: RESOURCES,
      context: CONTEXT,
    })
    expect(result.reply_text).toBe('Great, let me help you with that!')
    expect(result.add_tags).toEqual(['tag-vip'])
    expect(result.move_to_stage_id).toBe('stage-2')
    expect(result.handoff).toBe(false)
  })

  it('blanks a hallucinated tag id instead of passing it through', async () => {
    h.generateJson.mockResolvedValue({
      data: {
        reply_text: null,
        add_tags: ['made-up-tag'],
        remove_tags: [],
        move_to_stage_id: null,
        handoff: false,
        handoff_reason: null,
      },
      usage: null,
    })
    const result = await decideAgentAction({
      config: config(),
      resources: RESOURCES,
      context: CONTEXT,
    })
    expect(result.add_tags).toEqual([])
  })

  it('drops a hallucinated stage id instead of passing it through', async () => {
    h.generateJson.mockResolvedValue({
      data: {
        reply_text: null,
        add_tags: [],
        remove_tags: [],
        move_to_stage_id: 'fake-stage',
        handoff: false,
        handoff_reason: null,
      },
      usage: null,
    })
    const result = await decideAgentAction({
      config: config(),
      resources: RESOURCES,
      context: CONTEXT,
    })
    expect(result.move_to_stage_id).toBeNull()
  })

  it('forces handoff true when the model omits required fields ambiguously but sets handoff', async () => {
    h.generateJson.mockResolvedValue({
      data: {
        reply_text: null,
        add_tags: [],
        remove_tags: [],
        move_to_stage_id: null,
        handoff: true,
        handoff_reason: 'needs a human',
      },
      usage: null,
    })
    const result = await decideAgentAction({
      config: config(),
      resources: RESOURCES,
      context: CONTEXT,
    })
    expect(result.handoff).toBe(true)
    expect(result.handoff_reason).toBe('needs a human')
  })

  it('caps an oversized reply_text at 4096 chars (WhatsApp text message limit)', async () => {
    const oversized = 'x'.repeat(5000)
    h.generateJson.mockResolvedValue({
      data: {
        reply_text: oversized,
        add_tags: [],
        remove_tags: [],
        move_to_stage_id: null,
        handoff: false,
        handoff_reason: null,
      },
      usage: null,
    })
    const result = await decideAgentAction({
      config: config(),
      resources: RESOURCES,
      context: CONTEXT,
    })
    expect(result.reply_text).toHaveLength(4096)
    expect(result.reply_text).toBe(oversized.slice(0, 4096))
  })

  it('defaults malformed fields to safe empty values rather than throwing', async () => {
    h.generateJson.mockResolvedValue({
      data: { reply_text: 123, add_tags: 'not-an-array' },
      usage: null,
    })
    const result = await decideAgentAction({
      config: config(),
      resources: RESOURCES,
      context: CONTEXT,
    })
    expect(result.reply_text).toBeNull()
    expect(result.add_tags).toEqual([])
    expect(result.handoff).toBe(false)
  })

  it('passes knowledge snippets into the prompt and sanitizes citations', async () => {
    h.generateJson.mockResolvedValue({
      data: {
        reply_text: 'Refunds are available within 7 days.',
        add_tags: [],
        remove_tags: [],
        move_to_stage_id: null,
        handoff: false,
        handoff_reason: null,
        citations: ['c1', 'not-real'],
      },
      usage: null,
    })

    const decision = await decideAgentAction({
      config: config(),
      resources: RESOURCES,
      context: {
        messages: [{ role: 'customer', text: 'Can I get a refund?' }],
        dealId: null,
        currentPipelineId: null,
        currentStageId: null,
        knowledge: [
          {
            chunkId: 'c1',
            documentId: 'd1',
            content: 'Refunds within 7 days.',
            score: 0.8,
            mode: 'fts',
          },
        ],
      },
    })

    expect(decision.citations).toEqual(['c1'])
    expect(h.generateJson).toHaveBeenCalledWith(
      expect.objectContaining({
        userPrompt: expect.stringContaining('Refunds within 7 days.'),
      })
    )
  })
})
