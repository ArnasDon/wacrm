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
    await expect(generateReply({
      config: config(),
      systemPrompt: 'system',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [],
      executeTool: async () => JSON.stringify({ ok: true }),
    })).rejects.toBeInstanceOf(AiError)
  })

  it('returns provider text for a normal OpenAI response', async () => {
    vi.mocked(fetch).mockResolvedValue(okResponse({
      choices: [{ message: { content: 'Hello!' } }],
      usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
    }))

    await expect(generateReply({
      config: config(),
      systemPrompt: 'system',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [],
      executeTool: async () => JSON.stringify({ ok: true }),
    })).resolves.toMatchObject({ text: 'Hello!', handoff: false })
  })
})
