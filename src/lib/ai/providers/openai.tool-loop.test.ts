import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runOpenAiToolLoop } from './openai'
import type { ToolDefinition } from '../tools/schema'
import type { ToolExecutor } from '../tools/loop-types'

const tools: ToolDefinition[] = [
  {
    name: 'check_availability',
    description: 'Check availability',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
]

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response
}

beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
afterEach(() => vi.unstubAllGlobals())

function baseArgs(overrides: Partial<Parameters<typeof runOpenAiToolLoop>[0]> = {}) {
  return {
    apiKey: 'sk-test',
    model: 'gpt-test',
    systemPrompt: 'You are a test agent.',
    messages: [{ role: 'user' as const, content: 'Quero marcar uma reunião' }],
    timeoutMs: 5000,
    tools,
    executor: (async () => ({ content: 'ok', isError: false })) as ToolExecutor,
    ...overrides,
  }
}

describe('runOpenAiToolLoop', () => {
  it('returns text directly when the model does not call a tool', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        choices: [{ message: { role: 'assistant', content: 'Olá!' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    )
    const result = await runOpenAiToolLoop(baseArgs())
    expect(result.text).toBe('Olá!')
    expect(result.iterations).toBe(1)
    expect(result.hitIterationLimit).toBe(false)
  })

  it('executes a tool call and feeds the JSON-parsed result back as a tool message', async () => {
    const executor = vi.fn(async () => ({ content: '{"slots":["09:00"]}', isError: false }))
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call-1',
                    type: 'function',
                    function: { name: 'check_availability', arguments: '{"range_start":"x"}' },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
          usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [
            { message: { role: 'assistant', content: 'Tenho as 09:00 livre.' }, finish_reason: 'stop' },
          ],
          usage: { prompt_tokens: 30, completion_tokens: 6, total_tokens: 36 },
        }),
      )

    const result = await runOpenAiToolLoop(baseArgs({ executor }))

    expect(executor).toHaveBeenCalledWith({
      id: 'call-1',
      name: 'check_availability',
      input: { range_start: 'x' },
    })
    expect(result.text).toBe('Tenho as 09:00 livre.')
    expect(result.iterations).toBe(2)

    const secondCallBody = JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string)
    const roles = secondCallBody.messages.map((m: { role: string }) => m.role)
    expect(roles).toEqual(['system', 'user', 'assistant', 'tool'])
    expect(secondCallBody.messages[3]).toEqual({
      role: 'tool',
      tool_call_id: 'call-1',
      content: '{"slots":["09:00"]}',
    })
  })

  it('stops after maxIterations without a natural stop', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                { id: 'call-x', type: 'function', function: { name: 'check_availability', arguments: '{}' } },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: {},
      }),
    )
    const result = await runOpenAiToolLoop(baseArgs({ maxIterations: 2 }))
    expect(result.iterations).toBe(2)
    expect(result.hitIterationLimit).toBe(true)
  })

  it('reports unparseable tool-call JSON as a tool error without throwing', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  { id: 'call-bad', type: 'function', function: { name: 'check_availability', arguments: '{bad json' } },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
          usage: {},
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [{ message: { role: 'assistant', content: 'desculpa, tive um problema' }, finish_reason: 'stop' }],
          usage: {},
        }),
      )

    const result = await runOpenAiToolLoop(baseArgs())
    expect(result.text).toBe('desculpa, tive um problema')
    const secondCallBody = JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string)
    expect(secondCallBody.messages[3].role).toBe('tool')
    expect(secondCallBody.messages[3].content).toMatch(/JSON/i)
  })
})
