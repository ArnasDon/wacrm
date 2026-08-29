import { describe, it, expect, vi } from 'vitest'
import { logAiUsage, deriveCatalogExternalFlags } from './usage'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ToolCallLogEntry } from './types'

function fakeDb() {
  const insert = vi.fn().mockResolvedValue({ error: null })
  const db = { from: vi.fn(() => ({ insert })) }
  return { db: db as unknown as SupabaseClient, insert, from: db.from }
}

describe('logAiUsage', () => {
  it('inserts a row mapping normalized usage to the log columns', async () => {
    const { db, insert, from } = fakeDb()
    await logAiUsage(db, {
      accountId: 'acct-1',
      conversationId: 'conv-1',
      mode: 'auto_reply',
      provider: 'anthropic',
      model: 'claude-x',
      usage: { promptTokens: 30, completionTokens: 6, totalTokens: 36 },
    })
    expect(from).toHaveBeenCalledWith('ai_usage_log')
    // Breakdown metrics (migration 049) the caller didn't compute must
    // land as NULL, never a misleading 0/false — "unknown" and
    // "confirmed absent" have to stay distinguishable in the data.
    expect(insert).toHaveBeenCalledWith({
      account_id: 'acct-1',
      conversation_id: 'conv-1',
      mode: 'auto_reply',
      provider: 'anthropic',
      model: 'claude-x',
      prompt_tokens: 30,
      completion_tokens: 6,
      total_tokens: 36,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      tool_call_count: null,
      catalog_attached: null,
      catalog_used: null,
      knowledge_retrieved: null,
      knowledge_chars: null,
      catalog_context_chars: null,
      routing_decision: null,
      knowledge_skipped_by_routing: null,
      latency_ms: null,
      catalog_external_used: null,
      catalog_external_blocked: null,
    })
  })

  it('writes the breakdown metrics when the caller computes them (FASE 2)', async () => {
    const { db, insert } = fakeDb()
    await logAiUsage(db, {
      accountId: 'acct-1',
      conversationId: 'conv-1',
      mode: 'auto_reply',
      provider: 'openai',
      model: 'gpt-x',
      usage: { promptTokens: 500, completionTokens: 40, totalTokens: 540 },
      toolCallCount: 3,
      catalogAttached: true,
      catalogUsed: true,
      knowledgeRetrieved: false,
      knowledgeChars: 0,
      catalogContextChars: 220,
      routingDecision: 'catalog',
      knowledgeSkippedByRouting: true,
      latencyMs: 1834,
    })
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        tool_call_count: 3,
        catalog_attached: true,
        catalog_used: true,
        knowledge_retrieved: false,
        knowledge_chars: 0,
        catalog_context_chars: 220,
        routing_decision: 'catalog',
        knowledge_skipped_by_routing: true,
        latency_ms: 1834,
      }),
    )
  })

  it('writes Budun observability flags (migration 052, FASE 12) when the caller computes them', async () => {
    const { db, insert } = fakeDb()
    await logAiUsage(db, {
      accountId: 'acct-1',
      conversationId: 'conv-1',
      mode: 'auto_reply',
      provider: 'openai',
      model: 'gpt-x',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      catalogExternalUsed: true,
      catalogExternalBlocked: false,
    })
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ catalog_external_used: true, catalog_external_blocked: false }),
    )
  })

  it('writes NULL (never false) for Budun observability flags when the caller never computed them — internal-only catalog, or no catalog at all', async () => {
    const { db, insert } = fakeDb()
    await logAiUsage(db, {
      accountId: 'acct-1',
      conversationId: 'conv-1',
      mode: 'auto_reply',
      provider: 'openai',
      model: 'gpt-x',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    })
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ catalog_external_used: null, catalog_external_blocked: null }),
    )
  })

  it('is a no-op when the provider reported no usage', async () => {
    const { db, from } = fakeDb()
    await logAiUsage(db, {
      accountId: 'acct-1',
      conversationId: null,
      mode: 'draft',
      provider: 'openai',
      model: 'gpt-x',
      usage: null,
    })
    expect(from).not.toHaveBeenCalled()
  })

  it('writes Anthropic cache-usage columns (FASE 8, migration 051) alongside the FASE 2 breakdown, none of it lost', async () => {
    const { db, insert } = fakeDb()
    await logAiUsage(db, {
      accountId: 'acct-1',
      conversationId: 'conv-1',
      mode: 'auto_reply',
      provider: 'anthropic',
      model: 'claude-x',
      usage: {
        promptTokens: 120,
        completionTokens: 15,
        totalTokens: 135,
        cacheCreationInputTokens: 900,
        cacheReadInputTokens: 0,
      },
      toolCallCount: 1,
      catalogAttached: true,
    })
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        cache_creation_input_tokens: 900,
        cache_read_input_tokens: 0,
        // FASE 2 breakdown still present — one new feature never crowds
        // out another.
        tool_call_count: 1,
        catalog_attached: true,
      }),
    )
  })

  it('writes NULL (never 0) for Anthropic cache-usage columns when the provider call never reported them', async () => {
    const { db, insert } = fakeDb()
    await logAiUsage(db, {
      accountId: 'acct-1',
      conversationId: 'conv-1',
      mode: 'auto_reply',
      provider: 'openrouter',
      model: 'meta-llama/llama-3.3-70b',
      usage: { promptTokens: 200, completionTokens: 40, totalTokens: 240 },
    })
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'openrouter',
        model: 'meta-llama/llama-3.3-70b',
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
      }),
    )
  })

  it("account_id always comes from the caller's own argument — nothing here ever reads it from usage/model/tool data", async () => {
    const { db, insert } = fakeDb()
    // A hostile/malformed `usage` object cannot smuggle an account_id in
    // — logAiUsage only ever inserts the caller-supplied `args.accountId`
    // string, never anything parsed out of the provider response.
    await logAiUsage(db, {
      accountId: 'acct-real',
      conversationId: 'conv-1',
      mode: 'auto_reply',
      provider: 'openai',
      model: 'gpt-x',
      usage: {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
        // @ts-expect-error — deliberately shaped like an injection attempt.
        accountId: 'acct-attacker',
      },
    })
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ account_id: 'acct-real' }))
  })

  it('never throws when the insert errors', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { message: 'boom' } })
    const db = { from: vi.fn(() => ({ insert })) } as unknown as SupabaseClient
    await expect(
      logAiUsage(db, {
        accountId: 'acct-1',
        conversationId: 'conv-1',
        mode: 'draft',
        provider: 'openai',
        model: 'gpt-x',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      }),
    ).resolves.toBeUndefined()
  })
})

// ============================================================
// deriveCatalogExternalFlags — AI optimization project, FASE 12
// (observability). Pure function, no DB — every case is a plain
// input/output assertion. Covers matrix items 11 ("Budun metrics
// aisladas por account" — the isolation itself comes from `toolCalls`
// always being scoped to the one account's own dispatch, verified at
// the auto-reply.ts integration level instead), 12 ("rate-limit events
// correctos"), and 13 ("catálogo interno no contabilizado como llamada
// externa Budun").
// ============================================================
function toolCall(result: unknown): ToolCallLogEntry {
  return { name: 'search_catalog', input: {}, result }
}

describe('deriveCatalogExternalFlags', () => {
  it('12. reports catalogExternalUsed=true when a tool result carries external_used', () => {
    const flags = deriveCatalogExternalFlags([toolCall({ products: [], total: 0, has_more: false, external_used: true })])
    expect(flags).toEqual({ catalogExternalUsed: true, catalogExternalBlocked: undefined })
  })

  it('12. reports catalogExternalBlocked=true for the search_catalog boolean flag AND for the by-id error shape', () => {
    expect(deriveCatalogExternalFlags([toolCall({ products: [], external_limit_reached: true })]).catalogExternalBlocked).toBe(true)
    expect(deriveCatalogExternalFlags([toolCall({ error: 'external_limit_reached' })]).catalogExternalBlocked).toBe(true)
  })

  it('13. catálogo interno (no external markers at all) never gets counted as an external call', () => {
    const flags = deriveCatalogExternalFlags([toolCall({ products: [{ id: 'ds_1:x' }], total: 1, has_more: false })])
    expect(flags).toEqual({ catalogExternalUsed: undefined, catalogExternalBlocked: undefined })
  })

  it('no tool calls at all (no catalog attached/used this turn) → both flags undefined, never a false "not used"', () => {
    expect(deriveCatalogExternalFlags([])).toEqual({ catalogExternalUsed: undefined, catalogExternalBlocked: undefined })
  })

  it('used and blocked are not mutually exclusive across multiple tool calls in the same turn', () => {
    const flags = deriveCatalogExternalFlags([
      toolCall({ products: [], external_used: true }),
      toolCall({ error: 'external_limit_reached' }),
    ])
    expect(flags).toEqual({ catalogExternalUsed: true, catalogExternalBlocked: true })
  })

  it('never crashes on a malformed/non-object tool result', () => {
    expect(() => deriveCatalogExternalFlags([toolCall(null), toolCall('oops'), toolCall(undefined)])).not.toThrow()
    expect(deriveCatalogExternalFlags([toolCall(null)])).toEqual({ catalogExternalUsed: undefined, catalogExternalBlocked: undefined })
  })
})
