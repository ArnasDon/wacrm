import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Security tests for GET/POST /api/platform/organizations — the platform
// admin panel's core listing + store-creation route. Critical properties:
//   (a) a regular (non platform-admin) user gets 403, same as every other
//       platform_admins-gated route.
//   (b) a real platform admin sees organizations from MULTIPLE, completely
//       unrelated stores in one response — this is the one screen in the
//       app that deliberately crosses tenant boundaries, by design.
//   (c) POST creates the owner account + organization + link in one flow,
//       mirroring /api/organization/sellers's own invite mechanics.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => ({
  isPlatformAdmin: true,
  organizations: [] as Record<string, unknown>[],
  accountsByOrg: {} as Record<string, number>,
  ownerUserIdByAccount: {} as Record<string, string>,
  emailByUserId: {} as Record<string, string>,
  inviteError: null as { message: string } | null,
  invitedUserId: 'new-owner-1',
  newUserProfileAccountId: 'acc-new-store' as string | null,
  accountUpdates: [] as { payload: Record<string, unknown>; filters: [string, unknown][] }[],
  orgInserts: [] as Record<string, unknown>[],
  inviteCalls: [] as { email: string }[],
}))

class FakeForbiddenError extends Error {
  readonly status = 403
  constructor(message = 'Not a platform admin') {
    super(message)
  }
}
class FakeUnauthorizedError extends Error {
  readonly status = 401
}

vi.mock('@/lib/auth/platform', () => ({
  requirePlatformAdmin: async () => {
    if (!h.isPlatformAdmin) throw new FakeForbiddenError()
    return { supabase: fakeSupabase, userId: 'user-admin-1' }
  },
}))

vi.mock('@/lib/auth/account', () => ({
  toErrorResponse: (err: unknown) => {
    if (err instanceof FakeForbiddenError || err instanceof FakeUnauthorizedError) {
      return Response.json({ error: err.message }, { status: err.status })
    }
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  },
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () => Response.json({ error: 'rate limited' }, { status: 429 }),
  RATE_LIMITS: { adminAction: { limit: 30, windowMs: 60_000 } },
}))

// The RLS-scoped client requirePlatformAdmin() hands back — GET reads
// through this, exercising the organizations_platform_select /
// accounts_platform_select policies' intended shape (cross-org, no
// per-org filter anywhere in the query).
const fakeSupabase = {
  from: (table: string) => {
    if (table === 'organizations') {
      return {
        select: () => ({
          order: () => Promise.resolve({ data: h.organizations, error: null }),
        }),
      }
    }
    if (table === 'accounts') {
      return {
        select: (cols: string, opts?: { count?: string; head?: boolean }) => {
          if (opts?.count) {
            // count-only query: accounts linked to one organization_id
            return {
              eq: (_k: string, orgId: string) =>
                Promise.resolve({ count: h.accountsByOrg[orgId] ?? 0, error: null }),
            }
          }
          // owner_user_id point lookup by account id
          return {
            eq: (_k: string, accountId: string) => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: h.ownerUserIdByAccount[accountId]
                    ? { owner_user_id: h.ownerUserIdByAccount[accountId] }
                    : null,
                  error: null,
                }),
            }),
          }
        },
      }
    }
    throw new Error(`unexpected table in RLS-scoped mock: ${table}`)
  },
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      admin: {
        getUserById: (uid: string) =>
          Promise.resolve({
            data: { user: h.emailByUserId[uid] ? { email: h.emailByUserId[uid] } : null },
            error: null,
          }),
        inviteUserByEmail: (email: string) => {
          h.inviteCalls.push({ email })
          if (h.inviteError) return Promise.resolve({ data: null, error: h.inviteError })
          return Promise.resolve({ data: { user: { id: h.invitedUserId } }, error: null })
        },
      },
    },
    from: (table: string) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: h.newUserProfileAccountId
                    ? { account_id: h.newUserProfileAccountId }
                    : null,
                  error: null,
                }),
            }),
          }),
        }
      }
      if (table === 'accounts') {
        return {
          update: (payload: Record<string, unknown>) => ({
            eq: (k: string, v: unknown) => {
              h.accountUpdates.push({ payload, filters: [[k, v]] })
              return {
                select: () => ({
                  single: () =>
                    Promise.resolve({
                      data: { id: h.newUserProfileAccountId, name: payload.name ?? 'Store' },
                      error: null,
                    }),
                }),
              }
            },
          }),
        }
      }
      if (table === 'organizations') {
        return {
          insert: (payload: Record<string, unknown>) => ({
            select: () => ({
              single: () => {
                h.orgInserts.push(payload)
                return Promise.resolve({
                  data: {
                    id: 'org-new-1',
                    name: payload.name,
                    created_at: '2026-01-01T00:00:00Z',
                    status: 'active',
                    billing_status: 'trial',
                  },
                  error: null,
                })
              },
            }),
          }),
        }
      }
      throw new Error(`unexpected table in admin mock: ${table}`)
    },
  }),
}))

import { GET, POST } from './route'

function postOrg(body: Record<string, unknown>) {
  return POST(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }))
}

function resetState() {
  h.isPlatformAdmin = true
  h.organizations = []
  h.accountsByOrg = {}
  h.ownerUserIdByAccount = {}
  h.emailByUserId = {}
  h.inviteError = null
  h.invitedUserId = 'new-owner-1'
  h.newUserProfileAccountId = 'acc-new-store'
  h.accountUpdates = []
  h.orgInserts = []
  h.inviteCalls = []
}

describe('GET /api/platform/organizations', () => {
  beforeEach(resetState)

  it('rejects a non platform-admin with 403', async () => {
    h.isPlatformAdmin = false
    const res = await GET()
    expect(res.status).toBe(403)
  })

  it('lists organizations from multiple, completely unrelated stores in one response', async () => {
    h.organizations = [
      { id: 'org-a', name: 'Loja A', owner_account_id: 'acc-a', created_at: '2026-01-01T00:00:00Z', status: 'active', billing_status: 'trial' },
      { id: 'org-b', name: 'Loja B', owner_account_id: 'acc-b', created_at: '2026-02-01T00:00:00Z', status: 'suspended', billing_status: 'past_due' },
    ]
    // Loja A: 3 linked accounts total (store + 2 sellers). Loja B: just the store.
    h.accountsByOrg = { 'org-a': 3, 'org-b': 1 }
    h.ownerUserIdByAccount = { 'acc-a': 'user-a', 'acc-b': 'user-b' }
    h.emailByUserId = { 'user-a': 'dona@lojaa.com', 'user-b': 'dono@lojab.com' }

    const res = await GET()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.organizations).toHaveLength(2)

    const lojaA = json.organizations.find((o: { id: string }) => o.id === 'org-a')
    const lojaB = json.organizations.find((o: { id: string }) => o.id === 'org-b')

    // Cross-org visibility: two unrelated stores, neither filtered out.
    expect(lojaA).toMatchObject({
      name: 'Loja A',
      status: 'active',
      billingStatus: 'trial',
      ownerEmail: 'dona@lojaa.com',
      sellerCount: 2, // 3 linked accounts minus the store's own
    })
    expect(lojaB).toMatchObject({
      name: 'Loja B',
      status: 'suspended',
      billingStatus: 'past_due',
      ownerEmail: 'dono@lojab.com',
      sellerCount: 0,
    })
  })

  it('falls back to a null owner email without failing the request when the auth lookup has no user', async () => {
    h.organizations = [
      { id: 'org-a', name: 'Loja A', owner_account_id: 'acc-a', created_at: '2026-01-01T00:00:00Z', status: 'active' },
    ]
    h.accountsByOrg = { 'org-a': 1 }
    h.ownerUserIdByAccount = { 'acc-a': 'user-unknown' }
    // No entry in emailByUserId for 'user-unknown'.
    const res = await GET()
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.organizations[0].ownerEmail).toBeNull()
  })
})

describe('POST /api/platform/organizations', () => {
  beforeEach(resetState)

  it('rejects a non platform-admin with 403', async () => {
    h.isPlatformAdmin = false
    const res = await postOrg({ storeName: 'Loja Nova', ownerEmail: 'dono@example.com' })
    expect(res.status).toBe(403)
    expect(h.inviteCalls).toHaveLength(0)
  })

  it('rejects an empty store name', async () => {
    const res = await postOrg({ storeName: '', ownerEmail: 'dono@example.com' })
    expect(res.status).toBe(400)
    expect(h.inviteCalls).toHaveLength(0)
  })

  it('rejects an invalid owner email before ever calling inviteUserByEmail', async () => {
    const res = await postOrg({ storeName: 'Loja Nova', ownerEmail: 'not-an-email' })
    expect(res.status).toBe(400)
    expect(h.inviteCalls).toHaveLength(0)
  })

  it('surfaces a clear 409 when the owner email is already registered', async () => {
    h.inviteError = { message: 'User already registered' }
    const res = await postOrg({ storeName: 'Loja Nova', ownerEmail: 'dono@example.com' })
    expect(res.status).toBe(409)
    expect(h.orgInserts).toHaveLength(0)
  })

  it('creates the owner account, renames it, creates the organization, and links them', async () => {
    const res = await postOrg({ storeName: 'Loja Nova', ownerEmail: 'dono@example.com' })
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(h.inviteCalls).toEqual([{ email: 'dono@example.com' }])

    // Rename, then link — two accounts.update calls.
    expect(h.accountUpdates).toHaveLength(2)
    expect(h.accountUpdates[0].payload).toMatchObject({ name: 'Loja Nova' })
    expect(h.accountUpdates[1].payload).toMatchObject({ organization_id: 'org-new-1' })
    expect(h.accountUpdates[1].filters).toEqual([['id', 'acc-new-store']])

    expect(h.orgInserts).toEqual([{ name: 'Loja Nova', owner_account_id: 'acc-new-store' }])

    expect(json.organization).toMatchObject({
      id: 'org-new-1',
      name: 'Loja Nova',
      status: 'active',
      billingStatus: 'trial',
      ownerEmail: 'dono@example.com',
      sellerCount: 0,
    })
  })
})
