import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateOpenAi } from './openai'
import { AiError } from '../types'
import type { ProviderArgs } from './shared'

const schema = {
  type: 'object',
  properties: { answer: { type: 'string' } },
  required: ['answer'],
  additionalProperties: false,
}

function args(overrides: Partial<ProviderArgs> = {}): ProviderArgs {
  return {
    apiKey: 'sk-test',
    model: 'gpt-test',
    systemPrompt: 'system',
    messages: [{ role: 'user', content: 'user' }],
    timeoutMs: 5000,
    maxTokens: 4096,
    structuredOutput: { name: 'emit_automation_turn', schema },
    ...overrides,
  }
}

function response(body: unknown, init?: ResponseInit): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('generateOpenAi', () => {
  it('sends strict JSON Schema REST payload and extracts content and usage', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response({
        choices: [
          {
            finish_reason: 'stop',
            message: { content: '{"answer":"ok"}', refusal: null },
          },
        ],
        usage: { prompt_tokens: 21, completion_tokens: 7 },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateOpenAi(args())

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect(request.headers).toMatchObject({ authorization: 'Bearer sk-test' })
    expect(JSON.parse(request.body as string)).toEqual({
      model: 'gpt-test',
      messages: [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'user' },
      ],
      max_completion_tokens: 4096,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'emit_automation_turn',
          strict: true,
          schema,
        },
      },
    })
    expect(result).toEqual({
      text: '{"answer":"ok"}',
      structuredData: { answer: 'ok' },
      usage: { promptTokens: 21, completionTokens: 7 },
    })
  })

  it('fails closed on a model refusal', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        response({
          choices: [
            {
              finish_reason: 'stop',
              message: { content: null, refusal: 'I cannot comply.' },
            },
          ],
        }),
      ),
    )

    const error = await generateOpenAi(args()).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(AiError)
    expect(error).toMatchObject({ code: 'model_incompatible' })
  })

  it('fails closed on a truncated structured response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        response({
          choices: [
            {
              finish_reason: 'length',
              message: { content: '{"answer":' },
            },
          ],
        }),
      ),
    )

    const error = await generateOpenAi(args()).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(AiError)
    expect(error).toMatchObject({ code: 'model_incompatible' })
  })

  it('maps a structured-contract rejection to model_incompatible', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(response('unsupported response_format', { status: 400 })),
    )

    const error = await generateOpenAi(args()).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(AiError)
    expect(error).toMatchObject({ code: 'model_incompatible', status: 422 })
  })

  it('preserves provider_timeout and provider_error transport codes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' })),
    )
    const timeoutError = await generateOpenAi(args()).catch((caught: unknown) => caught)
    expect(timeoutError).toMatchObject({ code: 'provider_timeout', status: 504 })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response('upstream failed', { status: 500 })))
    const providerError = await generateOpenAi(args()).catch((caught: unknown) => caught)
    expect(providerError).toMatchObject({ code: 'provider_error', status: 502 })
  })
})
