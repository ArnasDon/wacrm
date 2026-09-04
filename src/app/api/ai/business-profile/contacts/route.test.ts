import { describe, it, expect, vi, beforeEach } from 'vitest'

// ============================================================
// GET/POST /api/ai/business-profile/contacts — first test file for this
// route. Focused on Punto 9, H9-1: `linked_user_id` must be a member of
// the caller's own account before it's accepted (see
// business-profile/service.ts::isAccountMember). Uses the real route
// handlers + the real service.ts (never mocked) against a minimal fake
// Supabase table, mirroring the generic in-memory fake already
// established in business-profile/service.test.ts and
// api/ai/config/route.test.ts.
// ============================================================

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn((err: unknown) => Response.json({ error: String(err) }, { status: 500 })),
}))

import { GET, POST } from './route'

function fakeSupabase() {
  const tables = new Map<string, Record<string, unknown>[]>()
  let nextId = 1
  const table = (name: string) => tables.get(name) ?? tables.set(name, []).get(name)!

  function builder(tableName: string, op: 'select' | 'insert', payload?: unknown) {
    const filters: [string, unknown][] = []
    const rows = table(tableName)
    const matches = (row: Record<string, unknown>) => filters.every(([c, v]) => row[c] === v)

    function run(single: boolean) {
      if (op === 'select') {
        const matched = rows.filter(matches)
        return { data: single ? (matched[0] ?? null) : matched, error: null }
      }
      if (op === 'insert') {
        const inserted = { id: `${tableName}-${nextId++}`, ...(payload as Record<string, unknown>) }
        rows.push(inserted)
        return { data: single ? inserted : [inserted], error: null }
      }
      return { data: null, error: null }
    }

    const api = {
      select: () => api,
      eq: (col: string, val: unknown) => {
        filters.push([col, val])
        return api
      },
      order: () => api,
      single: () => Promise.resolve(run(true)),
      maybeSingle: () => Promise.resolve(run(true)),
      then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
        Promise.resolve(run(false)).then(resolve, reject),
    }
    return api
  }

  return {
    supabase: {
      from: (name: string) => ({
        select: () => builder(name, 'select'),
        insert: (payload: Record<string, unknown>) => builder(name, 'insert', payload),
      }),
    } as never,
    table,
  }
}

function postRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/ai/business-profile/contacts', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  mocks.requireRole.mockReset()
})

describe('GET /api/ai/business-profile/contacts', () => {
  it('lists contacts for the caller\'s account', async () => {
    const { supabase, table } = fakeSupabase()
    table('account_business_contacts').push({
      id: 'c1', account_id: 'acct-1', name: 'Carlos Pérez', department_id: null, role_title: null,
      phone: null, whatsapp: null, email: null, notes: null, active: true, sort_order: 100,
      linked_user_id: null, created_at: 't', updated_at: 't',
    })
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' })

    const res = await GET()
    const body = (await res.json()) as { contacts: { name: string }[] }
    expect(body.contacts).toHaveLength(1)
    expect(body.contacts[0].name).toBe('Carlos Pérez')
  })
})

describe('POST /api/ai/business-profile/contacts — Punto 9, H9-1', () => {
  it('creates a contact with no linked_user_id (the existing, legitimate default)', async () => {
    const { supabase } = fakeSupabase()
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' })

    const res = await POST(postRequest({ name: 'Carlos Pérez' }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { contact: { linkedUserId: string | null } }
    expect(body.contact.linkedUserId).toBeNull()
  })

  it('1. creates a contact whose linked_user_id IS a member of the caller\'s account — SUCCESS', async () => {
    const { supabase, table } = fakeSupabase()
    table('profiles').push({ account_id: 'acct-1', user_id: 'user-1' })
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'admin-1' })

    const res = await POST(postRequest({ name: 'Carlos Pérez', linked_user_id: 'user-1' }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { contact: { linkedUserId: string | null } }
    expect(body.contact.linkedUserId).toBe('user-1')
  })

  it('2. rejects a linked_user_id that belongs to a DIFFERENT account — REJECT', async () => {
    const { supabase, table } = fakeSupabase()
    // 'user-1' is a real profile, but of acct-2 — not the caller's acct-1.
    table('profiles').push({ account_id: 'acct-2', user_id: 'user-1' })
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'admin-1' })

    const res = await POST(postRequest({ name: 'Carlos Pérez', linked_user_id: 'user-1' }))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('linked_user_id must be a member of this account')
    expect(table('account_business_contacts')).toHaveLength(0) // never persisted
  })

  it('rejects a linked_user_id with no matching profile at all', async () => {
    const { supabase } = fakeSupabase()
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'admin-1' })

    const res = await POST(postRequest({ name: 'Carlos Pérez', linked_user_id: 'ghost-user' }))
    expect(res.status).toBe(400)
  })
})
