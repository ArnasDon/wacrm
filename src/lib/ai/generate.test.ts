import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DEFAULT_COMMERCIAL_STRATEGY } from './commercial-strategy'
import { generateReply, parseGeneration } from './generate'
import { AiError, type AiConfig } from './types'

function config(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    systemPrompt: null,
    commercialStrategy: DEFAULT_COMMERCIAL_STRATEGY,
    isActive: true,
    autoReplyEnabled: false,
    autoReplyMaxPerConversation: 3,
    bufferWindowSeconds: 12,
    maxReplyChunks: 3,
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

describe('generateReply', () => {
  it('throws a typed error for a non-OK OpenAI response', async () => {
    vi.mocked(fetch).mockResolvedValue(errResponse(401, { error: { message: 'bad key' } }))
    await expect(
      generateReply({
        config: config(),
        systemPrompt: 'system',
        messages: [{ role: 'user', content: 'hello' }],
        tools: [],
        executeTool: async () => JSON.stringify({ ok: true }),
      }),
    ).rejects.toBeInstanceOf(AiError)
  })

  it('returns provider text for a normal OpenAI response', async () => {
    vi.mocked(fetch).mockResolvedValue(
      okResponse({
        choices: [{ message: { content: 'Hello!' } }],
        usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
      }),
    )

    await expect(
      generateReply({
        config: config(),
        systemPrompt: 'system',
        messages: [{ role: 'user', content: 'hello' }],
        tools: [],
        executeTool: async () => JSON.stringify({ ok: true }),
      }),
    ).resolves.toMatchObject({ text: 'Hello!', handoff: false })
  })

  it('maps provider-neutral image parts to OpenAI Chat Completions', async () => {
    vi.mocked(fetch).mockResolvedValue(
      okResponse({
        choices: [{ message: { content: 'The product is damaged.' } }],
      }),
    )

    await generateReply({
      config: config(),
      systemPrompt: 'system',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              url: 'data:image/jpeg;base64,cGl4ZWxz',
              mediaType: 'image/jpeg',
            },
            { type: 'text', text: 'What happened?' },
          ],
        },
      ],
    })

    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))
    expect(body.messages[1]).toEqual({
      role: 'user',
      content: [
        {
          type: 'image_url',
          image_url: {
            url: 'data:image/jpeg;base64,cGl4ZWxz',
            detail: 'auto',
          },
        },
        { type: 'text', text: 'What happened?' },
      ],
    })
  })

  it('retries OpenAI once without pixels when the model rejects vision', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(errResponse(400, { error: { message: 'image unsupported' } }))
      .mockResolvedValueOnce(
        okResponse({
          choices: [{ message: { content: 'Please describe the image.' } }],
        }),
      )

    await expect(
      generateReply({
        config: config({ model: 'text-only-model' }),
        systemPrompt: 'system',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', url: 'data:image/png;base64,eA==' },
              { type: 'text', text: '[Image without caption]' },
            ],
          },
        ],
      }),
    ).resolves.toMatchObject({ text: 'Please describe the image.' })

    expect(fetch).toHaveBeenCalledTimes(2)
    const retryBody = JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body))
    expect(JSON.stringify(retryBody)).not.toContain('image_url')
    expect(JSON.stringify(retryBody)).toContain('[Image without caption]')
  })

  it('maps base64 image parts to Anthropic image blocks', async () => {
    vi.mocked(fetch).mockResolvedValue(
      okResponse({
        content: [{ type: 'text', text: 'I can see the receipt.' }],
      }),
    )

    await generateReply({
      config: config({ provider: 'anthropic', model: 'claude-test' }),
      systemPrompt: 'system',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', url: 'data:image/png;base64,cGl4ZWxz' },
            { type: 'text', text: 'Read this receipt.' },
          ],
        },
      ],
    })

    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))
    expect(body.messages[0]).toEqual({
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: 'cGl4ZWxz',
          },
        },
        { type: 'text', text: 'Read this receipt.' },
      ],
    })
  })
})
