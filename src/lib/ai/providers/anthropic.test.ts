import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateAnthropic } from './anthropic'
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
    apiKey: 'anthropic-test',
    model: 'claude-test',
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

describe('generateAnthropic', () => {
  it('sends one forced tool REST payload and extracts tool input and usage', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response({
        content: [
          {
            type: 'tool_use',
            id: 'tool-1',
            name: 'emit_automation_turn',
            input: { answer: 'ok' },
          },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 18, output_tokens: 6 },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateAnthropic(args())

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(request.headers).toMatchObject({
      'x-api-key': 'anthropic-test',
      'anthropic-version': '2023-06-01',
    })
    expect(JSON.parse(request.body as string)).toEqual({
      model: 'claude-test',
      system: 'system',
      max_tokens: 4096,
      messages: [{ role: 'user', content: 'user' }],
      tools: [
        {
          name: 'emit_automation_turn',
          description:
            'Return exactly one structured response matching the provided schema.',
          strict: true,
          input_schema: schema,
        },
      ],
      tool_choice: { type: 'tool', name: 'emit_automation_turn' },
    })
    expect(result).toEqual({
      text: '',
      structuredData: { answer: 'ok' },
      usage: { promptTokens: 18, completionTokens: 6 },
    })
  })

  it('fails closed when the required tool_use block is absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        response({
          content: [{ type: 'text', text: '{"answer":"free JSON"}' }],
          stop_reason: 'end_turn',
        }),
      ),
    )

    const error = await generateAnthropic(args()).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(AiError)
    expect(error).toMatchObject({ code: 'model_incompatible' })
  })

  it('fails closed when Anthropic truncates the tool call', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        response({
          content: [],
          stop_reason: 'max_tokens',
        }),
      ),
    )

    const error = await generateAnthropic(args()).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(AiError)
    expect(error).toMatchObject({ code: 'model_incompatible' })
  })

  it('maps a structured-contract rejection to model_incompatible', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(response('tool_choice unsupported by model', { status: 400 })),
    )

    const error = await generateAnthropic(args()).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(AiError)
    expect(error).toMatchObject({ code: 'model_incompatible', status: 422 })
  })

  it('preserves provider_unreachable for network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    const error = await generateAnthropic(args()).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(AiError)
    expect(error).toMatchObject({ code: 'provider_unreachable', status: 502 })
  })
})
