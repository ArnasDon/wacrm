import { describe, it, expect, vi, beforeEach } from 'vitest'

// ============================================================
// PATCH/DELETE /api/ai/business-profile/contacts/[id] — first test file
// for this route. Focused on Punto 9, H9-1: the same linked_user_id
// membership guard as the create route (route.test.ts), exercised here
// against UPDATE specifically — including that explicit `null` (the
// existing, legitimate "unlink" behavior) is left untouched.
// ============================================================

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn((err: unknown) => Response.json({ error: String(err) }, { status: 500 })),
}))

import { PATCH } from './route'

function fakeSupabase() {
  const tables = new Map<string, Record<string, unknown>[]>()
  const table = (name: string) => tables.get(name) ?? tables.set(name, []).get(name)!

  function builder(tableName: string, op: 'select' | 'update', payload?: Record<string, unknown>) {
    const filters: [string, unknown][] = []
    const rows = table(tableName)
    const matches = (row: Record<string, unknown>) => filters.every(([c, v]) => row[c] === v)

    function run() {
      const matched = rows.filter(matches)
      if (op === 'update') {
        for (const row of matched) Object.assign(row, payload)
      }
      return { data: matched[0] ?? null, error: null }
    }

    const api = {
      select: () => api,
      eq: (col: string, val: unknown) => {
        filters.push([col, val])
        return api
      },
      single: () => Promise.resolve(run()),
      maybeSingle: () => Promise.resolve(run()),
    }
    return api
  }

  return {
    supabase: {
      from: (name: string) => ({
        select: () => builder(name, 'select'),
        update: (payload: Record<string, unknown>) => builder(name, 'update', payload),
      }),
    } as never,
    table,
  }
}

function patchRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/ai/business-profile/contacts/c1', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

function seedContact(table: (name: string) => Record<string, unknown>[], overrides: Record<string, unknown> = {}) {
  table('account_business_contacts').push({
    id: 'c1', account_id: 'acct-1', name: 'Carlos Pérez', department_id: null, role_title: null,
    phone: null, whatsapp: null, email: null, notes: null, active: true, sort_order: 100,
    linked_user_id: null, created_at: 't', updated_at: 't',
    ...overrides,
  })
}

const PARAMS = { params: Promise.resolve({ id: 'c1' }) }

beforeEach(() => {
  mocks.requireRole.mockReset()
})

describe('PATCH /api/ai/business-profile/contacts/[id] — Punto 9, H9-1', () => {
  it('3. updates linked_user_id to a member of the caller\'s account — SUCCESS', async () => {
    const { supabase, table } = fakeSupabase()
    seedContact(table)
    table('profiles').push({ account_id: 'acct-1', user_id: 'user-1' })
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'admin-1' })

    const res = await PATCH(patchRequest({ linked_user_id: 'user-1' }), PARAMS)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { contact: { linkedUserId: string | null } }
    expect(body.contact.linkedUserId).toBe('user-1')
  })

  it('4. rejects updating linked_user_id to a user from a DIFFERENT account — REJECT, existing row untouched', async () => {
    const { supabase, table } = fakeSupabase()
    seedContact(table)
    table('profiles').push({ account_id: 'acct-2', user_id: 'user-1' })
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'admin-1' })

    const res = await PATCH(patchRequest({ linked_user_id: 'user-1' }), PARAMS)
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('linked_user_id must be a member of this account')
    expect(table('account_business_contacts')[0].linked_user_id).toBeNull() // untouched
  })

  it('5. explicit linked_user_id: null clears it — SUCCESS, no membership check performed', async () => {
    const { supabase, table } = fakeSupabase()
    seedContact(table, { linked_user_id: 'user-1' })
    // No 'profiles' row seeded at all — proves clearing never queries it.
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'admin-1' })

    const res = await PATCH(patchRequest({ linked_user_id: null }), PARAMS)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { contact: { linkedUserId: string | null } }
    expect(body.contact.linkedUserId).toBeNull()
  })

  it('omitting linked_user_id entirely leaves the existing value unchanged', async () => {
    const { supabase, table } = fakeSupabase()
    seedContact(table, { linked_user_id: 'user-1' })
    table('profiles').push({ account_id: 'acct-1', user_id: 'user-1' })
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'admin-1' })

    const res = await PATCH(patchRequest({ name: 'Carlos P.' }), PARAMS)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { contact: { linkedUserId: string | null; name: string } }
    expect(body.contact.linkedUserId).toBe('user-1')
    expect(body.contact.name).toBe('Carlos P.')
  })
})
