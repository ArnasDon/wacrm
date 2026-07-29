import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Security tests for PATCH /api/platform/organizations/[id]/status — the
// ONLY way organizations.status ever changes (no RLS UPDATE policy exists
// for it at all, by design — see migration 042). Critical properties:
//   (a) a non platform-admin gets 403.
//   (b) a real platform admin can flip an org to 'suspended' and back to
//       'active'.
//   (c) an invalid status value is rejected before ever touching the DB.
// The actual "suspension blocks member access" enforcement lives in
// is_account_member()/my_account_suspended() and is covered by
// src/lib/auth/account.test.ts — this file only covers the admin-facing
// toggle itself.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => ({
  isPlatformAdmin: true,
  updates: [] as { payload: unknown; filters: [string, unknown][] }[],
  orgExists: true,
}))

class FakeForbiddenError extends Error {
  readonly status = 403
  constructor(message = 'Not a platform admin') {
    super(message)
  }
}

vi.mock('@/lib/auth/platform', () => ({
  requirePlatformAdmin: async () => {
    if (!h.isPlatformAdmin) throw new FakeForbiddenError()
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
    from: (table: string) => {
      if (table !== 'organizations') throw new Error(`unexpected table: ${table}`)
      return {
        update: (payload: unknown) => ({
          eq: (k: string, v: unknown) => {
            h.updates.push({ payload, filters: [[k, v]] })
            return {
              select: () => ({
                maybeSingle: () =>
                  Promise.resolve(
                    h.orgExists
                      ? {
                          data: { id: v, name: 'Loja X', status: (payload as { status: string }).status },
                          error: null,
                        }
                      : { data: null, error: null },
                  ),
              }),
            }
          },
        }),
      }
    },
  }),
}))

import { PATCH } from './route'

function patchStatus(id: string, body: Record<string, unknown>) {
  return PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  })
}

function resetState() {
  h.isPlatformAdmin = true
  h.updates = []
  h.orgExists = true
}

describe('PATCH /api/platform/organizations/[id]/status', () => {
  beforeEach(resetState)

  it('rejects a non platform-admin with 403', async () => {
    h.isPlatformAdmin = false
    const res = await patchStatus('org-1', { status: 'suspended' })
    expect(res.status).toBe(403)
    expect(h.updates).toHaveLength(0)
  })

  it('rejects an invalid status value before touching the DB', async () => {
    const res = await patchStatus('org-1', { status: 'deleted' })
    expect(res.status).toBe(400)
    expect(h.updates).toHaveLength(0)
  })

  it('suspends an organization', async () => {
    const res = await patchStatus('org-1', { status: 'suspended' })
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.organization).toMatchObject({ id: 'org-1', status: 'suspended' })
    expect(h.updates[0]).toMatchObject({
      payload: { status: 'suspended' },
      filters: [['id', 'org-1']],
    })
  })

  it('reactivates a suspended organization', async () => {
    const res = await patchStatus('org-1', { status: 'active' })
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.organization).toMatchObject({ id: 'org-1', status: 'active' })
  })

  it('returns 404 for an organization id that does not exist', async () => {
    h.orgExists = false
    const res = await patchStatus('org-missing', { status: 'active' })
    expect(res.status).toBe(404)
  })
})
