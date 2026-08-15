import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateReply, generateReplyWithTools, parseGeneration } from './generate'
import { AiError, type AiConfig } from './types'
import type { ToolDef } from './tag-tool'

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
})

const ADD_TAG_TOOL: ToolDef = {
  name: 'add_tag',
  description: 'desc',
  tagIds: ['t1'],
}

describe('generateReplyWithTools — no tool offered', () => {
  it('behaves exactly like generateReply when tool is null', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ choices: [{ message: { content: 'Hi!' } }] }))
    vi.stubGlobal('fetch', fetchMock)
    const onToolCalls = vi.fn()

    const res = await generateReplyWithTools({
      config: config({ provider: 'openai' }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'Hi' }],
      tool: null,
      onToolCalls,
    })

    expect(res).toEqual({ text: 'Hi!', handoff: false, usage: null })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(onToolCalls).not.toHaveBeenCalled()
  })
})

describe('generateReplyWithTools — OpenAI', () => {
  it('parses generation normally when the model does not call the tool', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ choices: [{ message: { content: 'No tag needed here.' } }] }))
    vi.stubGlobal('fetch', fetchMock)
    const onToolCalls = vi.fn()

    const res = await generateReplyWithTools({
      config: config({ provider: 'openai' }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'Just chatting' }],
      tool: ADD_TAG_TOOL,
      onToolCalls,
    })

    expect(res).toEqual({ text: 'No tag needed here.', handoff: false, usage: null })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(onToolCalls).not.toHaveBeenCalled()
  })

  it('applies a tool call via onToolCalls and makes exactly one bounded follow-up for the final text', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        okResponse({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: {
                      name: 'add_tag',
                      arguments: JSON.stringify({ tag_id: 't1', reason: 'asked for a consultant' }),
                    },
                  },
                ],
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        okResponse({ choices: [{ message: { content: 'Sure, connecting you now!' } }] }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const onToolCalls = vi
      .fn()
      .mockResolvedValue([{ tagId: 't1', applied: true, tagName: 'quer-consultor' }])

    const res = await generateReplyWithTools({
      config: config({ provider: 'openai' }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'I want to talk to a consultant' }],
      tool: ADD_TAG_TOOL,
      onToolCalls,
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(onToolCalls).toHaveBeenCalledWith([{ id: 'call_1', tagId: 't1', reason: 'asked for a consultant' }])
    expect(res.text).toBe('Sure, connecting you now!')
    expect(res.toolCalls).toEqual([{ tagId: 't1', reason: 'asked for a consultant' }])

    // Every tool_call_id from the first turn must get a matching `tool`
    // message in the follow-up, or OpenAI 400s.
    const followUpBody = JSON.parse(fetchMock.mock.calls[1][1].body)
    const toolMsg = followUpBody.messages.find((m: { role: string }) => m.role === 'tool')
    expect(toolMsg).toEqual({
      role: 'tool',
      tool_call_id: 'call_1',
      content: 'Tag applied: quer-consultor.',
    })
  })

  it('ignores a malformed tool call rather than failing the whole reply', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        okResponse({
          choices: [
            {
              message: {
                content: 'Here you go.',
                tool_calls: [
                  { id: 'call_1', type: 'function', function: { name: 'add_tag', arguments: 'not json' } },
                ],
              },
            },
          ],
        }),
      )
    vi.stubGlobal('fetch', fetchMock)
    const onToolCalls = vi.fn()

    const res = await generateReplyWithTools({
      config: config({ provider: 'openai' }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'Hi' }],
      tool: ADD_TAG_TOOL,
      onToolCalls,
    })

    expect(res.text).toBe('Here you go.')
    expect(onToolCalls).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('generateReplyWithTools — Anthropic', () => {
  it('applies a tool call via onToolCalls and makes exactly one bounded follow-up for the final text', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        okResponse({
          content: [
            { type: 'tool_use', id: 'toolu_1', name: 'add_tag', input: { tag_id: 't1', reason: 'wants a consultant' } },
          ],
        }),
      )
      .mockResolvedValueOnce(okResponse({ content: [{ type: 'text', text: "I've flagged this for a consultant." }] }))
    vi.stubGlobal('fetch', fetchMock)

    const onToolCalls = vi
      .fn()
      .mockResolvedValue([{ tagId: 't1', applied: true, tagName: 'quer-consultor' }])

    const res = await generateReplyWithTools({
      config: config({ provider: 'anthropic', apiKey: 'sk-ant-x' }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'I want a consultant' }],
      tool: ADD_TAG_TOOL,
      onToolCalls,
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(onToolCalls).toHaveBeenCalledWith([{ id: 'toolu_1', tagId: 't1', reason: 'wants a consultant' }])
    expect(res.text).toBe("I've flagged this for a consultant.")
    expect(res.toolCalls).toEqual([{ tagId: 't1', reason: 'wants a consultant' }])

    const followUpBody = JSON.parse(fetchMock.mock.calls[1][1].body)
    const userTurn = followUpBody.messages.at(-1)
    expect(userTurn).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'Tag applied: quer-consultor.' }],
    })
  })

  it('parses generation normally when the model does not call the tool', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ content: [{ type: 'text', text: 'Just chatting back.' }] }))
    vi.stubGlobal('fetch', fetchMock)
    const onToolCalls = vi.fn()

    const res = await generateReplyWithTools({
      config: config({ provider: 'anthropic' }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'Hi' }],
      tool: ADD_TAG_TOOL,
      onToolCalls,
    })

    expect(res).toEqual({ text: 'Just chatting back.', handoff: false, usage: null })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(onToolCalls).not.toHaveBeenCalled()
  })
})
