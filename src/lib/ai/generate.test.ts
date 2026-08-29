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

  // ============================================================
  // Usage + OpenRouter integration — OpenRouter speaks the exact same
  // OpenAI-compatible wire format (generateChatCompletion, shared with
  // OpenAI), so its usage extraction was never a separate code path to
  // begin with. These tests prove that fact rather than assume it, per
  // the phase's explicit "no asumas, verifica" instruction, and cover
  // the mandatory matrix items that are specific to the wire response
  // (1-3, 6-8).
  // ============================================================
  it('1-3. registers input/output/total tokens exactly as OpenAI does — same shared parsing, no special-casing', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        choices: [{ message: { content: 'Cuesta RD$500.' } }],
        usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const res = await generateReply({
      config: config({ provider: 'openrouter', model: 'meta-llama/llama-3.3-70b' }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'Hi' }],
    })

    expect(res.usage).toEqual({ promptTokens: 120, completionTokens: 30, totalTokens: 150 })
  })

  it('6. no usage in the response never fabricates numbers — usage is null, not zeros', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ choices: [{ message: { content: 'Hola!' } }] }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await generateReply({
      config: config({ provider: 'openrouter' }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'Hi' }],
    })

    expect(res.usage).toBeNull()
  })

  it('7-8. tool-calling aggregates usage across turns exactly once per turn — never duplicated', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        okResponse({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'search_catalog', arguments: '{"query":"S25"}' } }],
              },
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
        }),
      )
      .mockResolvedValueOnce(
        okResponse({
          choices: [{ message: { content: 'Cuesta RD$34,900.' } }],
          usage: { prompt_tokens: 150, completion_tokens: 12, total_tokens: 162 },
        }),
      )
    vi.stubGlobal('fetch', fetchMock)
    const executeTool = vi.fn().mockResolvedValue({ products: [{ id: 'p1', price: 34900 }] })

    const res = await generateReply({
      config: config({ provider: 'openrouter' }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: '¿Cuánto cuesta el S25?' }],
      tools: TOOL_SPECS,
      executeTool,
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    // Sum of both real turns, not the last turn alone, and not doubled.
    expect(res.usage).toEqual({ promptTokens: 250, completionTokens: 22, totalTokens: 272 })
    expect(res.toolCalls).toHaveLength(1)
  })

  it('4-5. provider stays "openrouter" and model is the real configured one — never coerced to openai/unknown', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ choices: [{ message: { content: 'Hi!' } }] }))
    vi.stubGlobal('fetch', fetchMock)
    const cfg = config({ provider: 'openrouter', model: 'anthropic/claude-sonnet-4.5' })

    await generateReply({ config: cfg, systemPrompt: 'sys', messages: [{ role: 'user', content: 'Hi' }] })

    // generateReply itself never touches config.provider/config.model —
    // the caller (auto-reply.ts/draft/route.ts) passes them straight
    // through to logAiUsage unchanged; asserted directly against
    // ai_usage_log's insert in usage.test.ts. Here we confirm the
    // dispatch itself never substitutes a different provider adapter's
    // identity into the wire call.
    expect(cfg.provider).toBe('openrouter')
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.model).toBe('anthropic/claude-sonnet-4.5')
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

// ============================================================
// Anthropic prompt caching — AI optimization project, FASE 8. Covers
// the mandatory test matrix: the Anthropic payload carries the caching
// metadata correctly (1), OpenAI/OpenRouter payloads stay exactly what
// they were (2, 3), and caching never interferes with the tool-calling
// loop (5) or with what a customer/agent actually sees (4, text content
// unchanged — proven exhaustively in defaults.test.ts's content-parity
// suite; here we only prove the WIRE payload, per the task's own "usa
// mocks/spies, no inventes una prueba contra una API externa real").
// ============================================================
describe('generateReply — Anthropic prompt caching (FASE 8)', () => {
  const BLOCKS = { stable: 'STABLE RULES TEXT', dynamic: 'DYNAMIC DATA TEXT' }

  it('1. marks the stable block as an ephemeral cache breakpoint and keeps the dynamic block uncached', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ content: [{ type: 'text', text: 'ok' }] }))
    vi.stubGlobal('fetch', fetchMock)

    await generateReply({
      config: config({ provider: 'anthropic' }),
      systemPrompt: `${BLOCKS.stable}\n\n${BLOCKS.dynamic}`,
      systemPromptBlocks: BLOCKS,
      messages: [{ role: 'user', content: 'Hi' }],
    })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(Array.isArray(body.system)).toBe(true)
    expect(body.system[0]).toEqual({ type: 'text', text: 'STABLE RULES TEXT', cache_control: { type: 'ephemeral' } })
    expect(body.system[1]).toEqual({ type: 'text', text: '\n\nDYNAMIC DATA TEXT' })
    expect(body.system[1].cache_control).toBeUndefined()
  })

  it('the full text Anthropic receives is unchanged from the plain-string equivalent — only split differently', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ content: [{ type: 'text', text: 'ok' }] }))
    vi.stubGlobal('fetch', fetchMock)
    const fullPrompt = `${BLOCKS.stable}\n\n${BLOCKS.dynamic}`

    await generateReply({
      config: config({ provider: 'anthropic' }),
      systemPrompt: fullPrompt,
      systemPromptBlocks: BLOCKS,
      messages: [{ role: 'user', content: 'Hi' }],
    })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    const concatenated = body.system.map((b: { text: string }) => b.text).join('')
    expect(concatenated).toBe(fullPrompt)
  })

  it('omits the dynamic block entirely when there is nothing dynamic to send — no dangling empty block', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ content: [{ type: 'text', text: 'ok' }] }))
    vi.stubGlobal('fetch', fetchMock)

    await generateReply({
      config: config({ provider: 'anthropic' }),
      systemPrompt: 'STABLE ONLY',
      systemPromptBlocks: { stable: 'STABLE ONLY', dynamic: '' },
      messages: [{ role: 'user', content: 'Hi' }],
    })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.system).toEqual([{ type: 'text', text: 'STABLE ONLY', cache_control: { type: 'ephemeral' } }])
  })

  it('falls back to the plain string (no array, no cache_control) when systemPromptBlocks is omitted — unchanged default behavior', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ content: [{ type: 'text', text: 'ok' }] }))
    vi.stubGlobal('fetch', fetchMock)

    await generateReply({
      config: config({ provider: 'anthropic' }),
      systemPrompt: 'plain sys',
      messages: [{ role: 'user', content: 'Hi' }],
    })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.system).toBe('plain sys')
  })

  it('2. OpenAI payload is byte-for-byte what it always was — plain system string, no cache_control field anywhere, even when systemPromptBlocks is supplied', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ choices: [{ message: { content: 'Hi!' } }] }))
    vi.stubGlobal('fetch', fetchMock)

    await generateReply({
      config: config({ provider: 'openai' }),
      systemPrompt: 'plain sys',
      systemPromptBlocks: BLOCKS, // present, but OpenAI must never read it
      messages: [{ role: 'user', content: 'Hi' }],
    })

    const rawBody = fetchMock.mock.calls[0][1].body as string
    const body = JSON.parse(rawBody)
    expect(body.messages[0]).toEqual({ role: 'system', content: 'plain sys' })
    expect(rawBody).not.toContain('cache_control')
    expect(rawBody).not.toContain('ephemeral')
  })

  it('3. OpenRouter payload never receives Anthropic-specific caching metadata either', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ choices: [{ message: { content: 'Hola!' } }] }))
    vi.stubGlobal('fetch', fetchMock)

    await generateReply({
      config: config({ provider: 'openrouter', model: 'anthropic/claude-sonnet-4.5' }),
      systemPrompt: 'plain sys',
      systemPromptBlocks: BLOCKS, // present, but OpenRouter must never read it
      messages: [{ role: 'user', content: 'Hola' }],
    })

    const rawBody = fetchMock.mock.calls[0][1].body as string
    const body = JSON.parse(rawBody)
    expect(body.messages[0]).toEqual({ role: 'system', content: 'plain sys' })
    expect(rawBody).not.toContain('cache_control')
    expect(rawBody).not.toContain('ephemeral')
  })

  it('5a. the SAME cached system content is sent on every turn of a tool-calling exchange; tool results/text unaffected', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        okResponse({
          content: [{ type: 'tool_use', id: 'toolu_1', name: 'search_catalog', input: { query: 'S25' } }],
          usage: { input_tokens: 20, output_tokens: 5 },
        }),
      )
      .mockResolvedValueOnce(
        okResponse({ content: [{ type: 'text', text: 'Cuesta RD$34,900.' }], usage: { input_tokens: 40, output_tokens: 10 } }),
      )
    vi.stubGlobal('fetch', fetchMock)
    const executeTool = vi.fn().mockResolvedValue({ products: [{ id: 'p1', price: 34900 }] })

    const res = await generateReply({
      config: config({ provider: 'anthropic' }),
      systemPrompt: `${BLOCKS.stable}\n\n${BLOCKS.dynamic}`,
      systemPromptBlocks: BLOCKS,
      messages: [{ role: 'user', content: '¿Cuánto cuesta el S25?' }],
      tools: TOOL_SPECS,
      executeTool,
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    // Tool results/text still come through unaffected by caching.
    expect(res.text).toBe('Cuesta RD$34,900.')
    expect(res.toolCalls).toHaveLength(1)

    // The `system` block is IDENTICAL on both requests — this identity
    // is exactly what lets Anthropic serve the 2nd turn's stable prefix
    // from cache instead of reprocessing it.
    const firstSystem = JSON.parse(fetchMock.mock.calls[0][1].body).system
    const secondSystem = JSON.parse(fetchMock.mock.calls[1][1].body).system
    expect(secondSystem).toEqual(firstSystem)
  })

  it('5b. MAX_TOOL_TURNS still bounds the loop exactly the same with caching enabled', async () => {
    const toolCallResponse = okResponse({
      content: [{ type: 'tool_use', id: 'toolu_x', name: 'search_catalog', input: {} }],
    })
    const fetchMock = vi.fn().mockResolvedValue(toolCallResponse)
    vi.stubGlobal('fetch', fetchMock)

    const res = await generateReply({
      config: config({ provider: 'anthropic' }),
      systemPrompt: `${BLOCKS.stable}\n\n${BLOCKS.dynamic}`,
      systemPromptBlocks: BLOCKS,
      messages: [{ role: 'user', content: 'x' }],
      tools: TOOL_SPECS,
      executeTool: vi.fn().mockResolvedValue({ products: [] }),
      maxToolTurns: 2,
    })

    // Bounded exactly as without caching (see the OpenAI-wire equivalent
    // test above): maxToolTurns+1 requests, then a safe fallback reply.
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(3)
    expect(res.text).toBeTruthy()
  })

  // ============================================================
  // Usage + OpenRouter integration phase — Anthropic's cache usage
  // fields must be captured distinctly from input_tokens, never
  // fabricated, and must never break the caching mechanism itself
  // (test #11 of the mandatory matrix).
  // ============================================================
  it('11a. captures cache_creation_input_tokens/cache_read_input_tokens distinctly from input_tokens', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 50, output_tokens: 20, cache_creation_input_tokens: 800, cache_read_input_tokens: 0 },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const res = await generateReply({
      config: config({ provider: 'anthropic' }),
      systemPrompt: `${BLOCKS.stable}\n\n${BLOCKS.dynamic}`,
      systemPromptBlocks: BLOCKS,
      messages: [{ role: 'user', content: 'Hi' }],
    })

    // promptTokens reflects ONLY input_tokens — never inflated by adding
    // the cache fields on top of it.
    expect(res.usage).toEqual({
      promptTokens: 50,
      completionTokens: 20,
      totalTokens: 70,
      cacheCreationInputTokens: 800,
      cacheReadInputTokens: 0,
    })
  })

  it('11b. omits cache fields entirely (never a fabricated 0) when Anthropic does not report them — e.g. no systemPromptBlocks, caching not engaged', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({ content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 50, output_tokens: 20 } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const res = await generateReply({
      config: config({ provider: 'anthropic' }),
      systemPrompt: 'plain sys',
      messages: [{ role: 'user', content: 'Hi' }],
    })

    expect(res.usage).toEqual({ promptTokens: 50, completionTokens: 20, totalTokens: 70 })
    expect(res.usage).not.toHaveProperty('cacheCreationInputTokens')
    expect(res.usage).not.toHaveProperty('cacheReadInputTokens')
  })

  it('11c. sums cache tokens across tool-calling turns without breaking the cache-control wire mechanism', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        okResponse({
          content: [{ type: 'tool_use', id: 'toolu_1', name: 'search_catalog', input: { query: 'S25' } }],
          usage: { input_tokens: 100, output_tokens: 5, cache_creation_input_tokens: 900 },
        }),
      )
      .mockResolvedValueOnce(
        okResponse({
          content: [{ type: 'text', text: 'Cuesta RD$34,900.' }],
          usage: { input_tokens: 20, output_tokens: 10, cache_read_input_tokens: 900 },
        }),
      )
    vi.stubGlobal('fetch', fetchMock)
    const executeTool = vi.fn().mockResolvedValue({ products: [{ id: 'p1', price: 34900 }] })

    const res = await generateReply({
      config: config({ provider: 'anthropic' }),
      systemPrompt: `${BLOCKS.stable}\n\n${BLOCKS.dynamic}`,
      systemPromptBlocks: BLOCKS,
      messages: [{ role: 'user', content: '¿Cuánto cuesta el S25?' }],
      tools: TOOL_SPECS,
      executeTool,
    })

    expect(res.usage).toEqual({
      promptTokens: 120,
      completionTokens: 15,
      totalTokens: 135,
      cacheCreationInputTokens: 900, // only turn 1 wrote the cache
      cacheReadInputTokens: 900, // only turn 2 read it back
    })
    // The cache breakpoint itself is unaffected — same `system` on both.
    const firstSystem = JSON.parse(fetchMock.mock.calls[0][1].body).system
    const secondSystem = JSON.parse(fetchMock.mock.calls[1][1].body).system
    expect(secondSystem).toEqual(firstSystem)
  })
})
