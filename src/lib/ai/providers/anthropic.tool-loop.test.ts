import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runAnthropicToolLoop } from './anthropic'
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

function baseArgs(overrides: Partial<Parameters<typeof runAnthropicToolLoop>[0]> = {}) {
  return {
    apiKey: 'sk-test',
    model: 'claude-test',
    systemPrompt: 'You are a test agent.',
    messages: [{ role: 'user' as const, content: 'Quero marcar uma reunião' }],
    timeoutMs: 5000,
    tools,
    executor: (async () => ({ content: 'ok', isError: false })) as ToolExecutor,
    ...overrides,
  }
}

describe('runAnthropicToolLoop', () => {
  it('returns text directly when the model does not call a tool', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        content: [{ type: 'text', text: 'Olá! Como posso ajudar?' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    )
    const result = await runAnthropicToolLoop(baseArgs())
    expect(result.text).toBe('Olá! Como posso ajudar?')
    expect(result.iterations).toBe(1)
    expect(result.hitIterationLimit).toBe(false)
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 })
  })

  it('executes a tool call, feeds the result back, and returns the final answer', async () => {
    const executor = vi.fn(async () => ({ content: '{"slots":["09:00"]}', isError: false }))
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse({
          content: [
            { type: 'text', text: 'Vou verificar.' },
            { type: 'tool_use', id: 'tu-1', name: 'check_availability', input: { range_start: 'x' } },
          ],
          stop_reason: 'tool_use',
          usage: { input_tokens: 20, output_tokens: 8 },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          content: [{ type: 'text', text: 'Tenho as 09:00 livre.' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 30, output_tokens: 6 },
        }),
      )

    const result = await runAnthropicToolLoop(baseArgs({ executor }))

    expect(executor).toHaveBeenCalledWith({
      id: 'tu-1',
      name: 'check_availability',
      input: { range_start: 'x' },
    })
    expect(result.text).toBe('Tenho as 09:00 livre.')
    expect(result.iterations).toBe(2)
    expect(result.usage).toEqual({ promptTokens: 50, completionTokens: 14, totalTokens: 64 })

    // Second request must carry the assistant tool_use turn + a single
    // user turn with the tool_result batched in.
    const secondCallBody = JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string)
    const roles = secondCallBody.messages.map((m: { role: string }) => m.role)
    expect(roles).toEqual(['user', 'assistant', 'user'])
    const toolResultTurn = secondCallBody.messages[2]
    expect(toolResultTurn.content).toEqual([
      { type: 'tool_result', tool_use_id: 'tu-1', content: '{"slots":["09:00"]}', is_error: false },
    ])
  })

  it('stops after maxIterations without a natural end_turn', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        content: [{ type: 'tool_use', id: 'tu-x', name: 'check_availability', input: {} }],
        stop_reason: 'tool_use',
        usage: { input_tokens: 5, output_tokens: 2 },
      }),
    )
    const result = await runAnthropicToolLoop(baseArgs({ maxIterations: 2 }))
    expect(result.iterations).toBe(2)
    expect(result.hitIterationLimit).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('marks a failed tool result as is_error and keeps looping instead of throwing', async () => {
    const failingExecutor = vi.fn(async () => ({ content: 'not found', isError: true }))
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse({
          content: [{ type: 'tool_use', id: 'tu-1', name: 'find_event', input: {} }],
          stop_reason: 'tool_use',
          usage: {},
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          content: [{ type: 'text', text: 'Não encontrei nenhuma reunião.' }],
          stop_reason: 'end_turn',
          usage: {},
        }),
      )

    const result = await runAnthropicToolLoop(baseArgs({ executor: failingExecutor }))
    expect(result.text).toBe('Não encontrei nenhuma reunião.')
    const secondCallBody = JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string)
    expect(secondCallBody.messages[2].content[0].is_error).toBe(true)
  })
})
