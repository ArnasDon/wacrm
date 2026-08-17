import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const h = vi.hoisted(() => ({
  executeReadTool: vi.fn(),
}))

vi.mock('./tools', () => ({
  ASSISTANT_TOOLS: [
    { name: 'get_business_metrics', description: 'x', input_schema: { type: 'object', properties: {} } },
    { name: 'move_deal', description: 'x', input_schema: { type: 'object', properties: {} } },
  ],
  executeReadTool: h.executeReadTool,
  isWriteTool: (name: string) => name === 'move_deal',
}))

import { runAssistantTurn } from './anthropic-tools'

function okResponse(json: unknown): Response {
  return { ok: true, status: 200, json: async () => json } as unknown as Response
}

const db = {} as SupabaseClient
const baseArgs = {
  db,
  accountId: 'acct-1',
  apiKey: 'sk-test',
  model: 'claude-test',
  systemPrompt: 'be helpful',
  timeoutMs: 5000,
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  h.executeReadTool.mockReset()
})
afterEach(() => vi.unstubAllGlobals())

describe('runAssistantTurn', () => {
  it('returns plain text when the model calls no tool', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      okResponse({
        content: [{ type: 'text', text: 'You won 3 deals this month.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 20 },
      }),
    )

    const result = await runAssistantTurn({ ...baseArgs, messages: [{ role: 'user', content: 'how many deals did we win?' }] })

    expect(result.reply).toBe('You won 3 deals this month.')
    expect(result.pendingAction).toBeNull()
    expect(result.usage).toEqual({ promptTokens: 100, completionTokens: 20, totalTokens: 120 })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('stops the loop and proposes a write action without executing it', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      okResponse({
        content: [
          { type: 'text', text: 'Moving it now.' },
          { type: 'tool_use', id: 'call_1', name: 'move_deal', input: { targetId: 'deal-1', stageId: 'stage-2' } },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 50, output_tokens: 10 },
      }),
    )

    const result = await runAssistantTurn({ ...baseArgs, messages: [{ role: 'user', content: "move Juan's deal to Won" }] })

    expect(result.pendingAction).toEqual({ action: 'move_deal', input: { targetId: 'deal-1', stageId: 'stage-2' } })
    expect(h.executeReadTool).not.toHaveBeenCalled()
    // Only one round — a write-tool call ends the loop immediately.
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('executes read tools and feeds results back before answering', async () => {
    h.executeReadTool.mockResolvedValueOnce({ deals: { won: 3, lost: 1 } })
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        okResponse({
          content: [{ type: 'tool_use', id: 'call_1', name: 'get_business_metrics', input: {} }],
          stop_reason: 'tool_use',
          usage: { input_tokens: 30, output_tokens: 5 },
        }),
      )
      .mockResolvedValueOnce(
        okResponse({
          content: [{ type: 'text', text: 'You won 3 and lost 1.' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 40, output_tokens: 8 },
        }),
      )

    const result = await runAssistantTurn({ ...baseArgs, messages: [{ role: 'user', content: 'summarize my sales' }] })

    expect(h.executeReadTool).toHaveBeenCalledWith(db, 'acct-1', 'get_business_metrics', {})
    expect(result.reply).toBe('You won 3 and lost 1.')
    expect(result.pendingAction).toBeNull()
    expect(result.usage).toEqual({ promptTokens: 70, completionTokens: 13, totalTokens: 83 })
    expect(fetch).toHaveBeenCalledTimes(2)

    // Second call's message history must carry the tool_result back.
    const secondCallBody = JSON.parse(vi.mocked(fetch).mock.calls[1][1]?.body as string)
    const lastMessage = secondCallBody.messages[secondCallBody.messages.length - 1]
    expect(lastMessage.role).toBe('user')
    expect(lastMessage.content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'call_1' })
  })

  it('surfaces a failed read tool as an error tool_result instead of throwing', async () => {
    h.executeReadTool.mockRejectedValueOnce(new Error('boom'))
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        okResponse({
          content: [{ type: 'tool_use', id: 'call_1', name: 'get_business_metrics', input: {} }],
          stop_reason: 'tool_use',
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      )
      .mockResolvedValueOnce(
        okResponse({
          content: [{ type: 'text', text: 'Something went wrong looking that up.' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      )

    const result = await runAssistantTurn({ ...baseArgs, messages: [{ role: 'user', content: 'summarize my sales' }] })

    expect(result.reply).toBe('Something went wrong looking that up.')
    const secondCallBody = JSON.parse(vi.mocked(fetch).mock.calls[1][1]?.body as string)
    const lastMessage = secondCallBody.messages[secondCallBody.messages.length - 1]
    expect(lastMessage.content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'call_1', content: 'boom', is_error: true })
  })

  it('bails out with a fallback reply after MAX_TOOL_ROUNDS of read-tool calls', async () => {
    h.executeReadTool.mockResolvedValue({})
    vi.mocked(fetch).mockResolvedValue(
      okResponse({
        content: [{ type: 'tool_use', id: 'call_x', name: 'get_business_metrics', input: {} }],
        stop_reason: 'tool_use',
        usage: { input_tokens: 5, output_tokens: 1 },
      }),
    )

    const result = await runAssistantTurn({ ...baseArgs, messages: [{ role: 'user', content: 'keep digging forever' }] })

    expect(result.pendingAction).toBeNull()
    expect(result.reply).toMatch(/narrow it down/i)
    expect(fetch).toHaveBeenCalledTimes(6)
  })
})
