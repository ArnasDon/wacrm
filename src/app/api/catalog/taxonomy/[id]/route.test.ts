import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ requireRole: vi.fn() }))

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn((error: unknown) =>
    Response.json({ error: error instanceof Error ? error.message : 'error' }, { status: 500 }),
  ),
}))

import { DELETE, PATCH } from './route'

function fakeSupabase() {
  const calls: { table: string; op: string; payload?: unknown; eq: Array<[string, unknown]> }[] = []
  return {
    calls,
    from: (table: string) => {
      const eqCalls: Array<[string, unknown]> = []
      const chain = {
        update: (payload: unknown) => {
          calls.push({ table, op: 'update', payload, eq: eqCalls })
          return chain
        },
        delete: () => {
          calls.push({ table, op: 'delete', eq: eqCalls })
          return chain
        },
        eq: (column: string, value: unknown) => {
          eqCalls.push([column, value])
          return chain
        },
        select: () => chain,
        single: () =>
          Promise.resolve({
            data: { id: 'term-1', kind: 'category', canonical_value: 'SUV', aliases: [], enabled: true },
            error: null,
          }),
        then: (resolve: (result: { error: null }) => unknown) => resolve({ error: null }),
      }
      return chain
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PATCH/DELETE /api/catalog/taxonomy/[id] — tenant scoping', () => {
  it('always scopes the update by the caller own account_id, never a client-supplied one', async () => {
    const supabase = fakeSupabase()
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'car-rental-account' })

    await PATCH(
      new Request('https://crm.test/api/catalog/taxonomy/term-1', {
        method: 'PATCH',
        body: JSON.stringify({ canonical_value: 'SUV', aliases: ['jipe'], account_id: 'lc-account' }),
      }),
      { params: Promise.resolve({ id: 'term-1' }) },
    )

    const update = supabase.calls.find((c) => c.op === 'update')
    expect(update?.eq).toContainEqual(['account_id', 'car-rental-account'])
    expect(update?.eq).not.toContainEqual(['account_id', 'lc-account'])
  })

  it('scopes delete by the caller own account_id too', async () => {
    const supabase = fakeSupabase()
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'lc-account' })

    const response = await DELETE(new Request('https://crm.test/api/catalog/taxonomy/term-1', { method: 'DELETE' }), {
      params: Promise.resolve({ id: 'term-1' }),
    })

    expect(response.status).toBe(200)
    const del = supabase.calls.find((c) => c.op === 'delete')
    expect(del?.eq).toContainEqual(['account_id', 'lc-account'])
  })
})
