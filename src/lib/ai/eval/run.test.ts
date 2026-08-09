import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_COMMERCIAL_STRATEGY } from '../commercial-strategy'
import type { AiConfig } from '../types'
import { parseJudgeResult, runEvalSuite } from './run'

const config: AiConfig = {
  provider: 'openai',
  model: 'test-model',
  apiKey: 'test-key',
  systemPrompt: null,
  commercialStrategy: DEFAULT_COMMERCIAL_STRATEGY,
  isActive: true,
  autoReplyEnabled: true,
  autoReplyMaxPerConversation: 3,
  bufferWindowSeconds: 12,
  maxReplyChunks: 3,
  handoffAgentId: null,
  embeddingsApiKey: null,
}

describe('agent evaluation suite', () => {
  it('extracts and clamps the judge scores', () => {
    expect(
      parseJudgeResult(
        'Result: {"scores":[{"criterion_index":0,"score":1.2,"reason":"OK"},{"criterion_index":1,"score":-1,"reason":"No"}]}',
        ['first', 'second'],
      ),
    ).toEqual([
      { criterion: 'first', score: 1, reason: 'OK' },
      { criterion: 'second', score: 0, reason: 'No' },
    ])
  })

  it('scores cases and detects regression against a baseline', async () => {
    const generate = vi.fn(async ({ systemPrompt }: { systemPrompt: string }) =>
      systemPrompt.includes('strict customer-support response evaluator')
        ? {
            text: JSON.stringify({
              scores: [
                { criterion_index: 0, score: 0.8, reason: 'Mostly met' },
                { criterion_index: 1, score: 0.8, reason: 'Mostly met' },
              ],
            }),
            handoff: false,
            usage: null,
          }
        : { text: 'Resposta segura.', handoff: false, usage: null },
    )

    const result = await runEvalSuite(
      config,
      [
        {
          id: 'case-1',
          description: 'A test case',
          conversation: [{ role: 'user', content: 'Olá' }],
          criteria: ['First', 'Second'],
        },
      ],
      {
        generate,
        baselineScore: 0.9,
        allowedRegression: 0.02,
      },
    )

    expect(result.score).toBeCloseTo(0.8)
    expect(result.regression).toBeCloseTo(-0.1)
    expect(result.passed).toBe(false)
    expect(generate).toHaveBeenCalledTimes(2)
  })
})
