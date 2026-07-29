import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Security tests for POST /api/platform/accounts/[id]/reset-password.
// Critical properties:
//   (a) a non platform-admin gets 403.
//   (b) 'link' mode (the default/primary action) sends a standard recovery
//       email — the admin never sees a password.
//   (c) 'direct' mode sets a password directly, but the password VALUE
//       never appears in the audit log's metadata.
//   (d) a too-short direct password is rejected before ever calling the
//       Auth admin API.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => ({
  isPlatformAdmin: true,
  accounts: [{ id: 'acc-a-seller-1', owner_user_id: 'user-a-seller-1' }] as Record<string, unknown>[],
  emailByUserId: { 'user-a-seller-1': 'vendedor1@lojaa.com' } as Record<string, string>,
  resetPasswordCalls: [] as { email: string; options: unknown }[],
  updateUserByIdCalls: [] as { uid: string; patch: Record<string, unknown> }[],
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

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () => Response.json({ error: 'rate limited' }, { status: 429 }),
  RATE_LIMITS: { adminAction: { limit: 30, windowMs: 60_000 } },
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      admin: {
        getUserById: (uid: string) =>
          Promise.resolve({ data: { user: { email: h.emailByUserId[uid] ?? null } }, error: null }),
        updateUserById: (uid: string, patch: Record<string, unknown>) => {
          h.updateUserByIdCalls.push({ uid, patch })
          return Promise.resolve({ error: null })
        },
      },
      resetPasswordForEmail: (email: string, options: unknown) => {
        h.resetPasswordCalls.push({ email, options })
        return Promise.resolve({ error: null })
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

import { POST } from './route'

function resetPassword(id: string, body: Record<string, unknown>) {
  return POST(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  })
}

function resetState() {
  h.isPlatformAdmin = true
  h.accounts = [{ id: 'acc-a-seller-1', owner_user_id: 'user-a-seller-1' }]
  h.emailByUserId = { 'user-a-seller-1': 'vendedor1@lojaa.com' }
  h.resetPasswordCalls = []
  h.updateUserByIdCalls = []
  h.auditInserts = []
}

describe('POST /api/platform/accounts/[id]/reset-password', () => {
  beforeEach(resetState)

  it('rejects a non platform-admin with 403', async () => {
    h.isPlatformAdmin = false
    const res = await resetPassword('acc-a-seller-1', {})
    expect(res.status).toBe(403)
  })

  it('returns 404 for an unknown account', async () => {
    const res = await resetPassword('acc-missing', {})
    expect(res.status).toBe(404)
  })

  it("defaults to 'link' mode and sends a recovery email to the account's own address", async () => {
    const res = await resetPassword('acc-a-seller-1', {})
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toMatchObject({ mode: 'link', done: true, email: 'vendedor1@lojaa.com' })
    expect(h.resetPasswordCalls).toHaveLength(1)
    expect(h.resetPasswordCalls[0].email).toBe('vendedor1@lojaa.com')
    // The admin never touches a password in this mode.
    expect(h.updateUserByIdCalls).toHaveLength(0)

    expect(h.auditInserts[0]).toMatchObject({
      action: 'account.password_reset_link_sent',
      target_id: 'acc-a-seller-1',
    })
  })

  it('rejects a too-short direct password before calling the Auth admin API', async () => {
    const res = await resetPassword('acc-a-seller-1', { mode: 'direct', newPassword: 'abc' })
    expect(res.status).toBe(400)
    expect(h.updateUserByIdCalls).toHaveLength(0)
  })

  it('sets the password directly via the Auth admin API without ever logging the value', async () => {
    const res = await resetPassword('acc-a-seller-1', { mode: 'direct', newPassword: 'super-secret-123' })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toEqual({ mode: 'direct', done: true })
    expect(h.updateUserByIdCalls).toEqual([
      { uid: 'user-a-seller-1', patch: { password: 'super-secret-123' } },
    ])

    expect(h.auditInserts).toHaveLength(1)
    expect(h.auditInserts[0]).toMatchObject({
      action: 'account.password_set_directly',
      target_id: 'acc-a-seller-1',
    })
    // The critical assertion: the password value never appears anywhere
    // in what gets written to the audit log.
    expect(JSON.stringify(h.auditInserts[0])).not.toContain('super-secret-123')
  })
})
