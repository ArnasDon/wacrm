import { afterEach, describe, expect, it, vi } from 'vitest'
import { completeAiRun, createAiRun, logAiRetrievalEvent, logAiToolCall } from './run-log'

type Call = { table: string; op: string; value?: unknown; filters?: Record<string, unknown> }

function client(options: { insertErrors?: Record<string, Error>; updateError?: Error } = {}) {
  const calls: Call[] = []
  return {
    calls,
    from(table: string) {
      return {
        insert(value: unknown) {
          calls.push({ table, op: 'insert', value })
          if (table === 'ai_runs') {
            return {
              select: () => ({
                single: async () => ({ data: options.insertErrors?.[table] ? null : { id: 'run-1' }, error: options.insertErrors?.[table] ?? null }),
              }),
            }
          }
          return Promise.resolve({ error: options.insertErrors?.[table] ?? null })
        },
        update(value: unknown) {
          calls.push({ table, op: 'update', value })
          return {
            eq: async (column: string, filter: unknown) => {
              const call = calls.at(-1)
              if (call) call.filters = { [column]: filter }
              return { error: options.updateError ?? null }
            },
          }
        },
      }
    },
  }
}

afterEach(() => vi.restoreAllMocks())

describe('run-log helpers', () => {
  it('creates and completes an AI run with scoped payloads and filter', async () => {
    const db = client()
    const now = vi.spyOn(Date.prototype, 'toISOString').mockReturnValue('2026-07-23T12:00:00.000Z')

    await expect(
      createAiRun(db as never, {
        accountId: 'acct-1',
        conversationId: 'conversation-1',
        userId: 'user-1',
        surface: 'whatsapp_agent',
        agentRole: 'support',
        provider: 'openai',
        model: 'gpt-test',
        metadata: { source: 'test' },
      }),
    ).resolves.toBe('run-1')

    await completeAiRun(db as never, { runId: 'run-1', status: 'completed', inputTokens: 1, outputTokens: 2 })

    expect(db.calls).toEqual([
      {
        table: 'ai_runs',
        op: 'insert',
        value: {
          account_id: 'acct-1',
          conversation_id: 'conversation-1',
          user_id: 'user-1',
          surface: 'whatsapp_agent',
          agent_role: 'support',
          provider: 'openai',
          model: 'gpt-test',
          metadata: { source: 'test' },
        },
      },
      {
        table: 'ai_runs',
        op: 'update',
        value: {
          status: 'completed',
          input_tokens: 1,
          output_tokens: 2,
          error: null,
          completed_at: '2026-07-23T12:00:00.000Z',
        },
        filters: { id: 'run-1' },
      },
    ])
    expect(now).toHaveBeenCalled()
  })

  it('records account-scoped retrieval and tool payloads', async () => {
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

    expect(db.calls).toEqual([
      {
        table: 'ai_retrieval_events',
        op: 'insert',
        value: {
          account_id: 'acct-1',
          ai_run_id: 'run-1',
          query: 'refund',
          retrieval_mode: 'fts',
          chunk_ids: ['chunk-1'],
          scores: [{ chunkId: 'chunk-1', score: 0.8 }],
        },
      },
      {
        table: 'ai_tool_calls',
        op: 'insert',
        value: {
          account_id: 'acct-1',
          ai_run_id: 'run-1',
          tool_name: 'send_message',
          arguments: { text: 'hello' },
          status: 'proposed',
          result: {},
          error: null,
        },
      },
    ])
  })

  it('does nothing when a run id is null', async () => {
    const db = client()
    await completeAiRun(db as never, { runId: null, status: 'completed' })
    await logAiRetrievalEvent(db as never, {
      accountId: 'acct-1',
      runId: null,
      query: 'refund',
      retrievalMode: 'fts',
      chunkIds: [],
      scores: [],
    })
    await logAiToolCall(db as never, {
      accountId: 'acct-1',
      runId: null,
      toolName: 'send_message',
      arguments: {},
      status: 'skipped',
    })

    expect(db.calls).toEqual([])
  })

  it('logs Supabase errors without interrupting callers', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const db = client({
      insertErrors: {
        ai_runs: new Error('create failed'),
        ai_retrieval_events: new Error('retrieval failed'),
        ai_tool_calls: new Error('tool failed'),
      },
      updateError: new Error('complete failed'),
    })

    await expect(createAiRun(db as never, {
      accountId: 'acct-1',
      surface: 'manual_test',
      agentRole: 'support',
    })).resolves.toBeNull()
    await expect(completeAiRun(db as never, { runId: 'run-1', status: 'failed' })).resolves.toBeUndefined()
    await expect(logAiRetrievalEvent(db as never, {
      accountId: 'acct-1',
      runId: 'run-1',
      query: 'refund',
      retrievalMode: 'semantic',
      chunkIds: [],
      scores: [],
    })).resolves.toBeUndefined()
    await expect(logAiToolCall(db as never, {
      accountId: 'acct-1',
      runId: 'run-1',
      toolName: 'send_message',
      arguments: {},
      status: 'failed',
    })).resolves.toBeUndefined()

    expect(errors).toHaveBeenCalledTimes(4)
    expect(errors.mock.calls.map(([message]) => message)).toEqual([
      '[ai-run-log] createAiRun failed:',
      '[ai-run-log] completeAiRun failed:',
      '[ai-run-log] logAiRetrievalEvent failed:',
      '[ai-run-log] logAiToolCall failed:',
    ])
  })
})
