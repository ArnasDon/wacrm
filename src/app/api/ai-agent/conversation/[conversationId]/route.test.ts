import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  conversation: { id: 'conversation-1' } as Record<string, unknown> | null,
  agent: null as Record<string, unknown> | null,
  state: null as Record<string, unknown> | null,
  lastRun: null as Record<string, unknown> | null,
  filters: [] as Array<{ table: string; column: string; value: unknown }>,
  upserts: [] as Array<{ table: string; payload: Record<string, unknown> }>,
  updates: [] as Array<{ table: string; payload: Record<string, unknown> }>,
}))

const getCurrentAccount = vi.hoisted(() => vi.fn())
const requireRole = vi.hoisted(() => vi.fn())

vi.mock('next/server', () => ({
  NextResponse: { json: (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), { status: init?.status ?? 200 }) },
}))

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount,
  requireRole,
  toErrorResponse(error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    return new Response(JSON.stringify({ error: message }), { status: message === 'Forbidden' ? 403 : 500 })
  },
}))

import { GET, PATCH } from './route'

const accountId = 'account-1'
const context = { params: Promise.resolve({ conversationId: 'conversation-1' }) }

beforeEach(() => {
  h.conversation = { id: 'conversation-1' }
  h.agent = null
  h.state = null
  h.lastRun = null
  h.filters = []
  h.upserts = []
  h.updates = []
  const supabase = createSupabase()
  getCurrentAccount.mockReset()
  requireRole.mockReset()
  getCurrentAccount.mockResolvedValue({ accountId, supabase })
  requireRole.mockResolvedValue({ accountId, supabase })
})

describe('AI conversation status route', () => {
  it('GET returns disabled when no agent exists', async () => {
    const response = await GET(new Request('http://localhost'), context)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ agent: null, state: null, effective_status: 'disabled', last_run: null })
    expect(h.filters).toContainEqual({ table: 'conversations', column: 'account_id', value: accountId })
  })

  it('GET returns the latest run and effective account-owned status', async () => {
    h.agent = { id: 'agent-1', name: 'Inbox AI', enabled: true }
    h.state = { id: 'state-1', status: 'paused', paused_reason: 'human reply' }
    h.lastRun = { id: 'run-1', status: 'succeeded', decision: { action: 'reply', text: 'Hello' }, error_message: null, created_at: '2026-01-01', finished_at: '2026-01-01' }

    const response = await GET(new Request('http://localhost'), context)

    await expect(response.json()).resolves.toMatchObject({ agent: h.agent, state: h.state, effective_status: 'paused', last_run: h.lastRun })
    expect(h.filters).toEqual(expect.arrayContaining([
      { table: 'ai_conversation_states', column: 'account_id', value: accountId },
      { table: 'ai_conversation_states', column: 'conversation_id', value: 'conversation-1' },
      { table: 'ai_agent_runs', column: 'account_id', value: accountId },
      { table: 'ai_agent_runs', column: 'conversation_id', value: 'conversation-1' },
    ]))
  })

  it('PATCH pause requires agent+ and scopes its state write', async () => {
    requireRole.mockRejectedValue(new Error('Forbidden'))
    const denied = await PATCH(request({ action: 'pause' }), context)
    expect(denied.status).toBe(403)
    expect(h.upserts).toEqual([])

    requireRole.mockResolvedValue({ accountId, supabase: createSupabase() })
    h.agent = { id: 'agent-1', name: 'Inbox AI', enabled: true }
    const response = await PATCH(request({ action: 'pause', reason: 'Human replied' }), context)

    expect(response.status).toBe(200)
    expect(requireRole).toHaveBeenCalledWith('agent')
    expect(h.upserts).toContainEqual({ table: 'ai_conversation_states', payload: expect.objectContaining({ account_id: accountId, conversation_id: 'conversation-1', ai_agent_id: 'agent-1', status: 'paused', paused_reason: 'Human replied' }) })
  })

  it('PATCH resume clears the paused reason', async () => {
    h.agent = { id: 'agent-1', name: 'Inbox AI', enabled: true }
    const response = await PATCH(request({ action: 'resume' }), context)

    expect(response.status).toBe(200)
    expect(h.upserts[0]?.payload).toMatchObject({ status: 'active', paused_reason: null })
  })

  it('PATCH handoff upserts state and keeps the conversation open', async () => {
    h.agent = { id: 'agent-1', name: 'Inbox AI', enabled: true }
    const response = await PATCH(request({ action: 'handoff', reason: 'Needs specialist' }), context)

    expect(response.status).toBe(200)
    expect(h.upserts[0]?.payload).toMatchObject({ status: 'handoff', paused_reason: 'Needs specialist' })
    expect(h.updates).toContainEqual({ table: 'conversations', payload: { status: 'open' } })
    expect(h.filters).toContainEqual({ table: 'conversations', column: 'account_id', value: accountId })
  })

  it('returns 404 for a cross-account conversation and writes nothing', async () => {
    h.conversation = null
    const response = await PATCH(request({ action: 'pause' }), context)

    expect(response.status).toBe(404)
    expect(h.upserts).toEqual([])
    expect(h.updates).toEqual([])
  })

  it('GET returns 404 for a cross-account conversation without loading AI state or runs', async () => {
    h.conversation = null

    const response = await GET(new Request('http://localhost'), context)

    expect(response.status).toBe(404)
    expect(h.filters).toEqual(expect.arrayContaining([
      { table: 'conversations', column: 'id', value: 'conversation-1' },
      { table: 'conversations', column: 'account_id', value: accountId },
    ]))
    expect(h.filters.some(({ table }) => table === 'ai_conversation_states' || table === 'ai_agent_runs')).toBe(false)
  })
})

function request(body: unknown) {
  return new Request('http://localhost', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}

function createSupabase() {
  return {
    from(table: string) {
      const query: Query = {
        select: () => query,
        eq: (column: string, value: unknown) => { h.filters.push({ table, column, value }); return query },
        order: () => query,
        limit: () => query,
        maybeSingle: async () => ({ data: table === 'conversations' ? h.conversation : table === 'ai_agents' ? h.agent : table === 'ai_conversation_states' ? h.state : h.lastRun, error: null }),
        upsert: (payload: Record<string, unknown>) => { h.upserts.push({ table, payload }); return query },
        update: (payload: Record<string, unknown>) => { h.updates.push({ table, payload }); return query },
      }
      return query
    },
  }
}

interface Query {
  select(): Query
  eq(column: string, value: unknown): Query
  order(): Query
  limit(): Query
  maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: null }>
  upsert(payload: Record<string, unknown>): Query
  update(payload: Record<string, unknown>): Query
}
