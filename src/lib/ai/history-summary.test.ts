import { describe, it, expect, vi, afterEach } from 'vitest'
import { summarizeOlderMessages } from './history-summary'
import type { AiConfig } from './types'

function config(overrides: Partial<Pick<AiConfig, 'provider' | 'model' | 'apiKey'>> = {}) {
  return {
    provider: 'openai' as const,
    model: 'gpt-test',
    apiKey: 'sk-test',
    ...overrides,
  }
}

function okResponse(json: unknown): Response {
  return { ok: true, status: 200, json: async () => json } as unknown as Response
}

afterEach(() => vi.unstubAllGlobals())

describe('summarizeOlderMessages', () => {
  it('returns null without calling the provider when there are no new messages', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const result = await summarizeOlderMessages({
      config: config(),
      priorSummary: null,
      newMessages: [],
    })
    expect(result).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('calls OpenAI with the summary max-tokens cap and returns the summary', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        choices: [{ message: { content: 'Customer asked about bikes and helmets.' } }],
        usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await summarizeOlderMessages({
      config: config({ provider: 'openai' }),
      priorSummary: null,
      newMessages: [{ role: 'user', content: 'do you sell helmets' }],
    })

    expect(result).toEqual({
      summary: 'Customer asked about bikes and helmets.',
      usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60 },
    })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.max_completion_tokens).toBe(4096)
    expect(body.messages[0].role).toBe('system')
    expect(body.messages[0].content).toContain('Condense this excerpt')
  })

  it('does not send reasoning_effort for a plain (non-reasoning) model', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({ choices: [{ message: { content: 'Summary.' } }] }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await summarizeOlderMessages({
      config: config({ provider: 'openai', model: 'gpt-4o-mini' }),
      priorSummary: null,
      newMessages: [{ role: 'user', content: 'hi' }],
    })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).not.toHaveProperty('reasoning_effort')
  })

  it('sends reasoning_effort: low for a reasoning-capable model, to spend fewer reasoning tokens', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({ choices: [{ message: { content: 'Summary.' } }] }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await summarizeOlderMessages({
      config: config({ provider: 'openai', model: 'gpt-5.4-mini' }),
      priorSummary: null,
      newMessages: [{ role: 'user', content: 'hi' }],
    })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.reasoning_effort).toBe('low')
  })

  it('recognizes DeepSeek\'s reasoner variant as reasoning-capable too', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({ choices: [{ message: { content: 'Summary.' } }] }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await summarizeOlderMessages({
      config: config({ provider: 'deepseek', model: 'deepseek-reasoner' }),
      priorSummary: null,
      newMessages: [{ role: 'user', content: 'hi' }],
    })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.reasoning_effort).toBe('low')
  })

  it('folds the prior summary into the prompt when there is one', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({ choices: [{ message: { content: 'Updated summary.' } }] }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await summarizeOlderMessages({
      config: config(),
      priorSummary: 'Customer asked about bikes.',
      newMessages: [{ role: 'user', content: 'and helmets too' }],
    })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.messages[0].content).toContain('Customer asked about bikes.')
  })

  it('works with Anthropic too, using the same max-tokens cap', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({ content: [{ type: 'text', text: 'Condensed summary.' }] }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await summarizeOlderMessages({
      config: config({ provider: 'anthropic' }),
      priorSummary: null,
      newMessages: [{ role: 'user', content: 'hello' }],
    })

    expect(result?.summary).toBe('Condensed summary.')
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.max_tokens).toBe(4096)
  })

  it('routes DeepSeek through the OpenAI-compatible adapter at DeepSeek\'s URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({ choices: [{ message: { content: 'DeepSeek summary.' } }] }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await summarizeOlderMessages({
      config: config({ provider: 'deepseek' }),
      priorSummary: null,
      newMessages: [{ role: 'user', content: 'hello' }],
    })

    expect(result?.summary).toBe('DeepSeek summary.')
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('api.deepseek.com')
    expect(JSON.parse(opts.body).max_completion_tokens).toBe(4096)
  })

  it('never throws — returns null on a provider error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const result = await summarizeOlderMessages({
      config: config(),
      priorSummary: 'old summary',
      newMessages: [{ role: 'user', content: 'hi' }],
    })
    expect(result).toBeNull()
  })

  it('never throws — returns null on an empty completion', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(okResponse({ choices: [{ message: { content: '' } }] })),
    )
    const result = await summarizeOlderMessages({
      config: config(),
      priorSummary: null,
      newMessages: [{ role: 'user', content: 'hi' }],
    })
    expect(result).toBeNull()
  })
})
