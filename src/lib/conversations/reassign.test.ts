import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { reassignUnclaimedConversations } from './reassign'

const NOW = new Date('2026-08-15T12:00:00Z').getTime()
const minsAgo = (m: number) => new Date(NOW - m * 60_000).toISOString()
const secsAgo = (s: number) => new Date(NOW - s * 1_000).toISOString()

interface Candidate {
  id: string
  account_id: string
  updated_at: string
}
interface Config {
  account_id: string
  unclaimed_conversation_timeout_minutes: number | null
}
interface Presence {
  user_id: string
  last_seen_at: string
}

interface Fixture {
  candidates: Candidate[]
  configs?: Config[]
  presence?: Record<string, Presence[]>
  openCounts?: Record<string, { assigned_agent_id: string }[]>
  claimResults?: Record<string, boolean>
}

/** A minimal fake Supabase query builder that's "thenable" at every
 *  step (like the real PostgrestFilterBuilder), so it can be awaited
 *  after any chain length — matching how reassign.ts actually calls it
 *  (some chains terminate in `.limit()`/`.in()`, others in
 *  `.maybeSingle()`). */
function makeDb(fx: Fixture) {
  const claims: { id: string; agent: string }[] = []

  function builder(table: string) {
    const state: {
      mode: 'select' | 'update'
      updatePayload?: Record<string, unknown>
      eqCalls: [string, unknown][]
      inCol?: string
    } = { mode: 'select', eqCalls: [] }

    const findEq = (col: string) => state.eqCalls.find(([c]) => c === col)?.[1]

    async function resolveMaybeSingle() {
      if (table === 'conversations' && state.mode === 'update') {
        const id = findEq('id') as string
        const ok = fx.claimResults?.[id] ?? true
        if (ok) {
          claims.push({ id, agent: state.updatePayload!.assigned_agent_id as string })
          return { data: { id }, error: null }
        }
        return { data: null, error: null }
      }
      return { data: null, error: null }
    }

    async function resolveDefault() {
      if (table === 'conversations' && state.mode === 'select' && state.inCol === 'assigned_agent_id') {
        const accountId = findEq('account_id') as string
        return { data: fx.openCounts?.[accountId] ?? [], error: null }
      }
      if (table === 'conversations' && state.mode === 'select') {
        return { data: fx.candidates, error: null }
      }
      if (table === 'ai_configs') {
        return { data: fx.configs ?? [], error: null }
      }
      if (table === 'member_presence') {
        const accountId = findEq('account_id') as string
        return { data: fx.presence?.[accountId] ?? [], error: null }
      }
      return { data: null, error: null }
    }

    const b: Record<string, unknown> = {
      select: () => b,
      update: (payload: Record<string, unknown>) => {
        state.mode = 'update'
        state.updatePayload = payload
        return b
      },
      eq: (col: string, val: unknown) => {
        state.eqCalls.push([col, val])
        return b
      },
      is: (col: string, val: unknown) => {
        state.eqCalls.push([col, val])
        return b
      },
      lte: () => b,
      order: () => b,
      limit: () => b,
      in: (col: string) => {
        state.inCol = col
        return b
      },
      maybeSingle: () => resolveMaybeSingle(),
      then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
        resolveDefault().then(onFulfilled, onRejected),
    }
    return b
  }

  return {
    db: { from: (table: string) => builder(table) } as unknown as SupabaseClient,
    claims,
  }
}

describe('reassignUnclaimedConversations', () => {
  it('is a no-op when there are no unassigned open conversations', async () => {
    const { db } = makeDb({ candidates: [] })
    const result = await reassignUnclaimedConversations(db, NOW)
    expect(result).toEqual({ processed: 0, assigned: 0 })
  })

  it('skips a conversation that has not yet aged past the default 10-minute timeout', async () => {
    const { db, claims } = makeDb({
      candidates: [{ id: 'conv-1', account_id: 'acct-1', updated_at: minsAgo(2) }],
      presence: { 'acct-1': [{ user_id: 'agent-1', last_seen_at: secsAgo(5) }] },
    })
    const result = await reassignUnclaimedConversations(db, NOW)
    expect(result).toEqual({ processed: 0, assigned: 0 })
    expect(claims).toEqual([])
  })

  it('assigns a stale conversation to the only online advisor', async () => {
    const { db, claims } = makeDb({
      candidates: [{ id: 'conv-1', account_id: 'acct-1', updated_at: minsAgo(11) }],
      presence: { 'acct-1': [{ user_id: 'agent-1', last_seen_at: secsAgo(5) }] },
    })
    const result = await reassignUnclaimedConversations(db, NOW)
    expect(result).toEqual({ processed: 1, assigned: 1 })
    expect(claims).toEqual([{ id: 'conv-1', agent: 'agent-1' }])
  })

  it('leaves the conversation for the next sweep when nobody is online', async () => {
    const { db, claims } = makeDb({
      candidates: [{ id: 'conv-1', account_id: 'acct-1', updated_at: minsAgo(11) }],
      presence: { 'acct-1': [] },
    })
    const result = await reassignUnclaimedConversations(db, NOW)
    expect(result).toEqual({ processed: 1, assigned: 0 })
    expect(claims).toEqual([])
  })

  it('treats a presence row stale beyond the offline threshold as not online', async () => {
    const { db, claims } = makeDb({
      candidates: [{ id: 'conv-1', account_id: 'acct-1', updated_at: minsAgo(11) }],
      // 100s since last heartbeat > OFFLINE_AFTER_MS (75s) — should read as offline.
      presence: { 'acct-1': [{ user_id: 'agent-1', last_seen_at: secsAgo(100) }] },
    })
    const result = await reassignUnclaimedConversations(db, NOW)
    expect(result.assigned).toBe(0)
    expect(claims).toEqual([])
  })

  it('picks the advisor with the fewest currently-assigned open conversations', async () => {
    const { db, claims } = makeDb({
      candidates: [{ id: 'conv-1', account_id: 'acct-1', updated_at: minsAgo(11) }],
      presence: {
        'acct-1': [
          { user_id: 'agent-busy', last_seen_at: secsAgo(5) },
          { user_id: 'agent-free', last_seen_at: secsAgo(5) },
        ],
      },
      openCounts: {
        'acct-1': [
          { assigned_agent_id: 'agent-busy' },
          { assigned_agent_id: 'agent-busy' },
          { assigned_agent_id: 'agent-busy' },
        ],
      },
    })
    const result = await reassignUnclaimedConversations(db, NOW)
    expect(result.assigned).toBe(1)
    expect(claims).toEqual([{ id: 'conv-1', agent: 'agent-free' }])
  })

  it('load-balances multiple stale conversations for the same account across this run', async () => {
    const { db, claims } = makeDb({
      candidates: [
        { id: 'conv-1', account_id: 'acct-1', updated_at: minsAgo(11) },
        { id: 'conv-2', account_id: 'acct-1', updated_at: minsAgo(12) },
      ],
      presence: {
        'acct-1': [
          { user_id: 'agent-a', last_seen_at: secsAgo(5) },
          { user_id: 'agent-b', last_seen_at: secsAgo(5) },
        ],
      },
    })
    const result = await reassignUnclaimedConversations(db, NOW)
    expect(result).toEqual({ processed: 2, assigned: 2 })
    // Both advisors start at 0 load — the two conversations should not
    // both land on the same advisor.
    const agents = claims.map((c) => c.agent).sort()
    expect(agents).toEqual(['agent-a', 'agent-b'])
  })

  it('respects a per-account configured timeout instead of the default', async () => {
    const { db, claims } = makeDb({
      candidates: [{ id: 'conv-1', account_id: 'acct-1', updated_at: minsAgo(11) }],
      configs: [{ account_id: 'acct-1', unclaimed_conversation_timeout_minutes: 60 }],
      presence: { 'acct-1': [{ user_id: 'agent-1', last_seen_at: secsAgo(5) }] },
    })
    // 11 minutes stale, but this account requires 60 — not due yet.
    const result = await reassignUnclaimedConversations(db, NOW)
    expect(result).toEqual({ processed: 0, assigned: 0 })
    expect(claims).toEqual([])
  })

  it('assigns once a shorter configured timeout is exceeded', async () => {
    const { db, claims } = makeDb({
      candidates: [{ id: 'conv-1', account_id: 'acct-1', updated_at: minsAgo(3) }],
      configs: [{ account_id: 'acct-1', unclaimed_conversation_timeout_minutes: 2 }],
      presence: { 'acct-1': [{ user_id: 'agent-1', last_seen_at: secsAgo(5) }] },
    })
    const result = await reassignUnclaimedConversations(db, NOW)
    expect(result).toEqual({ processed: 1, assigned: 1 })
    expect(claims).toEqual([{ id: 'conv-1', agent: 'agent-1' }])
  })
})
