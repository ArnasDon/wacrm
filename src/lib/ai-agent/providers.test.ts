import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createOpenAiResponsesProvider,
  extractOpenAiOutputText,
  resolveAiAgentDecisionProvider,
} from './providers'
import type { AiAgent } from '@/types'

const agent: AiAgent = {
  id: 'agent-1',
  account_id: 'acct-1',
  user_id: 'user-1',
  name: 'AI',
  enabled: true,
  model_provider: 'openai',
  model_name: 'gpt-5-mini',
  instructions: 'Help.',
  auto_reply: true,
  auto_move_deals: true,
  handoff_keywords: [],
  max_messages: 12,
  cooldown_seconds: 30,
  created_at: '',
  updated_at: '',
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('resolveAiAgentDecisionProvider', () => {
  it('returns an OpenAI provider only when the OpenAI key and provider are configured', () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    expect(resolveAiAgentDecisionProvider(agent)).toBeNull()

    vi.stubEnv('OPENAI_API_KEY', 'sk-test-provider-key-123456')
    expect(resolveAiAgentDecisionProvider(agent)).not.toBeNull()
    expect(resolveAiAgentDecisionProvider({ ...agent, model_provider: 'other' })).toBeNull()
  })
})

describe('createOpenAiResponsesProvider', () => {
  it('calls the Responses API with model, input, and max_output_tokens', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ output_text: '{"action":"no_reply","reason":"ok","confidence":1}' }),
    } as Response)
    const provider = createOpenAiResponsesProvider({ apiKey: 'sk-test', fetchImpl })

    await expect(provider.complete({
      model: 'gpt-5-mini',
      system: 'system prompt',
      user: 'user prompt',
      maxOutputTokens: 512,
    })).resolves.toBe('{"action":"no_reply","reason":"ok","confidence":1}')

    expect(fetchImpl).toHaveBeenCalledWith('https://api.openai.com/v1/responses', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        Authorization: 'Bearer sk-test',
        'Content-Type': 'application/json',
      }),
    }))
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual(expect.objectContaining({
      model: 'gpt-5-mini',
      input: [
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: 'user prompt' },
      ],
      text: {
        format: expect.objectContaining({
          type: 'json_schema',
          name: 'ai_agent_decision',
        }),
      },
      max_output_tokens: 512,
    }))
  })

  it('throws a sanitized provider error for HTTP failures', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'secret' }) } as Response)
    const provider = createOpenAiResponsesProvider({ apiKey: 'sk-test', fetchImpl })

    await expect(provider.complete({ model: 'gpt-5-mini', system: 'x', user: 'y' }))
      .rejects.toThrow('AI provider request failed')
  })

  it('aborts stalled provider requests after the configured timeout', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    }))
    const provider = createOpenAiResponsesProvider({ apiKey: 'sk-test', fetchImpl, timeoutMs: 25 })
    const request = provider.complete({ model: 'gpt-5-mini', system: 'x', user: 'y' })
    const expectation = expect(request).rejects.toThrow('AI provider request failed')

    await vi.advanceTimersByTimeAsync(25)

    await expectation
    expect(fetchImpl).toHaveBeenCalledWith('https://api.openai.com/v1/responses', expect.objectContaining({
      signal: expect.any(AbortSignal),
    }))
  })
})

describe('extractOpenAiOutputText', () => {
  it('extracts output_text or concatenated output content text', () => {
    expect(extractOpenAiOutputText({ output_text: 'direct' })).toBe('direct')
    expect(extractOpenAiOutputText({
      output: [
        { content: [{ text: 'part 1' }, { text: ' part 2' }] },
      ],
    })).toBe('part 1 part 2')
  })
})
