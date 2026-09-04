import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// BUG A2 fix (WhatsApp audit) — POST/DELETE /api/whatsapp/config used to
// resolve `account_id` straight off the caller's profile (any role) and
// call Meta for real (verifyPhoneNumber, registerPhoneNumber,
// subscribeWabaToApp) BEFORE the RLS-gated local write. A viewer or
// agent could therefore trigger those real, external Meta calls — RLS
// can't undo them — even though the local `whatsapp_config` insert/
// update/delete (admin-only per migration 017) was always going to be
// refused.
//
// These tests prove the property the fix establishes:
//   viewer/agent -> requireRole('admin') -> 403 -> END
// and NEVER:
//   viewer/agent -> Meta call -> RLS rejects DB write -> 500
//
// GET is untouched by this fix (its SELECT RLS policy has no role
// floor) and is not exercised here.
// ============================================================

let callerRole = 'admin'
let callerAccountId: string | null = 'acct-1'
/** Pre-existing whatsapp_config row for the caller's account, if any. */
let existingConfigRow: Record<string, unknown> | null = null
/** A row belonging to a DIFFERENT account already claiming the phone number. */
let claimedByOtherAccount: Record<string, unknown> | null = null

const configInserts: Array<Record<string, unknown>> = []
const configUpdates: Array<Record<string, unknown>> = []
const configDeletes: Array<Record<string, unknown>> = []

function makeSupabaseMock() {
  function builder(table: string) {
    let op: 'select' | 'update' | 'insert' | 'delete' = 'select'
    let payload: Record<string, unknown> | undefined
    const filters: Record<string, unknown> = {}

    const result = (): { data: unknown; error: unknown } => {
      if (table === 'profiles') {
        return callerAccountId
          ? {
              data: { account_id: callerAccountId, account_role: callerRole },
              error: null,
            }
          : { data: null, error: null }
      }
      if (table === 'accounts') {
        return { data: { id: callerAccountId, name: 'Acme' }, error: null }
      }
      if (table === 'whatsapp_config') {
        if (op === 'insert') {
          configInserts.push({ ...payload })
          return { data: { id: 'cfg-new', ...payload }, error: null }
        }
        if (op === 'update') {
          configUpdates.push({ ...filters, ...payload })
          return { data: { id: 'cfg-1', ...payload }, error: null }
        }
        if (op === 'delete') {
          configDeletes.push({ ...filters })
          return { data: null, error: null }
        }
        return { data: existingConfigRow, error: null }
      }
      return { data: null, error: null }
    }

    const b: Record<string, unknown> = {}
    b.select = vi.fn(() => b)
    b.eq = vi.fn((col: string, val: unknown) => {
      filters[col] = val
      return b
    })
    b.insert = vi.fn((p: Record<string, unknown>) => {
      op = 'insert'
      payload = p
      return b
    })
    b.update = vi.fn((p: Record<string, unknown>) => {
      op = 'update'
      payload = p
      return b
    })
    b.delete = vi.fn(() => {
      op = 'delete'
      return b
    })
    b.single = vi.fn(() => Promise.resolve(result()))
    b.maybeSingle = vi.fn(() => Promise.resolve(result()))
    b.then = (resolve: (v: unknown) => unknown) => resolve(result())
    return b
  }

  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: 'user-1' } },
        error: null,
      })),
    },
    from: vi.fn((table: string) => builder(table)),
  }
}

let supabaseMock = makeSupabaseMock()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => supabaseMock),
}))

// The route's own lazily-initialised service-role client, used only for
// the "phone_number_id already claimed by another account" check.
function makeAdminMock() {
  function builder() {
    const b: Record<string, unknown> = {}
    b.select = vi.fn(() => b)
    b.eq = vi.fn(() => b)
    b.neq = vi.fn(() => b)
    b.maybeSingle = vi.fn(() =>
      Promise.resolve({ data: claimedByOtherAccount, error: null }),
    )
    return b
  }
  return { from: vi.fn(() => builder()) }
}
let adminMock = makeAdminMock()
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => adminMock),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: vi.fn(() => 'plaintext-token'),
  encrypt: vi.fn((v: string) => `enc(${v})`),
}))

const { verifyPhoneNumber, registerPhoneNumber, subscribeWabaToApp } = vi.hoisted(
  () => ({
    verifyPhoneNumber: vi.fn(async () => ({
      id: 'PNID-1',
      display_phone_number: '+1 555 0100',
      verified_name: 'Acme',
    })),
    registerPhoneNumber: vi.fn(async () => ({
      success: true,
      alreadyRegistered: false,
    })),
    subscribeWabaToApp: vi.fn(async () => undefined),
  }),
)
vi.mock('@/lib/whatsapp/meta-api', () => ({
  verifyPhoneNumber,
  registerPhoneNumber,
  subscribeWabaToApp,
}))

import { POST, DELETE } from './route'

function postConfig(overrides: Record<string, unknown> = {}) {
  return POST(
    new Request('http://localhost/api/whatsapp/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone_number_id: 'PNID-1',
        waba_id: 'WABA-1',
        access_token: 'plaintext-access-token',
        verify_token: 'my-verify-token',
        pin: '123456',
        ...overrides,
      }),
    }),
  )
}

function deleteConfig() {
  return DELETE()
}

describe('POST/DELETE /api/whatsapp/config — role enforcement (BUG A2)', () => {
  beforeEach(() => {
    callerRole = 'admin'
    callerAccountId = 'acct-1'
    existingConfigRow = null
    claimedByOtherAccount = null
    configInserts.length = 0
    configUpdates.length = 0
    configDeletes.length = 0
    supabaseMock = makeSupabaseMock()
    adminMock = makeAdminMock()
    verifyPhoneNumber.mockClear()
    registerPhoneNumber.mockClear()
    subscribeWabaToApp.mockClear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('1. viewer + POST -> 403, no Meta call, DB untouched', async () => {
    callerRole = 'viewer'
    const res = await postConfig()
    expect(res.status).toBe(403)
    expect(verifyPhoneNumber).not.toHaveBeenCalled()
    expect(registerPhoneNumber).not.toHaveBeenCalled()
    expect(subscribeWabaToApp).not.toHaveBeenCalled()
    expect(configInserts).toHaveLength(0)
    expect(configUpdates).toHaveLength(0)
  })

  it('2. agent + POST -> 403, no Meta call, DB untouched', async () => {
    callerRole = 'agent'
    const res = await postConfig()
    expect(res.status).toBe(403)
    expect(verifyPhoneNumber).not.toHaveBeenCalled()
    expect(registerPhoneNumber).not.toHaveBeenCalled()
    expect(subscribeWabaToApp).not.toHaveBeenCalled()
    expect(configInserts).toHaveLength(0)
    expect(configUpdates).toHaveLength(0)
  })

  it('3. admin + POST -> preserved behavior: verifies, registers, subscribes, saves', async () => {
    callerRole = 'admin'
    const res = await postConfig()
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(verifyPhoneNumber).toHaveBeenCalledTimes(1)
    expect(registerPhoneNumber).toHaveBeenCalledTimes(1)
    expect(subscribeWabaToApp).toHaveBeenCalledTimes(1)
    expect(configInserts).toHaveLength(1)
    expect(configInserts[0]).toMatchObject({
      account_id: 'acct-1',
      user_id: 'user-1',
      phone_number_id: 'PNID-1',
    })
  })

  it('4. viewer + DELETE -> 403, no Meta call, DB untouched', async () => {
    callerRole = 'viewer'
    const res = await deleteConfig()
    expect(res.status).toBe(403)
    expect(verifyPhoneNumber).not.toHaveBeenCalled()
    expect(registerPhoneNumber).not.toHaveBeenCalled()
    expect(subscribeWabaToApp).not.toHaveBeenCalled()
    expect(configDeletes).toHaveLength(0)
  })

  it('5. agent + DELETE -> 403, no Meta call, DB untouched', async () => {
    callerRole = 'agent'
    const res = await deleteConfig()
    expect(res.status).toBe(403)
    expect(verifyPhoneNumber).not.toHaveBeenCalled()
    expect(registerPhoneNumber).not.toHaveBeenCalled()
    expect(subscribeWabaToApp).not.toHaveBeenCalled()
    expect(configDeletes).toHaveLength(0)
  })

  it('6. admin + DELETE -> preserved behavior: deletes the account config', async () => {
    callerRole = 'admin'
    const res = await deleteConfig()
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(configDeletes).toHaveLength(1)
    expect(configDeletes[0]).toMatchObject({ account_id: 'acct-1' })
  })

  it('7. a user with no linked account has no access -> 403, no Meta call, DB untouched', async () => {
    callerAccountId = null // profile lookup returns no account_id
    const postRes = await postConfig()
    expect(postRes.status).toBe(403)
    expect(verifyPhoneNumber).not.toHaveBeenCalled()

    const delRes = await deleteConfig()
    expect(delRes.status).toBe(403)
    expect(configDeletes).toHaveLength(0)
  })

  it('8. Meta is never called before the role rejection (viewer/agent, POST and DELETE)', async () => {
    for (const role of ['viewer', 'agent']) {
      callerRole = role
      await postConfig()
      await deleteConfig()
    }
    expect(verifyPhoneNumber).not.toHaveBeenCalled()
    expect(registerPhoneNumber).not.toHaveBeenCalled()
    expect(subscribeWabaToApp).not.toHaveBeenCalled()
    expect(configInserts).toHaveLength(0)
    expect(configUpdates).toHaveLength(0)
    expect(configDeletes).toHaveLength(0)
  })
})
