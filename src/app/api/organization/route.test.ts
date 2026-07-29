import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Authorization + query-shape tests for GET/POST /api/organization.
//
// The critical security property under test: only a caller whose
// account_role is 'owner' can create or read an organization, and the
// accounts returned are always scoped to *this caller's own*
// organization (never another organization's rows) — see migration
// 041's is_organization_owner() and the accompanying senior review.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => ({
  role: 'owner' as 'owner' | 'admin' | 'agent' | 'viewer',
  accountId: 'acc-store-1',
  userId: 'user-1',
  existingOrg: null as Record<string, unknown> | null,
  linkedAccounts: [] as Record<string, unknown>[],
  insertedOrgs: [] as Record<string, unknown>[],
  adminUpdates: [] as { table: string; payload: unknown; filters: [string, unknown][] }[],
  capturedAccountsFilter: null as [string, unknown] | null,
  // auth.users lookups for email + invite status — keyed by owner_user_id.
  authUsersByOwnerId: {} as Record<string, { email: string; last_sign_in_at: string | null }>,
}))

class FakeForbiddenError extends Error {
  readonly status = 403
  constructor(message = 'Forbidden') {
    super(message)
  }
}

vi.mock('@/lib/auth/account', () => ({
  requireRole: async (min: string) => {
    const rank: Record<string, number> = { owner: 4, admin: 3, agent: 2, viewer: 1 }
    if (rank[h.role] < rank[min]) {
      throw new FakeForbiddenError(`This action requires the '${min}' role or higher`)
    }
    return {
      supabase: fakeSupabase,
      accountId: h.accountId,
      userId: h.userId,
      role: h.role,
      account: { id: h.accountId, name: 'Test Store' },
    }
  },
  toErrorResponse: (err: unknown) => {
    if (err instanceof FakeForbiddenError) {
      return Response.json({ error: err.message }, { status: err.status })
    }
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  },
}))

// The RLS-scoped ("caller's own session") client.
function orgBuilder() {
  const b: Record<string, unknown> = {
    select: () => b,
    insert: (payload: Record<string, unknown>) => {
      h.insertedOrgs.push(payload)
      return b
    },
    eq: () => b,
    order: () => b,
    single: () =>
      Promise.resolve({
        data: h.insertedOrgs.length > 0 ? { id: 'org-1', ...h.insertedOrgs.at(-1) } : null,
        error: null,
      }),
    maybeSingle: () => Promise.resolve({ data: h.existingOrg, error: null }),
  }
  return b
}

function accountsBuilder() {
  const filters: [string, unknown][] = []
  const b: Record<string, unknown> = {
    select: () => b,
    eq: (k: string, v: unknown) => {
      filters.push([k, v])
      h.capturedAccountsFilter = [k, v]
      return b
    },
    order: () => Promise.resolve({ data: h.linkedAccounts, error: null }),
  }
  return b
}

const fakeSupabase = {
  from: (table: string) => {
    if (table === 'organizations') return orgBuilder()
    if (table === 'accounts') return accountsBuilder()
    throw new Error(`unexpected table in RLS-scoped mock: ${table}`)
  },
}

// The service-role ("admin") client — used to link the store's own
// account to its freshly-created organization, and (GET only) to
// resolve each linked account owner's email/invite-status from
// auth.users, which no RLS policy ever exposes.
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => ({
      update: (payload: unknown) => ({
        eq: (k: string, v: unknown) => {
          h.adminUpdates.push({ table, payload, filters: [[k, v]] })
          return Promise.resolve({ error: null })
        },
      }),
    }),
    auth: {
      admin: {
        getUserById: async (uid: string) => {
          const user = h.authUsersByOwnerId[uid]
          if (!user) return { data: { user: null }, error: null }
          return { data: { user: { email: user.email, last_sign_in_at: user.last_sign_in_at } }, error: null }
        },
      },
    },
  }),
}))

import { GET, POST } from './route'

function resetState() {
  h.role = 'owner'
  h.accountId = 'acc-store-1'
  h.userId = 'user-1'
  h.existingOrg = null
  h.linkedAccounts = []
  h.insertedOrgs = []
  h.adminUpdates = []
  h.capturedAccountsFilter = null
  h.authUsersByOwnerId = {}
}

describe('GET /api/organization', () => {
  beforeEach(resetState)

  it('rejects a non-owner (admin) with 403', async () => {
    h.role = 'admin'
    const res = await GET()
    expect(res.status).toBe(403)
  })

  it('returns organization: null when the owner has not created one yet', async () => {
    h.existingOrg = null
    const res = await GET()
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.organization).toBeNull()
    expect(json.accounts).toEqual([])
  })

  it('scopes the linked-accounts query to this organization only, never a bare unscoped select', async () => {
    h.existingOrg = { id: 'org-1', name: 'Loja X', owner_account_id: h.accountId }
    h.linkedAccounts = [
      { id: 'acc-store-1', name: 'Loja X', owner_user_id: 'user-1', created_at: '2026-01-01T00:00:00Z' },
      { id: 'acc-seller-1', name: 'João', owner_user_id: 'user-seller-1', created_at: '2026-01-05T00:00:00Z' },
    ]
    h.authUsersByOwnerId = {
      'user-1': { email: 'owner@loja.com', last_sign_in_at: '2026-01-01T00:05:00Z' },
      'user-seller-1': { email: 'joao@loja.com', last_sign_in_at: null },
    }
    const res = await GET()
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.organization.id).toBe('org-1')
    expect(json.accounts).toHaveLength(2)
    const store = json.accounts.find((a: { id: string }) => a.id === 'acc-store-1')
    const seller = json.accounts.find((a: { id: string }) => a.id === 'acc-seller-1')
    expect(store).toMatchObject({
      isOwnerAccount: true,
      email: 'owner@loja.com',
      inviteStatus: 'accepted',
      joinedAt: '2026-01-01T00:00:00Z',
    })
    // Never signed in yet → still pending, not "accepted".
    expect(seller).toMatchObject({
      isOwnerAccount: false,
      email: 'joao@loja.com',
      inviteStatus: 'pending',
      joinedAt: '2026-01-05T00:00:00Z',
    })
    // The critical isolation property: accounts are fetched filtered
    // by THIS organization's id, not an unscoped `select *` that would
    // rely on RLS alone to save us.
    expect(h.capturedAccountsFilter).toEqual(['organization_id', 'org-1']);
  })

  it("falls back to a null email without failing the request when the auth lookup errors", async () => {
    h.existingOrg = { id: 'org-1', name: 'Loja X', owner_account_id: h.accountId }
    h.linkedAccounts = [
      { id: 'acc-store-1', name: 'Loja X', owner_user_id: 'user-unknown', created_at: '2026-01-01T00:00:00Z' },
    ]
    // No entry in authUsersByOwnerId for 'user-unknown' — getUserById resolves to a null user.
    const res = await GET()
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.accounts[0]).toMatchObject({ email: null, inviteStatus: 'pending' })
  })
})

describe('POST /api/organization', () => {
  beforeEach(resetState)

  it('rejects a non-owner (agent) with 403', async () => {
    h.role = 'agent'
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ name: 'Loja' }) }))
    expect(res.status).toBe(403)
  })

  it('requires a non-empty name', async () => {
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ name: '' }) }))
    expect(res.status).toBe(400)
  })

  it('refuses to create a second organization for the same owner account', async () => {
    h.existingOrg = { id: 'org-1', name: 'Loja X' }
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ name: 'Loja Y' }) }))
    expect(res.status).toBe(409)
  })

  it('creates the organization and links the caller\'s own account to it', async () => {
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ name: 'Loja X' }) }))
    expect(res.status).toBe(201)
    expect(h.insertedOrgs).toHaveLength(1)
    expect(h.insertedOrgs[0]).toMatchObject({ name: 'Loja X', owner_account_id: h.accountId })
    expect(h.adminUpdates).toHaveLength(1)
    expect(h.adminUpdates[0]).toMatchObject({
      table: 'accounts',
      payload: { organization_id: 'org-1' },
      filters: [['id', h.accountId]],
    })
  })
})
