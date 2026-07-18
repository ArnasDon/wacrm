import { describe, expect, it, vi } from 'vitest'
import {
  AiAgentDecisionValidationError,
  buildAiAgentDecisionMessages,
  getAiAgentMaxOutputTokens,
  parseAiAgentDecisionJson,
  requestAiAgentDecision,
  validateAiAgentDecision,
} from './decision'

describe('getAiAgentMaxOutputTokens', () => {
  it.each([
    [undefined, 700],
    ['', 700],
    ['not-a-number', 700],
    ['127', 128],
    ['700', 700],
    ['2001', 2000],
  ])('uses the default and clamps configured output tokens', (value, expected) => {
    expect(getAiAgentMaxOutputTokens(value)).toBe(expected)
  })
  it('reads the configured output budget from the environment', () => {
    vi.stubEnv('AI_AGENT_MAX_OUTPUT_TOKENS', '2048')
    expect(getAiAgentMaxOutputTokens()).toBe(2000)
    vi.unstubAllEnvs()
  })
})

describe('parseAiAgentDecisionJson', () => {
  it.each(['', '{', 'not json'])('throws invalid_json for malformed JSON', (raw) => {
    expectInvalidJson(() => parseAiAgentDecisionJson(raw))
  })
})

describe('validateAiAgentDecision', () => {
  it('normalizes valid reply, no_reply, and handoff decisions', () => {
    expect(validateAiAgentDecision({
      action: 'reply',
      text: '  Hello there  ',
      confidence: 0.8,
      deal_action: { type: 'create', pipeline_id: ' pipeline-1 ', stage_id: ' stage-1 ', title: ' New deal ', value: 0 },
      ignored: true,
    })).toEqual({
      action: 'reply',
      text: 'Hello there',
      confidence: 0.8,
      deal_action: { type: 'create', pipeline_id: 'pipeline-1', stage_id: 'stage-1', title: 'New deal', value: 0 },
    })

    expect(validateAiAgentDecision({
      action: 'no_reply',
      reason: '  Waiting for customer  ',
      confidence: 1,
      deal_action: { type: 'none', ignored: true },
    })).toEqual({
      action: 'no_reply',
      reason: 'Waiting for customer',
      confidence: 1,
      deal_action: { type: 'none' },
    })

    expect(validateAiAgentDecision({ action: 'handoff', reason: '  Needs specialist  ', confidence: 0 })).toEqual({
      action: 'handoff',
      reason: 'Needs specialist',
      confidence: 0,
    })
  })

  it.each([
    { action: 'unknown', confidence: 0.5 },
    { action: 'reply', text: 'Hello', confidence: undefined },
    { action: 'reply', text: 'Hello', confidence: Number.NaN },
    { action: 'reply', text: 'Hello', confidence: 1.1 },
    { action: 'reply', text: '   ', confidence: 0.5 },
    { action: 'no_reply', reason: '', confidence: 0.5 },
    { action: 'handoff', reason: 1, confidence: 0.5 },
    { action: 'handoff', reason: 'Human needed', confidence: 0.5, deal_action: { type: 'none' } },
  ])('rejects an invalid top-level decision %#', (value) => {
    expectInvalidDecision(() => validateAiAgentDecision(value))
  })

  it.each([
    { type: 'create', pipeline_id: '', stage_id: 'stage-1', title: 'Deal' },
    { type: 'create', pipeline_id: 'pipeline-1', stage_id: ' ', title: 'Deal' },
    { type: 'create', pipeline_id: 'pipeline-1', stage_id: 'stage-1', title: '', value: -1 },
    { type: 'create', pipeline_id: 'pipeline-1', stage_id: 'stage-1', title: 'Deal', value: Number.POSITIVE_INFINITY },
    { type: 'move', deal_id: '', stage_id: 'stage-1', reason: 'Qualified' },
    { type: 'move', deal_id: 'deal-1', stage_id: '', reason: 'Qualified' },
    { type: 'move', deal_id: 'deal-1', stage_id: 'stage-1', reason: ' ' },
    { type: 'update', deal_id: '', title: 'New title' },
    { type: 'update', deal_id: 'deal-1' },
    { type: 'update', deal_id: 'deal-1', title: ' ' },
    { type: 'update', deal_id: 'deal-1', value: -1 },
    { type: 'update', deal_id: 'deal-1', expected_close_date: '2026/07/17' },
    { type: 'unexpected' },
  ])('rejects an invalid deal action %#', (deal_action) => {
    expectInvalidDecision(() => validateAiAgentDecision({
      action: 'reply',
      text: 'Hello',
      confidence: 0.5,
      deal_action,
    }))
  })

  it('normalizes valid move and update deal actions and strips unknown fields', () => {
    expect(validateAiAgentDecision({
      action: 'no_reply',
      reason: '  Moved automatically ',
      confidence: 0.5,
      deal_action: { type: 'move', deal_id: ' deal-1 ', stage_id: ' stage-2 ', reason: '  Qualified ', extra: 'remove' },
      extra: 'remove',
    })).toEqual({
      action: 'no_reply',
      reason: 'Moved automatically',
      confidence: 0.5,
      deal_action: { type: 'move', deal_id: 'deal-1', stage_id: 'stage-2', reason: 'Qualified' },
    })

    expect(validateAiAgentDecision({
      action: 'reply',
      text: 'Updated.',
      confidence: 0.5,
      deal_action: {
        type: 'update', deal_id: ' deal-1 ', title: ' Renewal ', value: 123.45,
        expected_close_date: '2026-12-31', ignored: true,
      },
    })).toEqual({
      action: 'reply',
      text: 'Updated.',
      confidence: 0.5,
      deal_action: {
        type: 'update', deal_id: 'deal-1', title: 'Renewal', value: 123.45, expected_close_date: '2026-12-31',
      },
    })
  })
})

describe('buildAiAgentDecisionMessages', () => {
  it('places instructions in the strict JSON system prompt and context in the user prompt', () => {
    const messages = buildAiAgentDecisionMessages({
      instructions: 'Escalate pricing questions.',
      context: { conversation: { id: 'conversation-1' } },
    })

    expect(messages.system).toContain('Escalate pricing questions.')
    expect(messages.system).toContain('strict JSON')
    expect(messages.user).toContain(JSON.stringify({ conversation: { id: 'conversation-1' } }, null, 2))
  })
})

describe('requestAiAgentDecision', () => {
  it('passes model and built messages to the provider and returns the parsed decision', async () => {
    const complete = vi.fn().mockResolvedValue(JSON.stringify({
      action: 'reply', text: '  Hello  ', confidence: 0.9,
    }))

    await expect(requestAiAgentDecision({
      model: 'test-model',
      instructions: 'Be helpful.',
      context: { id: 'conversation-1' },
      provider: { complete },
      maxOutputTokens: 512,
    })).resolves.toEqual({ action: 'reply', text: 'Hello', confidence: 0.9 })

    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      model: 'test-model',
      system: expect.stringContaining('Be helpful.'),
      user: expect.stringContaining('"conversation-1"'),
      maxOutputTokens: 512,
    }))
  })
})

function expectInvalidJson(run: () => unknown) {
  expect(run).toThrow(AiAgentDecisionValidationError)
  try {
    run()
  } catch (error) {
    expect(error).toMatchObject({ code: 'invalid_json' })
  }
}

function expectInvalidDecision(run: () => unknown) {
  expect(run).toThrow(AiAgentDecisionValidationError)
  try {
    run()
  } catch (error) {
    expect(error).toMatchObject({ code: 'invalid_decision' })
  }
}
