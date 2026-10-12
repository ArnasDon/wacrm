import { beforeEach, describe, expect, it, vi } from 'vitest'

// ------------------------------------------------------------
// S2 mandatory scenario (3), app-layer half: an API key may only
// see its own account's rows. The machine-to-machine client is
// service-role (no RLS), so the route's one-line discipline —
// every query filters by ctx.accountId, which is pinned to the
// key's account at lookup time (proven in api-context.test.ts) —
// is the tenancy boundary. This suite asserts the discipline
// itself: a GET list for account A's key carries
// `.eq('account_id', 'acc-a')` and returns only A's rows; the
// same route with B's key carries B's filter and B's rows. If
// the account filter is ever dropped, the recorded-filter
// assertion below fails.
//
// Honest scope (this file's header, the S2 way): the supabase
// client is mocked, so this proves the ROUTE's query shape, not
// Postgres enforcement. The key-row binding that makes
// ctx.accountId trustworthy is proven separately (real store
// lookups in api-context.test.ts); the RLS proof lives in
// isolation.sql.
// ------------------------------------------------------------

const h = vi.hoisted(() => ({
  /** The account the mocked key context pins to for this run. */
  accountId: 'acc-a',
  /** The rows the mocked client returns for THAT account. */
  rows: [] as Array<{ created_at: string; id: string; phone: string }>,
  /** Filters the query builder actually received. */
  filters: [] as { col: string; val: string }[],
  selectSeen: '' as string,
}))

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      body,
      status: init?.status ?? 200,
    }),
  },
}))

vi.mock('@/lib/auth/api-context', () => ({
  requireApiKey: async (_request: Request, _scope: string) => ({
    authType: 'api_key',
    accountId: h.accountId,
    keyId: `key-${h.accountId}`,
    scopes: ['contacts:read'],
    supabase: {
      from: (table: string) => {
        if (table !== 'contacts') throw new Error('unexpected table: ' + table)
        // PostgREST-shaped chain: select -> eq -> order -> limit -> thenable.
        const chain: Record<string, unknown> = {
          select: (sel: string) => {
            h.selectSeen = String(sel)
            return chain
          },
          eq: (col: string, val: unknown) => {
            h.filters.push({ col, val: String(val) })
            return chain
          },
          order: () => chain,
          limit: () => chain,
          or: () => chain,
          then: ((
            onfulfilled?: ((v: unknown) => unknown) | null,
            _onrejected?: unknown,
          ) =>
            Promise.resolve({ data: h.rows, error: null }).then((v) =>
              onfulfilled ? onfulfilled(v) : v,
            )) as unknown as Record<string, unknown>['then'],
        }
        return chain
      },
    },
  }),
}))

import { GET } from './route'

const req = () => new Request('http://localhost/api/v1/contacts')

beforeEach(() => {
  h.accountId = 'acc-a'
  h.rows = [
    { created_at: '2026-01-02T00:00:00Z', id: 'row-a1', phone: '+15550000001' },
    { created_at: '2026-01-01T00:00:00Z', id: 'row-a2', phone: '+15550000002' },
  ]
  h.filters.length = 0
  h.selectSeen = ''
})

describe('v1/contacts cross-tenant query discipline (S4 scenario 3)', () => {
  it('account A\u2019s key: the list is filtered to acc-a and returns only A\u2019s rows', async () => {
    h.accountId = 'acc-a'
    const res = await GET(req())
    expect(res.status).toBe(200)

    const accountFilters = h.filters.filter((f) => f.col === 'account_id')
    expect(accountFilters.map((f) => f.val)).toEqual(['acc-a'])
    const body = res.body as unknown as {
      data: Array<{ id: string }>
      meta: { next_cursor: string | null }
    }
    expect(body.data.map((i) => i.id)).toEqual(['row-a1', 'row-a2'])
    expect(body.meta.next_cursor).toBeNull()
  })

  it('account B\u2019s key: the same route filters to acc-b — A\u2019s rows are unreachable', async () => {
    h.accountId = 'acc-b'
    h.rows = [{ created_at: '2026-01-03T00:00:00Z', id: 'row-b1', phone: '+15550000003' }]

    const res = await GET(req())
    expect(res.status).toBe(200)

    const accountFilters = h.filters.filter((f) => f.col === 'account_id')
    expect(accountFilters.map((f) => f.val)).toEqual(['acc-b'])
    expect(accountFilters.every((f) => f.val !== 'acc-a')).toBe(true)
    const body = res.body as unknown as {
      data: Array<{ id: string }>
      meta: { next_cursor: string | null }
    }
    expect(body.data.map((i) => i.id)).toEqual(['row-b1'])
  })

  it('regression guard: the account filter is present exactly once per list query', async () => {
    h.accountId = 'acc-a'
    await GET(req())
    expect(h.filters.filter((f) => f.col === 'account_id')).toHaveLength(1)
  })
})
