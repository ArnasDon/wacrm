import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Security tests for PATCH/DELETE /api/platform/accounts/[id]. Critical
// properties:
//   (a) a non platform-admin gets 403 on both methods.
//   (b) editing/removing a seller in Org A never touches Org B's data.
//   (c) the store's own account can never be unlinked/deleted through this
//       route (must go through the whole-organization delete instead).
//   (d) editing "name" updates accounts.name for a SELLER but NOT for the
//       store's own account (business name vs owner's personal name).
//   (e) a duplicate email is rejected clearly.
//   (f) every write records a platform_admin_audit_log row.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => ({
  isPlatformAdmin: true,
  accounts: [] as Record<string, unknown>[],
  organizations: [] as Record<string, unknown>[],
  profilesByUserId: {} as Record<string, Record<string, unknown>>,
  updateUserByIdError: null as { message: string } | null,
  accountUpdates: [] as { payload: Record<string, unknown>; filters: [string, unknown][] }[],
  profileUpdates: [] as { payload: Record<string, unknown>; filters: [string, unknown][] }[],
  deletedAccountIds: [] as string[],
  unlinkedAccountIds: [] as string[],
  deletedAuthUserIds: [] as string[],
  auditInserts: [] as Record<string, unknown>[],
}))

class FakeForbiddenError extends Error {
  readonly status = 403
}

vi.mock('@/lib/auth/platform', () => ({
  requirePlatformAdmin: async () => {
    if (!h.isPlatformAdmin) throw new FakeForbiddenError('Not a platform admin')
    return { supabase: {}, userId: 'user-admin-1' }
  },
}))

vi.mock('@/lib/auth/account', () => ({
  toErrorResponse: (err: unknown) => {
    if (err instanceof FakeForbiddenError) {
      return Response.json({ error: err.message }, { status: err.status })
    }
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  },
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      admin: {
        updateUserById: (uid: string, patch: Record<string, unknown>) => {
          if (h.updateUserByIdError) return Promise.resolve({ error: h.updateUserByIdError })
          return Promise.resolve({ data: { user: { id: uid, ...patch } }, error: null })
        },
        deleteUser: (uid: string) => {
          h.deletedAuthUserIds.push(uid)
          return Promise.resolve({ error: null })
        },
      },
    },
    from: (table: string) => {
      if (table === 'accounts') {
        return {
          select: () => ({
            eq: (_k: string, v: string) => ({
              maybeSingle: () => Promise.resolve({ data: h.accounts.find((a) => a.id === v) ?? null, error: null }),
            }),
          }),
          update: (payload: Record<string, unknown>) => ({
            eq: (k: string, v: unknown) => {
              h.accountUpdates.push({ payload, filters: [[k, v]] })
              const acc = h.accounts.find((a) => a.id === v)
              if (acc) Object.assign(acc, payload)
              if (payload.organization_id === null) h.unlinkedAccountIds.push(v as string)
              return Promise.resolve({ error: null })
            },
          }),
          delete: () => ({
            eq: (_k: string, v: string) => {
              h.deletedAccountIds.push(v)
              h.accounts = h.accounts.filter((a) => a.id !== v)
              return Promise.resolve({ error: null })
            },
          }),
        }
      }
      if (table === 'organizations') {
        return {
          select: () => ({
            eq: (_k: string, v: string) => ({
              maybeSingle: () =>
                Promise.resolve({ data: h.organizations.find((o) => o.id === v) ?? null, error: null }),
            }),
          }),
        }
      }
      if (table === 'profiles') {
        return {
          update: (payload: Record<string, unknown>) => ({
            eq: (k: string, v: unknown) => {
              h.profileUpdates.push({ payload, filters: [[k, v]] })
              return Promise.resolve({ error: null })
            },
          }),
        }
      }
      if (table === 'platform_admin_audit_log') {
        return {
          insert: (payload: Record<string, unknown>) => {
            h.auditInserts.push(payload)
            return Promise.resolve({ error: null })
          },
        }
      }
      throw new Error(`unexpected table in admin mock: ${table}`)
    },
  }),
}))

import { PATCH, DELETE } from './route'

function params(id: string) {
  return { params: Promise.resolve({ id }) }
}

function patchAccount(id: string, body: Record<string, unknown>) {
  return PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) }), params(id))
}

function deleteAccount(id: string, body: Record<string, unknown>) {
  return DELETE(new Request('http://x', { method: 'DELETE', body: JSON.stringify(body) }), params(id))
}

function resetState() {
  h.isPlatformAdmin = true
  h.organizations = [
    { id: 'org-a', name: 'Loja A', owner_account_id: 'acc-a-store' },
    { id: 'org-b', name: 'Loja B', owner_account_id: 'acc-b-store' },
  ]
  h.accounts = [
    { id: 'acc-a-store', name: 'Loja A', owner_user_id: 'user-a-store', organization_id: 'org-a' },
    { id: 'acc-a-seller-1', name: 'Vendedor A1', owner_user_id: 'user-a-seller-1', organization_id: 'org-a' },
    { id: 'acc-b-seller-1', name: 'Vendedor B1', owner_user_id: 'user-b-seller-1', organization_id: 'org-b' },
  ]
  h.profilesByUserId = {}
  h.updateUserByIdError = null
  h.accountUpdates = []
  h.profileUpdates = []
  h.deletedAccountIds = []
  h.unlinkedAccountIds = []
  h.deletedAuthUserIds = []
  h.auditInserts = []
}

describe('PATCH /api/platform/accounts/[id]', () => {
  beforeEach(resetState)

  it('rejects a non platform-admin with 403', async () => {
    h.isPlatformAdmin = false
    const res = await patchAccount('acc-a-seller-1', { name: 'Novo Nome' })
    expect(res.status).toBe(403)
  })

  it('returns 404 for an unknown account', async () => {
    const res = await patchAccount('acc-missing', { name: 'x' })
    expect(res.status).toBe(404)
  })

  it("updates a SELLER's name on both profiles.full_name AND accounts.name", async () => {
    const res = await patchAccount('acc-a-seller-1', { name: 'Vendedor A1 Renomeado' })
    expect(res.status).toBe(200)
    expect(h.profileUpdates[0]).toMatchObject({
      payload: { full_name: 'Vendedor A1 Renomeado' },
      filters: [['user_id', 'user-a-seller-1']],
    })
    expect(h.accountUpdates.some((u) => u.filters[0][1] === 'acc-a-seller-1' && u.payload.name === 'Vendedor A1 Renomeado')).toBe(true)
  })

  it("updates the STORE owner's name on profiles.full_name only — never accounts.name (that's the business name)", async () => {
    const res = await patchAccount('acc-a-store', { name: 'Novo Nome Do Dono' })
    expect(res.status).toBe(200)
    expect(h.profileUpdates[0]).toMatchObject({
      payload: { full_name: 'Novo Nome Do Dono' },
      filters: [['user_id', 'user-a-store']],
    })
    expect(h.accountUpdates.some((u) => u.filters[0][1] === 'acc-a-store')).toBe(false)
  })

  it('rejects an invalid email format before calling the Auth admin API', async () => {
    const res = await patchAccount('acc-a-seller-1', { email: 'not-an-email' })
    expect(res.status).toBe(400)
  })

  it('surfaces a clear 409 when the new email is already registered', async () => {
    h.updateUserByIdError = { message: 'A user with this email address has already been registered' }
    const res = await patchAccount('acc-a-seller-1', { email: 'existing@example.com' })
    expect(res.status).toBe(409)
    expect(h.profileUpdates).toHaveLength(0)
  })

  it('changes the login email via the Auth admin API and keeps profiles.email in sync', async () => {
    const res = await patchAccount('acc-a-seller-1', { email: 'novo@lojaa.com' })
    expect(res.status).toBe(200)
    expect(h.profileUpdates[0]).toMatchObject({ payload: { email: 'novo@lojaa.com' } })
  })

  it('never lets an edit on account A touch account B (different org)', async () => {
    await patchAccount('acc-a-seller-1', { name: 'Só A' })
    expect(h.accountUpdates.every((u) => u.filters[0][1] !== 'acc-b-seller-1')).toBe(true)
    expect(h.profileUpdates.every((u) => u.filters[0][1] !== 'user-b-seller-1')).toBe(true)
  })

  it('logs every successful edit to the audit log', async () => {
    await patchAccount('acc-a-seller-1', { name: 'x', phone: '11999999999' })
    expect(h.auditInserts).toHaveLength(1)
    expect(h.auditInserts[0]).toMatchObject({
      admin_user_id: 'user-admin-1',
      action: 'account.update',
      target_type: 'account',
      target_id: 'acc-a-seller-1',
    })
  })
})

describe('DELETE /api/platform/accounts/[id]', () => {
  beforeEach(resetState)

  it('rejects a non platform-admin with 403', async () => {
    h.isPlatformAdmin = false
    const res = await deleteAccount('acc-a-seller-1', { mode: 'unlink' })
    expect(res.status).toBe(403)
  })

  it("refuses to act on the store's own account — points at the organization-delete route instead", async () => {
    const res = await deleteAccount('acc-a-store', { mode: 'delete' })
    expect(res.status).toBe(400)
    expect(h.deletedAccountIds).toHaveLength(0)
    expect(h.unlinkedAccountIds).toHaveLength(0)
  })

  it('rejects a missing/invalid mode', async () => {
    const res = await deleteAccount('acc-a-seller-1', {})
    expect(res.status).toBe(400)
  })

  it('unlinks a seller — clears organization_id, keeps the account row intact', async () => {
    const res = await deleteAccount('acc-a-seller-1', { mode: 'unlink' })
    expect(res.status).toBe(200)
    expect(h.unlinkedAccountIds).toEqual(['acc-a-seller-1'])
    expect(h.deletedAccountIds).toHaveLength(0)
    expect(h.deletedAuthUserIds).toHaveLength(0)
    // Account row still exists, just detached.
    expect(h.accounts.find((a) => a.id === 'acc-a-seller-1')).toBeDefined()
  })

  it('permanently deletes a seller account and its auth user, never touching Org B', async () => {
    const res = await deleteAccount('acc-a-seller-1', { mode: 'delete' })
    expect(res.status).toBe(200)
    expect(h.deletedAccountIds).toEqual(['acc-a-seller-1'])
    expect(h.deletedAuthUserIds).toEqual(['user-a-seller-1'])
    // Org B's seller is completely unaffected.
    expect(h.accounts.find((a) => a.id === 'acc-b-seller-1')).toBeDefined()
    expect(h.deletedAuthUserIds).not.toContain('user-b-seller-1')
  })

  it('logs unlink and delete actions to the audit log', async () => {
    await deleteAccount('acc-a-seller-1', { mode: 'unlink' })
    expect(h.auditInserts[0]).toMatchObject({ action: 'account.unlink', target_id: 'acc-a-seller-1' })
  })
})
