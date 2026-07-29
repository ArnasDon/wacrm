import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Security + isolation tests for GET/PATCH/DELETE /api/platform/organizations/[id]
// — the store-detail page's backing route, and the single most destructive
// endpoint in the app (DELETE). Critical properties:
//   (a) a non platform-admin gets 403 on every method.
//   (b) acting on Org A never touches Org B's accounts or data.
//   (c) DELETE refuses without an EXACT confirmName match.
//   (d) DELETE atomically removes every linked account via one statement,
//       then best-effort deletes each owner's auth.users row.
//   (e) every write records a platform_admin_audit_log row.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => ({
  isPlatformAdmin: true,
  organizations: [] as Record<string, unknown>[],
  accounts: [] as Record<string, unknown>[],
  profilesByUserId: {} as Record<string, { full_name: string; email: string; phone: string | null }>,
  lastSignInByUserId: {} as Record<string, string | null>,
  orgUpdates: [] as { payload: Record<string, unknown>; filters: [string, unknown][] }[],
  accountUpdates: [] as { payload: Record<string, unknown>; filters: [string, unknown][] }[],
  deletedAccountsCall: null as { filters: [string, unknown][] } | null,
  deletedOrgIds: [] as string[],
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
        getUserById: (uid: string) =>
          Promise.resolve({
            data: { user: { last_sign_in_at: h.lastSignInByUserId[uid] ?? null } },
            error: null,
          }),
        deleteUser: (uid: string) => {
          h.deletedAuthUserIds.push(uid)
          return Promise.resolve({ error: null })
        },
      },
    },
    from: (table: string) => {
      if (table === 'organizations') {
        return {
          select: () => ({
            eq: (_k: string, v: string) => ({
              maybeSingle: () =>
                Promise.resolve({ data: h.organizations.find((o) => o.id === v) ?? null, error: null }),
            }),
          }),
          update: (payload: Record<string, unknown>) => ({
            eq: (k: string, v: unknown) => {
              h.orgUpdates.push({ payload, filters: [[k, v]] })
              const org = h.organizations.find((o) => o.id === v)
              if (org) Object.assign(org, payload)
              return {
                select: () => ({
                  maybeSingle: () => Promise.resolve({ data: org ?? null, error: null }),
                }),
              }
            },
          }),
          delete: () => ({
            eq: (_k: string, v: string) => {
              h.deletedOrgIds.push(v)
              h.organizations = h.organizations.filter((o) => o.id !== v)
              return Promise.resolve({ error: null })
            },
          }),
        }
      }
      if (table === 'accounts') {
        return {
          select: () => ({
            eq: (_k: string, v: string) => ({
              order: () =>
                Promise.resolve({
                  data: h.accounts.filter((a) => a.organization_id === v),
                  error: null,
                }),
            }),
          }),
          update: (payload: Record<string, unknown>) => ({
            eq: (k: string, v: unknown) => {
              h.accountUpdates.push({ payload, filters: [[k, v]] })
              return Promise.resolve({ error: null })
            },
          }),
          delete: () => ({
            eq: (k: string, v: string) => {
              h.deletedAccountsCall = { filters: [[k, v]] }
              const matched = h.accounts.filter((a) => a.organization_id === v)
              h.accounts = h.accounts.filter((a) => a.organization_id !== v)
              return {
                select: () =>
                  Promise.resolve({
                    data: matched.map((a) => ({ id: a.id, owner_user_id: a.owner_user_id })),
                    error: null,
                  }),
              }
            },
          }),
        }
      }
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: (_k: string, v: string) => ({
              maybeSingle: () => Promise.resolve({ data: h.profilesByUserId[v] ?? null, error: null }),
            }),
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

import { GET, PATCH, DELETE } from './route'

function params(id: string) {
  return { params: Promise.resolve({ id }) }
}

function resetState() {
  h.isPlatformAdmin = true
  h.organizations = [
    { id: 'org-a', name: 'Loja A', status: 'active', billing_status: 'trial', created_at: '2026-01-01T00:00:00Z', owner_account_id: 'acc-a-store' },
    { id: 'org-b', name: 'Loja B', status: 'active', billing_status: 'trial', created_at: '2026-02-01T00:00:00Z', owner_account_id: 'acc-b-store' },
  ]
  h.accounts = [
    { id: 'acc-a-store', name: 'Loja A', owner_user_id: 'user-a-store', organization_id: 'org-a', created_at: '2026-01-01T00:00:00Z' },
    { id: 'acc-a-seller-1', name: 'Vendedor A1', owner_user_id: 'user-a-seller-1', organization_id: 'org-a', created_at: '2026-01-02T00:00:00Z' },
    { id: 'acc-b-store', name: 'Loja B', owner_user_id: 'user-b-store', organization_id: 'org-b', created_at: '2026-02-01T00:00:00Z' },
    { id: 'acc-b-seller-1', name: 'Vendedor B1', owner_user_id: 'user-b-seller-1', organization_id: 'org-b', created_at: '2026-02-02T00:00:00Z' },
  ]
  h.profilesByUserId = {
    'user-a-store': { full_name: 'Dona da Loja A', email: 'dona@lojaa.com', phone: null },
    'user-a-seller-1': { full_name: 'Vendedor A1', email: 'vendedor1@lojaa.com', phone: null },
    'user-b-store': { full_name: 'Dono da Loja B', email: 'dono@lojab.com', phone: null },
    'user-b-seller-1': { full_name: 'Vendedor B1', email: 'vendedor1@lojab.com', phone: null },
  }
  h.lastSignInByUserId = { 'user-a-store': '2026-01-01T01:00:00Z' }
  h.orgUpdates = []
  h.accountUpdates = []
  h.deletedAccountsCall = null
  h.deletedOrgIds = []
  h.deletedAuthUserIds = []
  h.auditInserts = []
}

describe('GET /api/platform/organizations/[id]', () => {
  beforeEach(resetState)

  it('rejects a non platform-admin with 403', async () => {
    h.isPlatformAdmin = false
    const res = await GET(new Request('http://x'), params('org-a'))
    expect(res.status).toBe(403)
  })

  it('returns 404 for an unknown organization', async () => {
    const res = await GET(new Request('http://x'), params('org-missing'))
    expect(res.status).toBe(404)
  })

  it("hydrates the owner and sellers for Org A without leaking Org B's accounts", async () => {
    const res = await GET(new Request('http://x'), params('org-a'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.organization).toMatchObject({ id: 'org-a', name: 'Loja A', billingStatus: 'trial' })
    expect(json.owner).toMatchObject({
      accountId: 'acc-a-store',
      name: 'Dona da Loja A',
      email: 'dona@lojaa.com',
      inviteStatus: 'accepted',
    })
    expect(json.sellers).toHaveLength(1)
    expect(json.sellers[0]).toMatchObject({
      accountId: 'acc-a-seller-1',
      name: 'Vendedor A1',
      inviteStatus: 'pending',
    })
    // Isolation: nothing from Org B anywhere in the response.
    const serialized = JSON.stringify(json)
    expect(serialized).not.toContain('Loja B')
    expect(serialized).not.toContain('lojab.com')
  })
})

describe('PATCH /api/platform/organizations/[id]', () => {
  beforeEach(resetState)

  it('rejects a non platform-admin with 403', async () => {
    h.isPlatformAdmin = false
    const res = await PATCH(
      new Request('http://x', { method: 'PATCH', body: JSON.stringify({ name: 'Nova Loja A' }) }),
      params('org-a'),
    )
    expect(res.status).toBe(403)
  })

  it('renames the organization AND its store account together, and only Org A', async () => {
    const res = await PATCH(
      new Request('http://x', { method: 'PATCH', body: JSON.stringify({ name: 'Loja A Renomeada' }) }),
      params('org-a'),
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.organization.name).toBe('Loja A Renomeada')
    expect(h.orgUpdates[0]).toMatchObject({ payload: { name: 'Loja A Renomeada' }, filters: [['id', 'org-a']] })
    expect(h.accountUpdates[0]).toMatchObject({
      payload: { name: 'Loja A Renomeada' },
      filters: [['id', 'acc-a-store']],
    })
    // Org B's own account is never touched.
    expect(h.accountUpdates.some((u) => u.filters[0][1] === 'acc-b-store')).toBe(false)

    expect(h.auditInserts).toHaveLength(1)
    expect(h.auditInserts[0]).toMatchObject({
      admin_user_id: 'user-admin-1',
      action: 'organization.update',
      target_type: 'organization',
      target_id: 'org-a',
    })
  })

  it('rejects an empty name', async () => {
    const res = await PATCH(
      new Request('http://x', { method: 'PATCH', body: JSON.stringify({ name: '' }) }),
      params('org-a'),
    )
    expect(res.status).toBe(400)
    expect(h.orgUpdates).toHaveLength(0)
  })
})

describe('DELETE /api/platform/organizations/[id]', () => {
  beforeEach(resetState)

  it('rejects a non platform-admin with 403', async () => {
    h.isPlatformAdmin = false
    const res = await DELETE(
      new Request('http://x', { method: 'DELETE', body: JSON.stringify({ confirmName: 'Loja A' }) }),
      params('org-a'),
    )
    expect(res.status).toBe(403)
  })

  it('refuses to delete without an exact confirmName match', async () => {
    const res = await DELETE(
      new Request('http://x', { method: 'DELETE', body: JSON.stringify({ confirmName: 'loja a' }) }),
      params('org-a'),
    )
    expect(res.status).toBe(400)
    expect(h.deletedAccountsCall).toBeNull()
    expect(h.accounts).toHaveLength(4) // nothing deleted
  })

  it('refuses to delete with no confirmName at all', async () => {
    const res = await DELETE(new Request('http://x', { method: 'DELETE', body: JSON.stringify({}) }), params('org-a'))
    expect(res.status).toBe(400)
    expect(h.deletedAccountsCall).toBeNull()
  })

  it('deletes every account linked to Org A, in one call scoped to org-a, and never touches Org B', async () => {
    const res = await DELETE(
      new Request('http://x', { method: 'DELETE', body: JSON.stringify({ confirmName: 'Loja A' }) }),
      params('org-a'),
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.deleted).toBe(true)
    expect(json.deletedAccountCount).toBe(2)

    // The single delete call was scoped to org-a's organization_id only.
    expect(h.deletedAccountsCall).toEqual({ filters: [['organization_id', 'org-a']] })

    // Org A's accounts are gone; Org B's are completely untouched.
    const remainingIds = h.accounts.map((a) => a.id)
    expect(remainingIds).not.toContain('acc-a-store')
    expect(remainingIds).not.toContain('acc-a-seller-1')
    expect(remainingIds).toContain('acc-b-store')
    expect(remainingIds).toContain('acc-b-seller-1')

    // Both owners' auth.users rows were deleted.
    expect(h.deletedAuthUserIds.sort()).toEqual(['user-a-seller-1', 'user-a-store'].sort())
    // Org B's owners were never touched.
    expect(h.deletedAuthUserIds).not.toContain('user-b-store')

    // Org A's own row is gone; Org B's organization is untouched.
    expect(h.organizations.find((o) => o.id === 'org-a')).toBeUndefined()
    expect(h.organizations.find((o) => o.id === 'org-b')).toBeDefined()

    expect(h.auditInserts).toHaveLength(1)
    expect(h.auditInserts[0]).toMatchObject({
      admin_user_id: 'user-admin-1',
      action: 'organization.delete',
      target_type: 'organization',
      target_id: 'org-a',
    })
    expect((h.auditInserts[0].metadata as Record<string, unknown>).deletedAccountCount).toBe(2)
  })

  it('returns 404 for an unknown organization', async () => {
    const res = await DELETE(
      new Request('http://x', { method: 'DELETE', body: JSON.stringify({ confirmName: 'x' }) }),
      params('org-missing'),
    )
    expect(res.status).toBe(404)
  })
})
