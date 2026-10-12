import { beforeEach, describe, expect, it, vi } from 'vitest'

// ------------------------------------------------------------
// S2 mandatory scenario (e): an identifier that is well-formed but
// belongs to another account must touch nothing. These handlers
// mutate through the service-role client, which bypasses RLS, so the
// route's own guard (requireOwnership: an RLS-scoped read that returns
// null for a foreign row) is the whole tenancy boundary. The
// negative control here: a foreign id answers 404 and the service-role
// client is never reached — no write can land in the other account.
// The positive control: the same verbs on an own-account row succeed
// exactly once.
// ------------------------------------------------------------

const FLOW_ID = 'f0000000-0000-4000-8000-000000000001'

const h = vi.hoisted(() => ({
  /** Row the RLS-scoped ownership read resolves (null = foreign row). */
  flowsRow: null as { id: string } | null,
  updates: [] as { table: string; patch: Record<string, unknown> }[],
  deletes: [] as string[],
}))

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      body,
      status: init?.status ?? 200,
    }),
  },
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'user-a' } }, error: null }),
    },
    from: (table: string) => ({
      select: () => ({
        eq: (col: string, val: unknown) => ({
          maybeSingle: async () =>
            // RLS semantics: a flow owned by another account is invisible.
            table === 'flows' && col === 'id' && val === FLOW_ID
              ? { data: h.flowsRow, error: null }
              : { data: null, error: null },
        }),
      }),
    }),
  }),
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: vi.fn(
    async () => ({ userId: 'user-a', accountId: 'acc-a', role: 'agent' }),
  ),
  getCurrentAccount: vi.fn(async () => ({
    userId: 'user-a',
    accountId: 'acc-a',
    role: 'agent',
  })),
  toErrorResponse: (e: unknown) => ({
    body: { error: e instanceof Error ? e.message : String(e) },
    status: 403,
  }),
}))

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => ({
      update: (patch: Record<string, unknown>) => ({
        eq: async () => {
          h.updates.push({ table, patch })
          return { error: null }
        },
      }),
      delete: () => ({
        eq: async () => {
          h.deletes.push(table)
          return { error: null }
        },
      }),
      insert: () => ({
        select: () => ({
          single: async () => ({ data: null, error: null }),
        }),
      }),
      select: () => ({
        // The PUT handler tails with
        // `.select('*').eq('flow_id', id).order(...)` awaited as a
        // thenable (PostgREST shape) — order() resolves to a row list.
        eq: () => ({
          order: () =>
            Promise.resolve({ data: [], error: null }),
          maybeSingle: async () => ({ data: null, error: null }),
        }),
        maybeSingle: async () => ({ data: null, error: null }),
      }),
    }),
  }),
}))

vi.mock('@/lib/i18n/translate', () => ({
  getT: () => (key: string) => key,
}))

import { PUT, DELETE } from './route'

const putReq = () =>
  new Request('http://localhost/api/flows/' + FLOW_ID, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Renamed flow' }),
  })
const delReq = () =>
  new Request('http://localhost/api/flows/' + FLOW_ID, { method: 'DELETE' })
const context = { params: Promise.resolve({ id: FLOW_ID }) }

beforeEach(() => {
  h.flowsRow = null
  h.updates.length = 0
  h.deletes.length = 0
})

describe('flows/[id] tenancy gate (S4 scenario e: foreign ids touch nothing)', () => {
  it('PUT on a foreign flow id answers 404 and never reaches the service-role client', async () => {
    h.flowsRow = null // RLS-scoped read: invisible to the caller
    const res = await PUT(putReq(), context)
    expect(res.status).toBe(404)
    expect(h.updates).toHaveLength(0)
    expect(h.deletes).toHaveLength(0)
  })

  it('DELETE on a foreign flow id answers 404 and never reaches the service-role client', async () => {
    h.flowsRow = null
    const res = await DELETE(delReq(), context)
    expect(res.status).toBe(404)
    expect(h.updates).toHaveLength(0)
    expect(h.deletes).toHaveLength(0)
  })

  it('positive control: PUT on the caller\u2019s own flow lands exactly one update', async () => {
    h.flowsRow = { id: FLOW_ID }
    const res = await PUT(putReq(), context)
    expect(res.status).toBe(200)
    expect(h.updates).toHaveLength(1)
    expect(h.updates[0]).toEqual({
      table: 'flows',
      patch: expect.objectContaining({ name: 'Renamed flow' }),
    })
    expect(h.deletes).toHaveLength(0)
  })

  it('positive control: DELETE on the caller\u2019s own flow lands exactly one delete', async () => {
    h.flowsRow = { id: FLOW_ID }
    const res = await DELETE(delReq(), context)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
    expect(h.deletes).toEqual(['flows'])
    expect(h.updates).toHaveLength(0)
  })
})
