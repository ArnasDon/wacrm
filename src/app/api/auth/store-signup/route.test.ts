import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Security + correctness tests for POST /api/auth/store-signup — the route
// that turns a brand-new, just-signed-up personal account into a store
// (rename + organization + link), called with no session (email
// confirmation is typically still pending at this point). Critical
// properties:
//   (a) creates account + organization end-to-end for a fresh account.
//   (b) never re-bootstraps an account that already has an organization —
//       and, if that existing organization belongs to someone ELSE (this
//       account is a linked SELLER, not the store), it must not leak that
//       organization's name/status back to the caller.
//   (c) rejects a missing/unresolvable account cleanly.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => ({
  profileAccountId: 'acc-new-1' as string | null,
  account: { id: 'acc-new-1', organization_id: null as string | null },
  existingOrg: null as Record<string, unknown> | null,
  accountUpdates: [] as { payload: Record<string, unknown>; filters: [string, unknown][] }[],
  orgInserts: [] as Record<string, unknown>[],
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () => Response.json({ error: 'rate limited' }, { status: 429 }),
  RATE_LIMITS: { adminAction: { limit: 30, windowMs: 60_000 } },
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: h.profileAccountId ? { account_id: h.profileAccountId } : null,
                  error: null,
                }),
            }),
          }),
        }
      }
      if (table === 'accounts') {
        return {
          select: (cols: string) => {
            if (cols === 'id, organization_id') {
              return {
                eq: () => ({
                  maybeSingle: () => Promise.resolve({ data: h.account, error: null }),
                }),
              }
            }
            throw new Error(`unexpected accounts select: ${cols}`)
          },
          update: (payload: Record<string, unknown>) => ({
            eq: (k: string, v: unknown) => {
              h.accountUpdates.push({ payload, filters: [[k, v]] })
              return {
                select: () => ({
                  single: () =>
                    Promise.resolve({
                      data: { id: h.account.id, name: payload.name ?? 'Store' },
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
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: h.existingOrg, error: null }),
            }),
          }),
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

import { POST } from './route'

function postSignup(body: Record<string, unknown>) {
  return POST(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }))
}

function resetState() {
  h.profileAccountId = 'acc-new-1'
  h.account = { id: 'acc-new-1', organization_id: null }
  h.existingOrg = null
  h.accountUpdates = []
  h.orgInserts = []
}

describe('POST /api/auth/store-signup', () => {
  beforeEach(resetState)

  it('rejects a missing userId', async () => {
    const res = await postSignup({ storeName: 'Loja Nova' })
    expect(res.status).toBe(400)
  })

  it('rejects an empty store name', async () => {
    const res = await postSignup({ userId: 'user-1', storeName: '' })
    expect(res.status).toBe(400)
  })

  it('returns 404 when the userId resolves to no profile', async () => {
    h.profileAccountId = null
    const res = await postSignup({ userId: 'user-ghost', storeName: 'Loja Nova' })
    expect(res.status).toBe(404)
  })

  it('bootstraps the organization end-to-end for a fresh account', async () => {
    const res = await postSignup({ userId: 'user-1', storeName: 'Loja Nova' })
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(h.accountUpdates[0]).toMatchObject({ payload: { name: 'Loja Nova' } })
    expect(h.orgInserts).toEqual([{ name: 'Loja Nova', owner_account_id: 'acc-new-1' }])
    expect(h.accountUpdates[1]).toMatchObject({
      payload: { organization_id: 'org-new-1' },
      filters: [['id', 'acc-new-1']],
    })
    expect(json.organization).toMatchObject({ id: 'org-new-1', name: 'Loja Nova', status: 'active' })
  })

  it('is idempotent when this account already bootstrapped its own organization', async () => {
    h.account = { id: 'acc-new-1', organization_id: 'org-existing' }
    h.existingOrg = {
      id: 'org-existing',
      name: 'Loja Nova',
      status: 'active',
      created_at: '2026-01-01T00:00:00Z',
      owner_account_id: 'acc-new-1',
    }
    const res = await postSignup({ userId: 'user-1', storeName: 'Loja Nova' })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.organization).toMatchObject({ id: 'org-existing', name: 'Loja Nova' })
    // No re-bootstrap attempted.
    expect(h.orgInserts).toHaveLength(0)
  })

  it('refuses to touch (or disclose) an account already linked into a DIFFERENT organization as a seller', async () => {
    h.account = { id: 'acc-seller-1', organization_id: 'org-other-store' }
    h.existingOrg = {
      id: 'org-other-store',
      name: 'Loja De Outra Pessoa',
      status: 'active',
      created_at: '2026-01-01T00:00:00Z',
      owner_account_id: 'acc-some-other-store', // NOT this account
    }
    const res = await postSignup({ userId: 'user-seller-1', storeName: 'Qualquer Nome' })
    const json = await res.json()

    expect(res.status).toBe(409)
    // Never leaks the unrelated organization's name/status.
    expect(JSON.stringify(json)).not.toContain('Loja De Outra Pessoa')
    expect(h.orgInserts).toHaveLength(0)
  })
})
