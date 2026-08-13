import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Authorization tests for POST /api/organization/sellers — the route that
// creates a brand-new, fully independent account for a seller and links it
// to the caller's organization. Critical properties under test:
//   (a) only an 'owner' can call this at all
//   (b) it refuses to run without an existing organization (no implicit
//       auto-create — an owner must deliberately set one up first)
//   (c) the new account is linked via organization_id, never given any
//       membership/role on the caller's own account (there is no such
//       write path in this route at all — see the assertions on
//       h.adminUpdates below, which only ever records an `accounts` table
//       write, never `profiles` or anything account-membership-shaped)
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => ({
  role: 'owner' as 'owner' | 'admin' | 'agent' | 'viewer',
  accountId: 'acc-store-1',
  userId: 'user-1',
  existingOrg: null as Record<string, unknown> | null,
  inviteError: null as { message: string } | null,
  invitedUserId: 'new-user-1',
  newUserProfileAccountId: 'acc-seller-1' as string | null,
  adminUpdates: [] as { table: string; payload: unknown; filters: [string, unknown][] }[],
  inviteCalls: [] as { email: string; options: unknown }[],
  createUserCalls: [] as { args: Record<string, unknown> }[],
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

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () => Response.json({ error: 'rate limited' }, { status: 429 }),
  RATE_LIMITS: { adminAction: { limit: 30, windowMs: 60_000 } },
}))

const fakeSupabase = {
  from: (table: string) => {
    if (table !== 'organizations') throw new Error(`unexpected table: ${table}`)
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: h.existingOrg, error: null }),
        }),
      }),
    }
  },
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      admin: {
        inviteUserByEmail: (email: string, options: unknown) => {
          h.inviteCalls.push({ email, options })
          if (h.inviteError) return Promise.resolve({ data: null, error: h.inviteError })
          return Promise.resolve({ data: { user: { id: h.invitedUserId } }, error: null })
        },
        createUser: (args: Record<string, unknown>) => {
          h.createUserCalls.push({ args })
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
                  data: h.newUserProfileAccountId ? { account_id: h.newUserProfileAccountId } : null,
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
              h.adminUpdates.push({ table, payload, filters: [[k, v]] })
              return {
                select: () => ({
                  single: () =>
                    Promise.resolve({
                      data: { id: h.newUserProfileAccountId, name: (payload as { name: string }).name },
                      error: null,
                    }),
                }),
              }
            },
          }),
        }
      }
      throw new Error(`unexpected table in admin mock: ${table}`)
    },
  }),
}))

import { POST } from './route'

function postSeller(body: Record<string, unknown>) {
  return POST(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }))
}

function resetState() {
  h.role = 'owner'
  h.accountId = 'acc-store-1'
  h.userId = 'user-1'
  h.existingOrg = { id: 'org-1', owner_account_id: h.accountId }
  h.inviteError = null
  h.invitedUserId = 'new-user-1'
  h.newUserProfileAccountId = 'acc-seller-1'
  h.adminUpdates = []
  h.inviteCalls = []
  h.createUserCalls = []
}

describe('POST /api/organization/sellers', () => {
  beforeEach(resetState)

  it('rejects a non-owner (admin) with 403 — the store\'s own admins cannot create sellers', async () => {
    h.role = 'admin'
    const res = await postSeller({ name: 'João', email: 'joao@example.com' })
    expect(res.status).toBe(403)
  })

  it('refuses to create a seller before an organization exists', async () => {
    h.existingOrg = null
    const res = await postSeller({ name: 'João', email: 'joao@example.com' })
    expect(res.status).toBe(400)
    expect(h.inviteCalls).toHaveLength(0)
  })

  it('rejects an invalid email before ever calling inviteUserByEmail', async () => {
    const res = await postSeller({ name: 'João', email: 'not-an-email' })
    expect(res.status).toBe(400)
    expect(h.inviteCalls).toHaveLength(0)
  })

  it('rejects an empty name', async () => {
    const res = await postSeller({ name: '', email: 'joao@example.com' })
    expect(res.status).toBe(400)
    expect(h.inviteCalls).toHaveLength(0)
  })

  it('surfaces a clear 409 when the email is already registered, without touching accounts', async () => {
    h.inviteError = { message: 'User already registered' }
    const res = await postSeller({ name: 'João', email: 'joao@example.com' })
    expect(res.status).toBe(409)
    expect(h.adminUpdates).toHaveLength(0)
  })

  it('creates the seller account linked to the caller\'s organization — never a membership row', async () => {
    const res = await postSeller({ name: 'João', email: 'joao@example.com' })
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(h.inviteCalls).toHaveLength(1)
    expect(h.inviteCalls[0].email).toBe('joao@example.com')

    // Exactly one write, to `accounts`, setting organization_id — no
    // write anywhere that could be mistaken for granting the seller
    // (or anyone) membership on the STORE's own account.
    expect(h.adminUpdates).toHaveLength(1)
    expect(h.adminUpdates[0].table).toBe('accounts')
    expect(h.adminUpdates[0].payload).toMatchObject({ name: 'João', organization_id: 'org-1' })
    expect(h.adminUpdates[0].filters).toEqual([['id', 'acc-seller-1']])

    expect(json.account).toMatchObject({ id: 'acc-seller-1', name: 'João', isOwnerAccount: false })
    expect(json.mode).toBe('email')
  })

  it('rejects a password shorter than 6 characters before calling any Supabase API', async () => {
    const res = await postSeller({ name: 'João', email: 'joao@example.com', password: 'abc' })
    expect(res.status).toBe(400)
    expect(h.inviteCalls).toHaveLength(0)
    expect(h.createUserCalls).toHaveLength(0)
  })

  it('creates the account directly via createUser (email_confirm: true) when a password is given, never calling inviteUserByEmail', async () => {
    const res = await postSeller({ name: 'João', email: 'joao@example.com', password: 'senha123' })
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(h.inviteCalls).toHaveLength(0)
    expect(h.createUserCalls).toHaveLength(1)
    expect(h.createUserCalls[0].args).toMatchObject({
      email: 'joao@example.com',
      password: 'senha123',
      email_confirm: true,
      user_metadata: { full_name: 'João' },
    })

    // Same downstream linking as the email path.
    expect(h.adminUpdates).toHaveLength(1)
    expect(h.adminUpdates[0].payload).toMatchObject({ name: 'João', organization_id: 'org-1' })

    expect(json.account).toMatchObject({ id: 'acc-seller-1', name: 'João', isOwnerAccount: false })
    expect(json.mode).toBe('direct')
  })

  it('surfaces a clear 409 for an already-registered email in direct-password mode too', async () => {
    h.inviteError = { message: 'User already registered' }
    const res = await postSeller({ name: 'João', email: 'joao@example.com', password: 'senha123' })
    expect(res.status).toBe(409)
    expect(h.adminUpdates).toHaveLength(0)
  })
})
