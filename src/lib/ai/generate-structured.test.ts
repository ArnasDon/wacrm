import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const h = vi.hoisted(() => ({
  generateOpenAi: vi.fn(),
  generateAnthropic: vi.fn(),
}))
vi.mock('./providers/openai', () => ({ generateOpenAi: h.generateOpenAi }))
vi.mock('./providers/anthropic', () => ({ generateAnthropic: h.generateAnthropic }))

import { generateStructured } from './generate-structured'
import { AiError, type AiConfig } from './types'

function config(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    accountId: 'acct-1',
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    agentEnabled: true,
    pipelineMoveEnabled: true,
    autoReplyMaxPerConversation: 3,
    handoffAgentId: null,
    ...overrides,
  }
}

const schema = z.object({
  kind: z.literal('question'),
  text: z.string().min(1),
})

describe('generateStructured', () => {
  it('converts Zod to a common JSON Schema contract and defaults generation to 4096 tokens', async () => {
    h.generateOpenAi.mockResolvedValue({
      structuredData: { kind: 'question', text: 'Which tag?' },
      usage: { promptTokens: 10, completionTokens: 4 },
    })

    const result = await generateStructured({
      config: config(),
      schema,
      systemPrompt: 'system',
      userPrompt: 'user',
    })

    expect(result).toEqual({
      data: { kind: 'question', text: 'Which tag?' },
      usage: { promptTokens: 10, completionTokens: 4 },
    })
    expect(h.generateOpenAi).toHaveBeenCalledWith(
      expect.objectContaining({
        maxTokens: 4096,
        structuredOutput: {
          description:
            'Return exactly one structured response that matches the provided JSON schema.',
          name: 'emit_automation_turn',
          schema: expect.objectContaining({
            type: 'object',
            properties: expect.objectContaining({
              kind: expect.objectContaining({ const: 'question' }),
              text: expect.objectContaining({ type: 'string' }),
            }),
          }),
        },
      }),
    )
  })

  it('routes Anthropic and forwards a custom contract name and token limit', async () => {
    h.generateAnthropic.mockResolvedValue({
      structuredData: { kind: 'question', text: 'Which pipeline?' },
      usage: null,
    })

    await generateStructured({
      config: config({ provider: 'anthropic' }),
      schema,
      name: 'verify_automation_turn',
      maxTokens: 1024,
      systemPrompt: 'system',
      userPrompt: 'user',
    })

    expect(h.generateAnthropic).toHaveBeenCalledWith(
      expect.objectContaining({
        maxTokens: 1024,
        structuredOutput: expect.objectContaining({ name: 'verify_automation_turn' }),
      }),
    )
    expect(h.generateOpenAi).not.toHaveBeenCalled()
  })

  it('uses local Zod safeParse as the final authority', async () => {
    h.generateOpenAi.mockResolvedValue({
      structuredData: { kind: 'question', text: '' },
      usage: null,
    })

    const error = await generateStructured({
      config: config(),
      schema,
      systemPrompt: 'system',
      userPrompt: 'user',
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(AiError)
    expect(error).toMatchObject({ code: 'model_incompatible', status: 422 })
  })

  it('fails closed when a provider returns no native structured value', async () => {
    h.generateOpenAi.mockResolvedValue({ text: '{"kind":"question","text":"free JSON"}', usage: null })

    const error = await generateStructured({
      config: config(),
      schema,
      systemPrompt: 'system',
      userPrompt: 'user',
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(AiError)
    expect(error).toMatchObject({ code: 'model_incompatible' })
  })

  it('fails closed for an incompatible provider instead of falling back', async () => {
    const error = await generateStructured({
      config: config({ provider: 'other' as AiConfig['provider'] }),
      schema,
      systemPrompt: 'system',
      userPrompt: 'user',
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(AiError)
    expect(error).toMatchObject({ code: 'model_incompatible' })
    expect(h.generateOpenAi).not.toHaveBeenCalled()
    expect(h.generateAnthropic).not.toHaveBeenCalled()
  })
})
