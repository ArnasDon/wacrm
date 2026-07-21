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
          // forward reference: parent_index points at a later step
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
})
