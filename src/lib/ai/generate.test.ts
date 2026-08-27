import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateReply, parseGeneration } from './generate'
import { AiError, type AiConfig } from './types'

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
      toolCalls: [],
    })
  })

  it('detects + strips the handoff sentinel', () => {
    expect(parseGeneration('[[HANDOFF]]')).toEqual({
      text: '',
      handoff: true,
      usage: null,
      toolCalls: [],
    })
    expect(parseGeneration('Let me get a human [[HANDOFF]]')).toEqual({
      text: 'Let me get a human',
      handoff: true,
      usage: null,
      toolCalls: [],
    })
  })

  it('passes usage straight through', () => {
    const usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
    expect(parseGeneration('Hi', usage)).toEqual({
      text: 'Hi',
      handoff: false,
      usage,
      toolCalls: [],
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
      toolCalls: [],
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
})

describe('generateReply — OpenRouter', () => {
  it('posts the OpenAI wire format to the gateway with the account key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        choices: [{ message: { content: 'Hola!' } }],
        usage: { prompt_tokens: 11, completion_tokens: 3, total_tokens: 14 },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const res = await generateReply({
      config: config({
        provider: 'openrouter',
        model: 'anthropic/claude-sonnet-4.5',
        apiKey: 'sk-or-v1-x',
      }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'Hola' }],
    })

    expect(res.text).toBe('Hola!')
    expect(res.usage).toEqual({
      promptTokens: 11,
      completionTokens: 3,
      totalTokens: 14,
    })

    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('openrouter.ai/api/v1/chat/completions')
    expect(opts.headers.Authorization).toBe('Bearer sk-or-v1-x')
    const body = JSON.parse(opts.body)
    expect(body.model).toBe('anthropic/claude-sonnet-4.5')
    expect(body.messages[0]).toEqual({ role: 'system', content: 'sys' })
  })

  it('surfaces an upstream error returned inside a 200 body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        okResponse({ error: { message: 'No endpoints found', code: 404 } }),
      ),
    )

    await expect(
      generateReply({
        config: config({ provider: 'openrouter', model: 'vendor/nope' }),
        systemPrompt: 'sys',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    ).rejects.toMatchObject({
      code: 'provider_error',
      message: expect.stringContaining('No endpoints found'),
    })
  })

  it('maps a 401 from the gateway to invalid_key', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(errResponse(401, { error: { message: 'No auth' } })),
    )

    await expect(
      generateReply({
        config: config({ provider: 'openrouter' }),
        systemPrompt: 'sys',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    ).rejects.toMatchObject({ code: 'invalid_key', status: 401 })
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
      toolCalls: [],
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
})

// ============================================================
// Tool-calling loop — the mechanism that makes "the model can't get a
// real price without a genuine tool round trip" a code-level guarantee,
// not just a prompt instruction (docs/integrations/ai-data-integration/
// 01_MASTER_EXECUTION.md "REGLA CRÍTICA DE PRECIOS"). Exercised through
// the public generateReply() API — same convention as the rest of this
// file — with `fetch` mocked to return a tool_calls response on the
// first call and a final text response on the second.
// ============================================================

const TOOL_SPECS = [
  { name: 'search_catalog', description: 'search', inputSchema: { type: 'object', properties: {} } },
]

describe('generateReply — tool calling (OpenAI wire)', () => {
  it('executes a requested tool call and feeds the result back for a final answer', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        okResponse({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  { id: 'call_1', type: 'function', function: { name: 'search_catalog', arguments: '{"query":"S25"}' } },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
        }),
      )
      .mockResolvedValueOnce(
        okResponse({
          choices: [{ message: { content: 'Cuesta RD$34,900.' } }],
          usage: { prompt_tokens: 40, completion_tokens: 10, total_tokens: 50 },
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const executeTool = vi.fn().mockResolvedValue({ products: [{ id: 'p1', price: 34900 }] })

    const res = await generateReply({
      config: config({ provider: 'openai' }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: '¿Cuánto cuesta el S25?' }],
      tools: TOOL_SPECS,
      executeTool,
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(executeTool).toHaveBeenCalledWith({ id: 'call_1', name: 'search_catalog', input: { query: 'S25' } })
    expect(res.text).toBe('Cuesta RD$34,900.')
    expect(res.toolCalls).toEqual([
      { name: 'search_catalog', input: { query: 'S25' }, result: { products: [{ id: 'p1', price: 34900 }] } },
    ])
    // Usage is aggregated across BOTH round trips, not just the last one.
    expect(res.usage).toEqual({ promptTokens: 60, completionTokens: 15, totalTokens: 75 })

    // Second request must include the tool result in the conversation.
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body)
    const toolMessage = secondBody.messages.find((m: { role: string }) => m.role === 'tool')
    expect(toolMessage.content).toContain('34900')
  })

  it('never declares tools on the wire when none are attached (accounts with no catalog source)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ choices: [{ message: { content: 'Hi!' } }] }))
    vi.stubGlobal('fetch', fetchMock)
    await generateReply({ config: config({ provider: 'openai' }), systemPrompt: 'sys', messages: [{ role: 'user', content: 'hi' }] })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.tools).toBeUndefined()
  })

  it('stops after MAX_TOOL_TURNS instead of looping forever on a model that never answers', async () => {
    const toolCallResponse = okResponse({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [{ id: 'call_x', type: 'function', function: { name: 'search_catalog', arguments: '{}' } }],
          },
        },
      ],
    })
    const fetchMock = vi.fn().mockResolvedValue(toolCallResponse)
    vi.stubGlobal('fetch', fetchMock)
    const executeTool = vi.fn().mockResolvedValue({ products: [] })

    const res = await generateReply({
      config: config({ provider: 'openai' }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'x' }],
      tools: TOOL_SPECS,
      executeTool,
      maxToolTurns: 2,
    })

    // Bounded: exactly maxToolTurns+1 requests, then a safe fallback
    // reply rather than throwing or hanging.
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(3)
    expect(res.text).toBeTruthy()
  })
})

describe('generateReply — tool calling (Anthropic wire)', () => {
  it('executes a requested tool call via tool_use/tool_result blocks', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        okResponse({
          content: [{ type: 'tool_use', id: 'toolu_1', name: 'search_catalog', input: { query: 'S25' } }],
          usage: { input_tokens: 20, output_tokens: 5 },
        }),
      )
      .mockResolvedValueOnce(
        okResponse({
          content: [{ type: 'text', text: 'Cuesta RD$34,900.' }],
          usage: { input_tokens: 40, output_tokens: 10 },
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const executeTool = vi.fn().mockResolvedValue({ products: [{ id: 'p1', price: 34900 }] })

    const res = await generateReply({
      config: config({ provider: 'anthropic' }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: '¿Cuánto cuesta el S25?' }],
      tools: TOOL_SPECS,
      executeTool,
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(executeTool).toHaveBeenCalledWith({ id: 'toolu_1', name: 'search_catalog', input: { query: 'S25' } })
    expect(res.text).toBe('Cuesta RD$34,900.')
    expect(res.usage).toEqual({ promptTokens: 60, completionTokens: 15, totalTokens: 75 })

    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body)
    const toolResultMessage = secondBody.messages.find(
      (m: { role: string; content: unknown }) => m.role === 'user' && Array.isArray(m.content),
    )
    expect(toolResultMessage.content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu_1' })
    expect(toolResultMessage.content[0].content).toContain('34900')
  })

  it('never declares tools on the wire when none are attached', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ content: [{ type: 'text', text: 'Hi!' }] }))
    vi.stubGlobal('fetch', fetchMock)
    await generateReply({ config: config({ provider: 'anthropic' }), systemPrompt: 'sys', messages: [{ role: 'user', content: 'hi' }] })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.tools).toBeUndefined()
  })
})
