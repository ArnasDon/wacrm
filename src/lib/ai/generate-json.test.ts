import { describe, it, expect, vi } from 'vitest'

const h = vi.hoisted(() => ({
  generateOpenAi: vi.fn(),
  generateAnthropic: vi.fn(),
}))
vi.mock('./providers/openai', () => ({ generateOpenAi: h.generateOpenAi }))
vi.mock('./providers/anthropic', () => ({ generateAnthropic: h.generateAnthropic }))

import { generateJson } from './generate-json'
import type { AiConfig } from './types'

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

describe('generateJson', () => {
  it('parses clean JSON from the provider', async () => {
    h.generateOpenAi.mockResolvedValue({ text: '{"a":1}', usage: null })
    const { data } = await generateJson<{ a: number }>({
      config: config(),
      systemPrompt: 'sys',
      userPrompt: 'user',
    })
    expect(data).toEqual({ a: 1 })
    expect(h.generateOpenAi).toHaveBeenCalledWith(
      expect.objectContaining({ maxTokens: 1024, responseFormat: 'json_object' }),
    )
  })

  it('extracts JSON wrapped in prose/markdown fences', async () => {
    h.generateOpenAi.mockResolvedValue({
      text: 'Sure! Here you go:\n```json\n{"a":1}\n```\nHope that helps.',
      usage: null,
    })
    const { data } = await generateJson<{ a: number }>({
      config: config(),
      systemPrompt: 'sys',
      userPrompt: 'user',
    })
    expect(data).toEqual({ a: 1 })
  })

  it('throws AiError when nothing parseable is returned', async () => {
    h.generateOpenAi.mockResolvedValue({ text: 'no json here', usage: null })
    await expect(
      generateJson({ config: config(), systemPrompt: 'sys', userPrompt: 'user' }),
    ).rejects.toThrow('did not return valid JSON')
  })

  it('routes to the anthropic adapter for anthropic configs', async () => {
    h.generateAnthropic.mockResolvedValue({ text: '{"ok":true}', usage: null })
    const { data } = await generateJson<{ ok: boolean }>({
      config: config({ provider: 'anthropic' }),
      systemPrompt: 'sys',
      userPrompt: 'user',
    })
    expect(data).toEqual({ ok: true })
    expect(h.generateAnthropic).toHaveBeenCalled()
  })
})
