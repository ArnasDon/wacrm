import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const h = vi.hoisted(() => ({ dispatchSystemAlert: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/observability/alerts', () => ({ dispatchSystemAlert: h.dispatchSystemAlert }))

import { checkAiLiveness } from './liveness'

interface FakeState {
  aiConfigAccounts: string[]
  usageAccounts: string[]
  eligibleConvs: { id: string; account_id: string }[]
  /** conversation_id -> customer message count in window */
  msgCounts: Record<string, number>
  /** conversations a teammate answered within TEAMMATE_QUIET_MS */
  staffConvs?: string[]
}

function fakeDb(s: FakeState): SupabaseClient {
  const thenable = (data: unknown) => ({
    then: (f: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(f),
  })
  return {
    from(table: string) {
      if (table === 'ai_configs') {
        const c = {
          select: () => c,
          eq: () => c,
          then: (f: (v: unknown) => unknown) =>
            Promise.resolve({ data: s.aiConfigAccounts.map((a) => ({ account_id: a })), error: null }).then(f),
        }
        return c
      }
      if (table === 'ai_usage_log') {
        const c = {
          select: () => c,
          gte: () => c,
          in: () => c,
          then: (f: (v: unknown) => unknown) =>
            Promise.resolve({ data: s.usageAccounts.map((a) => ({ account_id: a })), error: null }).then(f),
        }
        return c
      }
      if (table === 'conversations') {
        const c = {
          select: () => c,
          in: () => c,
          is: () => c,
          or: () => c,
          gte: () => c,
          then: (f: (v: unknown) => unknown) =>
            Promise.resolve({ data: s.eligibleConvs, error: null }).then(f),
        }
        return c
      }
      if (table === 'messages') {
        let convIds: string[] = []
        let sender = ''
        const c = {
          select: () => c,
          in: (_col: string, ids: string[]) => {
            convIds = ids
            return c
          },
          eq: (col: string, v: string) => {
            if (col === 'sender_type') sender = v
            return c
          },
          gte: () =>
            Promise.resolve(
              sender === 'agent'
                ? {
                    data: convIds
                      .filter((id) => s.staffConvs?.includes(id))
                      .map((id) => ({ conversation_id: id })),
                    error: null,
                  }
                : { count: convIds.reduce((n, id) => n + (s.msgCounts[id] ?? 0), 0), error: null },
            ),
        }
        return c
      }
      return thenable(null)
    },
  } as unknown as SupabaseClient
}

beforeEach(() => h.dispatchSystemAlert.mockClear())

describe('checkAiLiveness', () => {
  it('no alert when there are no AI-enabled accounts', async () => {
    const r = await checkAiLiveness(
      fakeDb({ aiConfigAccounts: [], usageAccounts: [], eligibleConvs: [], msgCounts: {} }),
    )
    expect(r).toEqual({ checkedAccounts: 0, deadAccounts: [] })
    expect(h.dispatchSystemAlert).not.toHaveBeenCalled()
  })

  it('no alert when the bot logged usage in the window', async () => {
    const r = await checkAiLiveness(
      fakeDb({
        aiConfigAccounts: ['a1'],
        usageAccounts: ['a1'],
        eligibleConvs: [
          { id: 'c1', account_id: 'a1' },
          { id: 'c2', account_id: 'a1' },
        ],
        msgCounts: { c1: 5, c2: 5 },
      }),
    )
    expect(r.deadAccounts).toEqual([])
    expect(h.dispatchSystemAlert).not.toHaveBeenCalled()
  })

  it('ALERTS when an AI-enabled account has traffic across 2+ conversations but zero usage', async () => {
    const r = await checkAiLiveness(
      fakeDb({
        aiConfigAccounts: ['a1'],
        usageAccounts: [],
        eligibleConvs: [
          { id: 'c1', account_id: 'a1' },
          { id: 'c2', account_id: 'a1' },
        ],
        msgCounts: { c1: 2, c2: 2 }, // 4 total, ≥3
      }),
    )
    expect(r.deadAccounts).toEqual([{ accountId: 'a1', eligibleInbound: 4, conversations: 2 }])
    expect(h.dispatchSystemAlert).toHaveBeenCalledTimes(1)
    expect(h.dispatchSystemAlert).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'critical', source: 'ai_liveness', dedupKey: 'ai_liveness' }),
    )
  })

  it('does NOT alert on a single busy conversation (reply-cap false positive guard)', async () => {
    const r = await checkAiLiveness(
      fakeDb({
        aiConfigAccounts: ['a1'],
        usageAccounts: [],
        eligibleConvs: [{ id: 'c1', account_id: 'a1' }], // only 1 conversation
        msgCounts: { c1: 20 },
      }),
    )
    expect(r.deadAccounts).toEqual([])
    expect(h.dispatchSystemAlert).not.toHaveBeenCalled()
  })

  it('does NOT alert when total inbound is below the threshold', async () => {
    const r = await checkAiLiveness(
      fakeDb({
        aiConfigAccounts: ['a1'],
        usageAccounts: [],
        eligibleConvs: [
          { id: 'c1', account_id: 'a1' },
          { id: 'c2', account_id: 'a1' },
        ],
        msgCounts: { c1: 1, c2: 1 }, // 2 total, < 3
      }),
    )
    expect(r.deadAccounts).toEqual([])
    expect(h.dispatchSystemAlert).not.toHaveBeenCalled()
  })

  it('does NOT alert when a teammate is handling the threads (AI quiet on purpose)', async () => {
    const r = await checkAiLiveness(
      fakeDb({
        aiConfigAccounts: ['a1'],
        usageAccounts: [],
        eligibleConvs: [
          { id: 'c1', account_id: 'a1' },
          { id: 'c2', account_id: 'a1' },
        ],
        msgCounts: { c1: 5, c2: 5 },
        staffConvs: ['c1'],
      }),
    )
    expect(r.deadAccounts).toEqual([])
    expect(h.dispatchSystemAlert).not.toHaveBeenCalled()
  })

  it('flags only the dead account when another account is healthy', async () => {
    const r = await checkAiLiveness(
      fakeDb({
        aiConfigAccounts: ['healthy', 'dead'],
        usageAccounts: ['healthy'],
        eligibleConvs: [
          { id: 'h1', account_id: 'healthy' },
          { id: 'h2', account_id: 'healthy' },
          { id: 'd1', account_id: 'dead' },
          { id: 'd2', account_id: 'dead' },
        ],
        msgCounts: { h1: 3, h2: 3, d1: 3, d2: 3 },
      }),
    )
    expect(r.deadAccounts).toEqual([{ accountId: 'dead', eligibleInbound: 6, conversations: 2 }])
    expect(h.dispatchSystemAlert).toHaveBeenCalledTimes(1)
  })
})
