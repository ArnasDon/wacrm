import { describe, it, expect, vi } from 'vitest'

const h = vi.hoisted(() => ({ generateJson: vi.fn() }))
vi.mock('./generate-json', () => ({ generateJson: h.generateJson }))

import { generateAutomationFromPrompt } from './automation-generate'
import type { AiConfig } from './types'
import type { AutomationResources } from '@/lib/automations/resources'

function config(): AiConfig {
  return {
    accountId: 'acct-1',
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    agentEnabled: false,
    pipelineMoveEnabled: false,
    knowledgeEnabled: false,
    embeddingsModel: 'text-embedding-3-small',
    embeddingsApiKey: null,
    autoReplyMaxPerConversation: 3,
    handoffAgentId: null,
  }
}

const RESOURCES: AutomationResources = {
  tags: [{ id: 'tag-vip', name: 'VIP' }],
  pipelines: [{ id: 'pipe-1', name: 'Sales', stages: [{ id: 'stage-1', name: 'New' }] }],
}

describe('generateAutomationFromPrompt', () => {
  it('returns a draft when the model is confident', async () => {
    h.generateJson.mockResolvedValue({
      data: {
        kind: 'draft',
        name: 'Tag VIP customers',
        description: 'Tags anyone who mentions refund',
        trigger_type: 'keyword_match',
        trigger_config: { keywords: ['refund'], match_type: 'contains' },
        steps: [{ step_type: 'add_tag', step_config: { tag_id: 'tag-vip' }, branch: null, parent_index: null }],
      },
      usage: null,
    })
    const result = await generateAutomationFromPrompt({
      config: config(),
      history: [{ role: 'user', text: 'tag VIP when someone says refund' }],
      resources: RESOURCES,
    })
    expect(result.kind).toBe('draft')
    if (result.kind === 'draft') {
      expect(result.automation.trigger_type).toBe('keyword_match')
      expect(result.automation.steps).toEqual([
        { step_type: 'add_tag', step_config: { tag_id: 'tag-vip' }, branch: null, parent_index: null },
      ])
    }
  })

  it('returns a clarifying question when the model asks one', async () => {
    h.generateJson.mockResolvedValue({ data: { kind: 'question', text: 'Which tag should I use?' }, usage: null })
    const result = await generateAutomationFromPrompt({
      config: config(),
      history: [{ role: 'user', text: 'tag people who ask about pricing' }],
      resources: RESOURCES,
    })
    expect(result).toEqual({ kind: 'question', text: 'Which tag should I use?' })
  })

  it('blanks a hallucinated tag_id in a draft instead of passing it through', async () => {
    h.generateJson.mockResolvedValue({
      data: {
        kind: 'draft',
        name: 'x',
        trigger_type: 'keyword_match',
        trigger_config: {},
        steps: [{ step_type: 'add_tag', step_config: { tag_id: 'made-up-tag' } }],
      },
      usage: null,
    })
    const result = await generateAutomationFromPrompt({ config: config(), history: [], resources: RESOURCES })
    if (result.kind === 'draft') {
      expect(result.automation.steps[0].step_config.tag_id).toBe('')
    } else {
      throw new Error('expected a draft')
    }
  })

  it('drops a step whose step_type is not in the allowed generation list', async () => {
    h.generateJson.mockResolvedValue({
      data: {
        kind: 'draft',
        name: 'x',
        trigger_type: 'new_message_received',
        trigger_config: {},
        steps: [
          { step_type: 'send_webhook', step_config: { url: 'http://evil.example' } },
          { step_type: 'send_message', step_config: { text: 'hi' } },
        ],
      },
      usage: null,
    })
    const result = await generateAutomationFromPrompt({ config: config(), history: [], resources: RESOURCES })
    if (result.kind === 'draft') {
      expect(result.automation.steps).toHaveLength(1)
      expect(result.automation.steps[0].step_type).toBe('send_message')
    } else {
      throw new Error('expected a draft')
    }
  })

  it('falls back to a safe kind when the model returns something unrecognized', async () => {
    h.generateJson.mockResolvedValue({ data: { foo: 'bar' }, usage: null })
    const result = await generateAutomationFromPrompt({ config: config(), history: [], resources: RESOURCES })
    expect(result.kind).toBe('question')
  })

  it('remaps parent_index correctly when an earlier raw step is dropped, instead of self-referencing', async () => {
    h.generateJson.mockResolvedValue({
      data: {
        kind: 'draft',
        name: 'x',
        trigger_type: 'new_message_received',
        trigger_config: {},
        steps: [
          // raw index 0: dropped (not in ALLOWED_STEPS)
          { step_type: 'send_webhook', step_config: { url: 'http://evil.example' } },
          // raw index 1: kept -> should land at output index 0
          { step_type: 'condition', step_config: { subject: 'tag_presence', operand: 'tag-vip' } },
          // raw index 2: kept -> should land at output index 1, parent_index (raw 1) should
          // remap to output index 0, NOT to its own output index (1) or raw index (1 < 2 is
          // true but that's the wrong array's indexing).
          {
            step_type: 'add_tag',
            step_config: { tag_id: 'tag-vip' },
            branch: 'yes',
            parent_index: 1,
          },
        ],
      },
      usage: null,
    })
    const result = await generateAutomationFromPrompt({ config: config(), history: [], resources: RESOURCES })
    if (result.kind !== 'draft') throw new Error('expected a draft')
    expect(result.automation.steps).toHaveLength(2)
    expect(result.automation.steps[0].step_type).toBe('condition')
    expect(result.automation.steps[1].step_type).toBe('add_tag')
    expect(result.automation.steps[1].parent_index).toBe(0)
    expect(result.automation.steps[1].branch).toBe('yes')
  })

  it('never accepts a parent_index that points at or beyond a step\'s own output position', async () => {
    h.generateJson.mockResolvedValue({
      data: {
        kind: 'draft',
        name: 'x',
        trigger_type: 'new_message_received',
        trigger_config: {},
        steps: [
          // self-reference: parent_index equals its own raw index
          { step_type: 'add_tag', step_config: { tag_id: 'tag-vip' }, branch: 'yes', parent_index: 0 },
          // self-reference: parent_index equals its own raw index (index 1
          // pointing at 1) — not a genuine forward reference to a later
          // step, since there is no step at index 2 or beyond here.
          { step_type: 'add_tag', step_config: { tag_id: 'tag-vip' }, branch: 'yes', parent_index: 1 },
        ],
      },
      usage: null,
    })
    const result = await generateAutomationFromPrompt({ config: config(), history: [], resources: RESOURCES })
    if (result.kind !== 'draft') throw new Error('expected a draft')
    expect(result.automation.steps[0].parent_index).toBeNull()
    expect(result.automation.steps[0].branch).toBeNull()
    expect(result.automation.steps[1].parent_index).toBeNull()
    expect(result.automation.steps[1].branch).toBeNull()
  })

  it('never accepts a genuine forward reference: parent_index pointing at a later step in the array', async () => {
    h.generateJson.mockResolvedValue({
      data: {
        kind: 'draft',
        name: 'x',
        trigger_type: 'new_message_received',
        trigger_config: {},
        steps: [
          // raw index 0: points at raw index 1, which comes later in the
          // array — a genuine forward reference, not a self-reference.
          { step_type: 'add_tag', step_config: { tag_id: 'tag-vip' }, branch: 'yes', parent_index: 1 },
          { step_type: 'condition', step_config: { subject: 'tag_presence', operand: 'tag-vip' } },
        ],
      },
      usage: null,
    })
    const result = await generateAutomationFromPrompt({ config: config(), history: [], resources: RESOURCES })
    if (result.kind !== 'draft') throw new Error('expected a draft')
    expect(result.automation.steps[0].step_type).toBe('add_tag')
    expect(result.automation.steps[0].parent_index).toBeNull()
    expect(result.automation.steps[0].branch).toBeNull()
  })

  it('blanks a hallucinated tag_id in a tag_added trigger_config instead of passing it through', async () => {
    h.generateJson.mockResolvedValue({
      data: {
        kind: 'draft',
        name: 'x',
        trigger_type: 'tag_added',
        trigger_config: { tag_id: 'made-up-tag' },
        steps: [],
      },
      usage: null,
    })
    const result = await generateAutomationFromPrompt({ config: config(), history: [], resources: RESOURCES })
    if (result.kind !== 'draft') throw new Error('expected a draft')
    expect(result.automation.trigger_config.tag_id).toBe('')
  })

  it('blanks a hallucinated pipeline_id in a deal_stage_changed trigger_config instead of passing it through', async () => {
    h.generateJson.mockResolvedValue({
      data: {
        kind: 'draft',
        name: 'x',
        trigger_type: 'deal_stage_changed',
        trigger_config: { pipeline_id: 'made-up-pipeline' },
        steps: [],
      },
      usage: null,
    })
    const result = await generateAutomationFromPrompt({ config: config(), history: [], resources: RESOURCES })
    if (result.kind !== 'draft') throw new Error('expected a draft')
    expect(result.automation.trigger_config.pipeline_id).toBe('')
  })

  it('passes through a real tag_id/pipeline_id in trigger_config unchanged', async () => {
    h.generateJson.mockResolvedValue({
      data: {
        kind: 'draft',
        name: 'x',
        trigger_type: 'tag_added',
        trigger_config: { tag_id: 'tag-vip' },
        steps: [],
      },
      usage: null,
    })
    const result = await generateAutomationFromPrompt({ config: config(), history: [], resources: RESOURCES })
    if (result.kind !== 'draft') throw new Error('expected a draft')
    expect(result.automation.trigger_config.tag_id).toBe('tag-vip')

    h.generateJson.mockResolvedValue({
      data: {
        kind: 'draft',
        name: 'x',
        trigger_type: 'deal_stage_changed',
        trigger_config: { pipeline_id: 'pipe-1' },
        steps: [],
      },
      usage: null,
    })
    const result2 = await generateAutomationFromPrompt({ config: config(), history: [], resources: RESOURCES })
    if (result2.kind !== 'draft') throw new Error('expected a draft')
    expect(result2.automation.trigger_config.pipeline_id).toBe('pipe-1')
  })
})
