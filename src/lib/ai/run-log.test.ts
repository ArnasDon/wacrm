import { describe, expect, it } from 'vitest'
import { completeAiRun, createAiRun, logAiRetrievalEvent, logAiToolCall } from './run-log'

function client() {
  const calls: { table: string; op: string; value?: unknown }[] = []
  return {
    calls,
    from(table: string) {
      return {
        insert(value: unknown) {
          calls.push({ table, op: 'insert', value })
          return { select: () => ({ single: async () => ({ data: { id: 'run-1' }, error: null }) }) }
        },
        update(value: unknown) {
          calls.push({ table, op: 'update', value })
          return { eq: async () => ({ error: null }) }
        },
      }
    },
  }
}

describe('run-log helpers', () => {
  it('creates and completes an AI run without throwing', async () => {
    const db = client()
    await expect(
      createAiRun(db as never, {
        accountId: 'acct-1',
        surface: 'whatsapp_agent',
        agentRole: 'support',
        provider: 'openai',
        model: 'gpt-test',
      }),
    ).resolves.toBe('run-1')

    await completeAiRun(db as never, { runId: 'run-1', status: 'completed', inputTokens: 1, outputTokens: 2 })
    expect(db.calls.map((call) => `${call.table}:${call.op}`)).toEqual(['ai_runs:insert', 'ai_runs:update'])
  })

  it('logs retrieval events and tool calls', async () => {
    const db = client()
    await logAiRetrievalEvent(db as never, {
      accountId: 'acct-1',
      runId: 'run-1',
      query: 'refund',
      retrievalMode: 'fts',
      chunkIds: ['chunk-1'],
      scores: [{ chunkId: 'chunk-1', score: 0.8 }],
    })
    await logAiToolCall(db as never, {
      accountId: 'acct-1',
      runId: 'run-1',
      toolName: 'send_message',
      arguments: { text: 'hello' },
      status: 'proposed',
      result: {},
    })

    expect(db.calls.map((call) => `${call.table}:${call.op}`)).toEqual([
      'ai_retrieval_events:insert',
      'ai_tool_calls:insert',
    ])
  })
})
