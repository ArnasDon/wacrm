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
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      usage: null,
    })
  })

  it('detects + strips the handoff sentinel', () => {
    expect(parseGeneration('[[HANDOFF]]')).toEqual({
      text: '',
      handoff: true,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      usage: null,
    })
    expect(parseGeneration('Let me get a human [[HANDOFF]]')).toEqual({
      text: 'Let me get a human',
      handoff: true,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      usage: null,
    })
  })

  it('detects + strips the mark-deal-won sentinel', () => {
    expect(parseGeneration('Great, all set! [[ACTION:mark_deal_won]]')).toEqual({
      text: 'Great, all set!',
      handoff: false,
      markDealWon: true,
      moveToStageName: null,
      sendCatalog: false,
      usage: null,
    })
  })

  it('never signals both handoff and markDealWon confusingly — each sentinel is independent', () => {
    const res = parseGeneration('[[ACTION:mark_deal_won]]')
    expect(res.handoff).toBe(false)
    expect(res.markDealWon).toBe(true)
    expect(res.text).toBe('')
  })

  it('detects + strips the move-deal sentinel, capturing the stage name', () => {
    expect(parseGeneration('Sounds great! [[ACTION:move_deal:Negotiation]]')).toEqual({
      text: 'Sounds great!',
      handoff: false,
      markDealWon: false,
      moveToStageName: 'Negotiation',
      sendCatalog: false,
      usage: null,
    })
  })

  it('captures a multi-word / accented stage name verbatim', () => {
    const res = parseGeneration('Perfecto. [[ACTION:move_deal:Cotización enviada]]')
    expect(res.moveToStageName).toBe('Cotización enviada')
    expect(res.text).toBe('Perfecto.')
  })

  it('allows the purchase-confirmation and move-deal markers to appear together', () => {
    const res = parseGeneration(
      'All set! [[ACTION:move_deal:Negotiation]] [[ACTION:mark_deal_won]]',
    )
    expect(res.markDealWon).toBe(true)
    expect(res.moveToStageName).toBe('Negotiation')
    expect(res.text).toBe('All set!')
  })

  it('detects + strips the send-catalog sentinel', () => {
    expect(parseGeneration('Here you go! [[ACTION:send_catalog]]')).toEqual({
      text: 'Here you go!',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: true,
      usage: null,
    })
  })

  it('allows send-catalog to appear alongside move-deal in the same reply', () => {
    const res = parseGeneration(
      'Claro, aquí tienes. [[ACTION:send_catalog]] [[ACTION:move_deal:Cotización]]',
    )
    expect(res.sendCatalog).toBe(true)
    expect(res.moveToStageName).toBe('Cotización')
    expect(res.text).toBe('Claro, aquí tienes.')
  })

  it('passes usage straight through', () => {
    const usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
    expect(parseGeneration('Hi', usage)).toEqual({
      text: 'Hi',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
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
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
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
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
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
