import { describe, expect, it, vi } from 'vitest'
import type { WacrmSupabaseClient } from '@/lib/supabase/types'
import { createAgentTraceCollector, recordTrace } from './trace'

function traceDb() {
  const insert = vi.fn().mockResolvedValue({ error: null })
  return {
    db: { from: vi.fn(() => ({ insert })) } as unknown as WacrmSupabaseClient,
    insert,
  }
}

describe('agent trace', () => {
  it('stores operational metadata without customer or tool payloads', async () => {
    const { db, insert } = traceDb()
    await recordTrace(db, {
      accountId: 'acct-1',
      agentId: 'agent-1',
      conversationId: 'conv-1',
      turnId: 'turn-1',
      startedAt: 100,
      intent: 'sales',
      modelTier: 'smart',
      finalAction: 'reply',
      totalMs: 321.4,
      memoryMatchCount: 2,
      toolCalls: [{ name: 'search_catalog', ms: 88.7, succeeded: true }],
    })

    expect(insert).toHaveBeenCalledWith({
      account_id: 'acct-1',
      agent_id: 'agent-1',
      conversation_id: 'conv-1',
      turn_id: 'turn-1',
      intent: 'sales',
      model_tier: 'smart',
      final_action: 'reply',
      total_ms: 321,
      memory_match_count: 2,
      tool_calls: [
        { sequence: 0, name: 'search_catalog', ms: 89, succeeded: true },
      ],
    })
    expect(JSON.stringify(insert.mock.calls)).not.toContain('arguments')
    expect(JSON.stringify(insert.mock.calls)).not.toContain('result')
  })

  it('finishes once and keeps ordered tool timings', async () => {
    const { db, insert } = traceDb()
    let now = 1_000
    const trace = createAgentTraceCollector({
      db,
      accountId: 'acct-1',
      agentId: 'agent-1',
      conversationId: 'conv-1',
      turnId: 'turn-1',
      now: () => now,
    })
    trace.setIntent('faq', 'fast')
    trace.recordToolCall({ name: 'search_knowledge', ms: 12, succeeded: true })
    now = 1_145
    trace.finish('reply')
    trace.finish('handoff')
    await Promise.resolve()

    expect(insert).toHaveBeenCalledOnce()
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: 'faq',
        model_tier: 'fast',
        final_action: 'reply',
        total_ms: 145,
        tool_calls: [
          {
            sequence: 0,
            name: 'search_knowledge',
            ms: 12,
            succeeded: true,
          },
        ],
      }),
    )
  })
})
