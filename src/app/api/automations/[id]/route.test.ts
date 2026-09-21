import { describe, it, expect, vi, beforeEach } from 'vitest'

// ------------------------------------------------------------
// Regression coverage for GHSA-xvrq-88hg-44q6.
//
// The per-automation handlers mutate through the service-role client,
// so tenancy is theirs to enforce. They used to match the row on
// `automations.user_id` (the immutable author), which a user removed
// from the account still satisfies — `remove_account_member` reseats
// them as `owner` of a fresh personal account, so `requireRole('agent')`
// passes and the account is never compared.
//
// The scenario below is exactly that: caller is an owner of `acc-new`,
// the automation lives in `acc-old`, and `user_id` still matches them.
// Every handler must answer 404 and touch nothing.
// ------------------------------------------------------------

const h = vi.hoisted(() => ({
  state: {
    /** The one automation row the fake DB holds. */
    row: {
      id: 'auto-1',
      account_id: 'acc-old',
      user_id: 'user-removed',
      name: 'Old account automation',
      description: null as string | null,
      is_active: false,
      trigger_type: 'keyword_match',
      trigger_config: { keywords: ['hi'] },
    } as Record<string, unknown>,
    /** Account the mocked `requireRole` / `getCurrentAccount` resolve. */
    callerAccountId: 'acc-new',
    callerUserId: 'user-removed',
    /** Writes the fake DB accepted, by table + operation. */
    writes: [] as { table: string; op: string; filters: [string, unknown][] }[],
  },
}))

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      body,
      status: init?.status ?? 200,
    }),
  },
}))

// The handlers no longer reach for the cookie-scoped SSR client, but
// keep it mocked: without this the pre-patch code under test would fail
// on `next/headers` instead of on the tenancy assertion, which would
// make this file useless as a regression test.
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: h.state.callerUserId } },
        error: null,
      }),
    },
  }),
}))

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: async () => ({
    accountId: h.state.callerAccountId,
    userId: h.state.callerUserId,
    role: 'owner',
  }),
  requireRole: async () => ({
    accountId: h.state.callerAccountId,
    userId: h.state.callerUserId,
    role: 'owner',
  }),
  toErrorResponse: (err: unknown) => ({
    body: { error: err instanceof Error ? err.message : 'error' },
    status: 403,
  }),
}))

vi.mock('@/lib/automations/steps-tree', () => ({
  loadStepsTree: async () => [],
  replaceSteps: async () => null,
  insertSteps: async () => null,
}))

/**
 * Minimal PostgREST-shaped stub: `.eq()` accumulates filters, and a
 * terminal call only sees the row when every filter matches it. That
 * makes the fake enforce the same predicate the real database would,
 * so a handler that forgets `account_id` genuinely reads the foreign
 * row instead of the test having to assert on call shapes.
 */
function chain(table: string, op: string) {
  const filters: [string, unknown][] = []
  const matches = () =>
    filters.every(([col, val]) => h.state.row[col] === val)
  const api = {
    eq(col: string, val: unknown) {
      filters.push([col, val])
      return api
    },
    maybeSingle: async () => ({
      data: matches() ? h.state.row : null,
      error: null,
    }),
    single: async () => ({
      data: matches() ? h.state.row : null,
      error: matches() ? null : { message: 'no rows' },
    }),
    select: () => api,
    order: () => api,
    then(resolve: (v: { data: unknown; error: null }) => unknown) {
      // Terminal `await` on an update/delete with no .select().
      if (op !== 'select' && matches()) {
        h.state.writes.push({ table, op, filters: [...filters] })
      }
      return Promise.resolve({ data: null, error: null }).then(resolve)
    },
  }
  return api
}

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => ({
      select: () => chain(table, 'select'),
      update: () => chain(table, 'update'),
      delete: () => chain(table, 'delete'),
      insert: (row: Record<string, unknown>) => {
        h.state.writes.push({
          table,
          op: 'insert',
          filters: Object.entries(row),
        })
        return {
          select: () => ({
            single: async () => ({
              data: { ...row, id: 'auto-copy' },
              error: null,
            }),
          }),
        }
      },
    }),
  }),
}))

import { GET, PATCH, DELETE } from './route'
import { POST as DUPLICATE } from './duplicate/route'

const params = Promise.resolve({ id: 'auto-1' })

beforeEach(() => {
  h.state.writes = []
  h.state.callerAccountId = 'acc-new'
})

describe('automations/[id] tenancy (GHSA-xvrq-88hg-44q6)', () => {
  it('refuses a removed member who still matches user_id', async () => {
    const get = (await GET(new Request('http://t/'), { params })) as unknown as {
      status: number
    }
    expect(get.status).toBe(404)

    const patch = (await PATCH(
      new Request('http://t/', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'pwned' }),
      }),
      { params },
    )) as unknown as { status: number }
    expect(patch.status).toBe(404)

    const del = (await DELETE(new Request('http://t/'), {
      params,
    })) as unknown as { status: number }
    expect(del.status).toBe(200) // scoped DELETE is a no-op, not an error

    const dup = (await DUPLICATE(new Request('http://t/', { method: 'POST' }), {
      params,
    })) as unknown as { status: number }
    expect(dup.status).toBe(404)

    // Nothing was written into the account the caller left.
    expect(h.state.writes).toEqual([])
  })

  it('still serves a member of the automation own account', async () => {
    h.state.callerAccountId = 'acc-old'

    const get = (await GET(new Request('http://t/'), { params })) as unknown as {
      status: number
      body: { automation: { id: string } }
    }
    expect(get.status).toBe(200)
    expect(get.body.automation.id).toBe('auto-1')

    const patch = (await PATCH(
      new Request('http://t/', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'renamed' }),
      }),
      { params },
    )) as unknown as { status: number }
    expect(patch.status).toBe(200)

    const dup = (await DUPLICATE(new Request('http://t/', { method: 'POST' }), {
      params,
    })) as unknown as { status: number }
    expect(dup.status).toBe(201)
  })

  it('clones into the caller account, never the row stored account', async () => {
    h.state.callerAccountId = 'acc-old'
    await DUPLICATE(new Request('http://t/', { method: 'POST' }), { params })
    const insert = h.state.writes.find(
      (w) => w.table === 'automations' && w.op === 'insert',
    )
    expect(insert).toBeDefined()
    expect(insert!.filters).toContainEqual(['account_id', 'acc-old'])
  })
})
