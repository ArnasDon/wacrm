import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateReply, parseGeneration } from './generate'
import { AiError, type AiConfig } from './types'
import type { AiTool } from './tools/types'

function tool(overrides: Partial<AiTool> = {}): AiTool {
  return {
    id: 't1',
    accountId: 'acct-1',
    name: 'check_stock',
    description: 'Checks stock for a SKU',
    method: 'GET',
    url: 'https://8.8.8.8/stock',
    headers: {},
    authType: 'none',
    authHeaderName: null,
    authSecret: null,
    parameters: [{ name: 'sku', in: 'query', type: 'string', required: true }],
    timeoutMs: 5000,
    ...overrides,
  }
}

function config(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: false,
    autoReplyMaxPerConversation: 3,
    handoffAgentId: null,
    embeddingsApiKey: null,
    handoffSensitivity: 'balanced',
    temperature: null,
    knowledgeTopK: 5,
    knowledgeMinRelevance: null,
    contextMessageLimit: 20,
    summarizeHistory: false,
    dormancyResetHours: null,
    ...overrides,
  }
}

function okResponse(json: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => json,
  } as unknown as Response
}

function errResponse(status: number, json: unknown): Response {
  return {
    ok: false,
    status,
    json: async () => json,
  } as unknown as Response
}

/** A tool's own outbound response, as `executeTool` consumes it
 *  (`res.text()`, not `.json()`). */
function toolFetchResponse(body: string): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => body,
  } as unknown as Response
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => vi.unstubAllGlobals())

describe('parseGeneration', () => {
  it('returns text with no handoff', () => {
    expect(parseGeneration('Hello there')).toEqual({
      text: 'Hello there',
      handoff: false,
      usage: null,
    })
  })

  it('detects + strips the handoff sentinel', () => {
    expect(parseGeneration('[[HANDOFF]]')).toEqual({
      text: '',
      handoff: true,
      usage: null,
    })
    expect(parseGeneration('Let me get a human [[HANDOFF]]')).toEqual({
      text: 'Let me get a human',
      handoff: true,
      usage: null,
    })
  })

  it('passes usage straight through', () => {
    const usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
    expect(parseGeneration('Hi', usage)).toEqual({
      text: 'Hi',
      handoff: false,
      usage,
    })
  })
})

describe('generateReply — OpenAI', () => {
  it('calls the chat completions endpoint and returns the reply', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        choices: [{ message: { content: 'Sure — happy to help!' } }],
        usage: { prompt_tokens: 42, completion_tokens: 8, total_tokens: 50 },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const res = await generateReply({
      config: config({ provider: 'openai' }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'Hi' }],
    })

    expect(res).toEqual({
      text: 'Sure — happy to help!',
      handoff: false,
      usage: { promptTokens: 42, completionTokens: 8, totalTokens: 50 },
    })
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('api.openai.com')
    expect(opts.headers.Authorization).toBe('Bearer sk-test')
  })

  it('maps a 401 to an invalid_key AiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        errResponse(401, { error: { message: 'Incorrect API key' } }),
      ),
    )

    await expect(
      generateReply({
        config: config(),
        systemPrompt: 'sys',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    ).rejects.toMatchObject({ code: 'invalid_key', status: 401 })
  })

  it('throws on an empty completion', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(okResponse({ choices: [{ message: { content: '' } }] })),
    )
    await expect(
      generateReply({
        config: config(),
        systemPrompt: 'sys',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    ).rejects.toBeInstanceOf(AiError)
  })

  it('flags a reasoning-token-exhausted empty completion (finish_reason: length)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        okResponse({ choices: [{ message: { content: '' }, finish_reason: 'length' }] }),
      ),
    )
    await expect(
      generateReply({
        config: config(),
        systemPrompt: 'sys',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    ).rejects.toMatchObject({
      code: 'empty_response',
      message: expect.stringContaining('finish_reason: length'),
    })
  })
})

describe('generateReply — DeepSeek', () => {
  it('hits DeepSeek\'s endpoint, not OpenAI\'s, with the same request shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        choices: [{ message: { content: 'Sure — happy to help!' } }],
        usage: { prompt_tokens: 42, completion_tokens: 8, total_tokens: 50 },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const res = await generateReply({
      config: config({ provider: 'deepseek', apiKey: 'sk-deepseek-test' }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'Hi' }],
    })

    expect(res).toEqual({
      text: 'Sure — happy to help!',
      handoff: false,
      usage: { promptTokens: 42, completionTokens: 8, totalTokens: 50 },
    })
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('api.deepseek.com')
    expect(url).not.toContain('api.openai.com')
    expect(opts.headers.Authorization).toBe('Bearer sk-deepseek-test')
    const body = JSON.parse(opts.body)
    expect(body.messages[0]).toEqual({ role: 'system', content: 'sys' })
  })

  it('maps a 401 to an invalid_key AiError labeled DeepSeek', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        errResponse(401, { error: { message: 'Incorrect API key' } }),
      ),
    )

    await expect(
      generateReply({
        config: config({ provider: 'deepseek' }),
        systemPrompt: 'sys',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    ).rejects.toMatchObject({
      code: 'invalid_key',
      status: 401,
      message: expect.stringContaining('DeepSeek'),
    })
  })

  it('runs the tool loop using the OpenAI tool-calling format', async () => {
    let providerCalls = 0
    const fetchMock = vi.fn(async (url: string): Promise<Response> => {
      if (String(url).includes('api.deepseek.com')) {
        providerCalls += 1
        if (providerCalls === 1) {
          return okResponse({
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: 'call_1',
                      type: 'function',
                      function: { name: 'check_stock', arguments: '{"sku":"ABC-1"}' },
                    },
                  ],
                },
              },
            ],
          })
        }
        return okResponse({ choices: [{ message: { content: 'In stock!' } }] })
      }
      // The tool's own outbound call (executeTool → the account's API) —
      // never DeepSeek's endpoint.
      return toolFetchResponse('{"in_stock":true}')
    })
    vi.stubGlobal('fetch', fetchMock)

    const res = await generateReply({
      config: config({ provider: 'deepseek' }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'Is ABC-1 in stock?' }],
      tools: [tool()],
    })

    expect(res.text).toBe('In stock!')
    expect(res.toolCalls).toHaveLength(1)
    expect(res.toolCalls?.[0].toolName).toBe('check_stock')
    expect(providerCalls).toBe(2)
  })
})

describe('generateReply — Anthropic', () => {
  it('calls the messages endpoint with the version header and parses text blocks', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        content: [{ type: 'text', text: 'Hi there!' }],
        usage: { input_tokens: 30, output_tokens: 6 },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const res = await generateReply({
      config: config({ provider: 'anthropic', apiKey: 'sk-ant-x' }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'Hello' }],
    })

    // Anthropic reports input/output only — total is summed by normalizeUsage.
    expect(res).toEqual({
      text: 'Hi there!',
      handoff: false,
      usage: { promptTokens: 30, completionTokens: 6, totalTokens: 36 },
    })
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('api.anthropic.com')
    expect(opts.headers['x-api-key']).toBe('sk-ant-x')
    expect(opts.headers['anthropic-version']).toBeTruthy()
  })

  it('detects handoff in the model output', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        okResponse({ content: [{ type: 'text', text: '[[HANDOFF]]' }] }),
      ),
    )
    const res = await generateReply({
      config: config({ provider: 'anthropic' }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'I want to speak to a person' }],
    })
    expect(res.handoff).toBe(true)
    expect(res.text).toBe('')
  })

  it('drops a leading assistant turn so the payload starts on the customer', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ content: [{ type: 'text', text: 'ok' }] }))
    vi.stubGlobal('fetch', fetchMock)

    await generateReply({
      config: config({ provider: 'anthropic' }),
      systemPrompt: 'sys',
      messages: [
        { role: 'assistant', content: 'Welcome!' },
        { role: 'user', content: 'Hi' },
      ],
    })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.messages[0].role).toBe('user')
    expect(body.messages).toHaveLength(1)
  })

  it('sends the system prompt as an ephemeral-cached block, same text as the plain string', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ content: [{ type: 'text', text: 'ok' }] }))
    vi.stubGlobal('fetch', fetchMock)

    await generateReply({
      config: config({ provider: 'anthropic' }),
      systemPrompt: 'You are a helpful assistant.',
      messages: [{ role: 'user', content: 'Hi' }],
    })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.system).toEqual([
      {
        type: 'text',
        text: 'You are a helpful assistant.',
        cache_control: { type: 'ephemeral' },
      },
    ])
  })

  it('splits knowledgeBlock into its own uncached block, keeping the stable block cacheable', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ content: [{ type: 'text', text: 'ok' }] }))
    vi.stubGlobal('fetch', fetchMock)

    await generateReply({
      config: config({ provider: 'anthropic' }),
      systemPrompt: 'You are a helpful assistant.',
      knowledgeBlock: 'Knowledge base — returns accepted within 30 days.',
      messages: [{ role: 'user', content: 'Hi' }],
    })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.system).toEqual([
      {
        type: 'text',
        text: 'You are a helpful assistant.',
        cache_control: { type: 'ephemeral' },
      },
      {
        type: 'text',
        text: 'Knowledge base — returns accepted within 30 days.',
      },
    ])
  })

  it('OpenAI folds knowledgeBlock back into one system message', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({ choices: [{ message: { content: 'ok' } }] }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await generateReply({
      config: config({ provider: 'openai' }),
      systemPrompt: 'You are a helpful assistant.',
      knowledgeBlock: 'Knowledge base — returns accepted within 30 days.',
      messages: [{ role: 'user', content: 'Hi' }],
    })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.messages[0]).toEqual({
      role: 'system',
      content: 'You are a helpful assistant.\n\nKnowledge base — returns accepted within 30 days.',
    })
  })

  it('Anthropic: historyBlock gets its own uncached block, ordered before knowledgeBlock', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ content: [{ type: 'text', text: 'ok' }] }))
    vi.stubGlobal('fetch', fetchMock)

    await generateReply({
      config: config({ provider: 'anthropic' }),
      systemPrompt: 'You are a helpful assistant.',
      historyBlock: 'Summary of earlier conversation: asked about bikes.',
      knowledgeBlock: 'Knowledge base — returns accepted within 30 days.',
      messages: [{ role: 'user', content: 'Hi' }],
    })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.system).toEqual([
      {
        type: 'text',
        text: 'You are a helpful assistant.',
        cache_control: { type: 'ephemeral' },
      },
      { type: 'text', text: 'Summary of earlier conversation: asked about bikes.' },
      { type: 'text', text: 'Knowledge base — returns accepted within 30 days.' },
    ])
  })

  it('OpenAI folds historyBlock and knowledgeBlock into one system message, in order', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({ choices: [{ message: { content: 'ok' } }] }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await generateReply({
      config: config({ provider: 'openai' }),
      systemPrompt: 'You are a helpful assistant.',
      historyBlock: 'Summary of earlier conversation: asked about bikes.',
      knowledgeBlock: 'Knowledge base — returns accepted within 30 days.',
      messages: [{ role: 'user', content: 'Hi' }],
    })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.messages[0]).toEqual({
      role: 'system',
      content:
        'You are a helpful assistant.\n\nSummary of earlier conversation: asked about bikes.\n\nKnowledge base — returns accepted within 30 days.',
    })
  })

  it('omits historyBlock entirely when not set (regression: byte-identical request)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ content: [{ type: 'text', text: 'ok' }] }))
    vi.stubGlobal('fetch', fetchMock)

    await generateReply({
      config: config({ provider: 'anthropic' }),
      systemPrompt: 'You are a helpful assistant.',
      messages: [{ role: 'user', content: 'Hi' }],
    })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.system).toEqual([
      {
        type: 'text',
        text: 'You are a helpful assistant.',
        cache_control: { type: 'ephemeral' },
      },
    ])
  })
})

describe('generateReply — temperature', () => {
  it('omits temperature when the config has none set (regression: byte-identical request)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ choices: [{ message: { content: 'Hi!' } }] }))
    vi.stubGlobal('fetch', fetchMock)

    await generateReply({
      config: config({ provider: 'openai', temperature: null }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'Hi' }],
    })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).not.toHaveProperty('temperature')
  })

  it('OpenAI: includes temperature when set', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ choices: [{ message: { content: 'Hi!' } }] }))
    vi.stubGlobal('fetch', fetchMock)

    await generateReply({
      config: config({ provider: 'openai', temperature: 0.3 }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'Hi' }],
    })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.temperature).toBe(0.3)
  })

  it('Anthropic: includes temperature when set', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ content: [{ type: 'text', text: 'ok' }] }))
    vi.stubGlobal('fetch', fetchMock)

    await generateReply({
      config: config({ provider: 'anthropic', temperature: 0.6 }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'Hi' }],
    })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.temperature).toBe(0.6)
  })
})

describe('generateReply — no tools configured (regression)', () => {
  it('OpenAI: sends no `tools` key and the result has no `toolCalls` key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({ choices: [{ message: { content: 'Hi!' } }] }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const res = await generateReply({
      config: config({ provider: 'openai' }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'Hi' }],
      tools: [],
    })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).not.toHaveProperty('tools')
    expect(res).not.toHaveProperty('toolCalls')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('Anthropic: sends no `tools` key and the result has no `toolCalls` key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({ content: [{ type: 'text', text: 'Hi!' }] }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const res = await generateReply({
      config: config({ provider: 'anthropic' }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'Hi' }],
    })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).not.toHaveProperty('tools')
    expect(res).not.toHaveProperty('toolCalls')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('generateReply — tool loop', () => {
  it('OpenAI: executes a requested tool and feeds the result back for a final reply', async () => {
    let providerCalls = 0
    const fetchMock = vi.fn(async (url: string): Promise<Response> => {
      if (String(url).includes('api.openai.com')) {
        providerCalls += 1
        if (providerCalls === 1) {
          return okResponse({
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: 'call_1',
                      type: 'function',
                      function: { name: 'check_stock', arguments: '{"sku":"ABC-1"}' },
                    },
                  ],
                },
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          })
        }
        return okResponse({
          choices: [{ message: { content: 'It is in stock!' } }],
          usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
        })
      }
      // The tool's own outbound call (executeTool → the account's API).
      return toolFetchResponse('{"in_stock":true}')
    })
    vi.stubGlobal('fetch', fetchMock)

    const res = await generateReply({
      config: config({ provider: 'openai' }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'Is ABC-1 in stock?' }],
      tools: [tool()],
    })

    expect(res.text).toBe('It is in stock!')
    expect(res.toolCalls).toHaveLength(1)
    expect(res.toolCalls?.[0]).toMatchObject({
      toolName: 'check_stock',
      args: { sku: 'ABC-1' },
    })
    expect(res.toolCalls?.[0].result.ok).toBe(true)
    // Usage summed across both provider round trips.
    expect(res.usage).toEqual({ promptTokens: 30, completionTokens: 10, totalTokens: 40 })
    expect(providerCalls).toBe(2)
  })

  it('Anthropic: executes a requested tool and feeds the result back for a final reply', async () => {
    let providerCalls = 0
    const fetchMock = vi.fn(async (url: string): Promise<Response> => {
      if (String(url).includes('api.anthropic.com')) {
        providerCalls += 1
        if (providerCalls === 1) {
          return okResponse({
            content: [
              { type: 'tool_use', id: 'tu_1', name: 'check_stock', input: { sku: 'ABC-1' } },
            ],
            usage: { input_tokens: 10, output_tokens: 5 },
          })
        }
        return okResponse({
          content: [{ type: 'text', text: 'It is in stock!' }],
          usage: { input_tokens: 20, output_tokens: 5 },
        })
      }
      return toolFetchResponse('{"in_stock":true}')
    })
    vi.stubGlobal('fetch', fetchMock)

    const res = await generateReply({
      config: config({ provider: 'anthropic' }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'Is ABC-1 in stock?' }],
      tools: [tool()],
    })

    expect(res.text).toBe('It is in stock!')
    expect(res.toolCalls).toHaveLength(1)
    expect(res.toolCalls?.[0].toolName).toBe('check_stock')
    expect(providerCalls).toBe(2)
  })

  it('gives up after MAX_TOOL_ITERATIONS rounds of tool use', async () => {
    const fetchMock = vi.fn(async (url: string): Promise<Response> => {
      if (String(url).includes('api.openai.com')) {
        return okResponse({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: 'call_x',
                    type: 'function',
                    function: { name: 'check_stock', arguments: '{"sku":"ABC-1"}' },
                  },
                ],
              },
            },
          ],
        })
      }
      return toolFetchResponse('ok')
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      generateReply({
        config: config({ provider: 'openai' }),
        systemPrompt: 'sys',
        messages: [{ role: 'user', content: 'Is ABC-1 in stock?' }],
        tools: [tool()],
      }),
    ).rejects.toMatchObject({ code: 'tool_loop_exhausted' })
  })

  it('gives up once the wall-clock budget is spent, even under MAX_TOOL_ITERATIONS', async () => {
    const fetchMock = vi.fn(async (url: string): Promise<Response> => {
      if (String(url).includes('api.openai.com')) {
        return okResponse({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: 'call_x',
                    type: 'function',
                    function: { name: 'check_stock', arguments: '{"sku":"ABC-1"}' },
                  },
                ],
              },
            },
          ],
        })
      }
      return toolFetchResponse('ok')
    })
    vi.stubGlobal('fetch', fetchMock)

    // First Date.now() call computes the deadline; every call after
    // that (inside executeTool, and the loop's own deadline check)
    // reports far past it — simulates the budget running out after
    // just one round, well before MAX_TOOL_ITERATIONS (5) is reached.
    const BASE = 1_700_000_000_000
    let calls = 0
    vi.spyOn(Date, 'now').mockImplementation(() => (calls++ === 0 ? BASE : BASE + 100_000))

    try {
      await expect(
        generateReply({
          config: config({ provider: 'openai' }),
          systemPrompt: 'sys',
          messages: [{ role: 'user', content: 'Is ABC-1 in stock?' }],
          tools: [tool()],
        }),
      ).rejects.toMatchObject({ code: 'tool_loop_timeout' })
      // Only the first round's provider call happened — it stopped
      // before starting a second, not after exhausting all 5.
      expect(fetchMock.mock.calls.filter(([u]) => String(u).includes('api.openai.com'))).toHaveLength(1)
    } finally {
      vi.restoreAllMocks()
    }
  })
})
