import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Multi-number, multi-tenant coverage for the WhatsApp connections
// collection endpoint (migration 050). Two things matter most here:
//   1. GET only ever queries the caller's own account_id — never returns
//      another company's connections.
//   2. POST forces the FIRST connection an account creates to be the
//      default regardless of what the caller sent, and leaves later ones
//      alone unless the caller explicitly asks.
// ---------------------------------------------------------------------------

let callerAccountId = 'acct-1'
let callerRole = 'admin'
let existingConfigCount = 0
const insertedRows: Array<Record<string, unknown>> = []
const listQueryAccountIds: string[] = []

function rlsSupabaseMock() {
  function builder(table: string) {
    let didInsert = false
    let insertedRow: Record<string, unknown> | null = null

    const b: Record<string, unknown> = {}
    const chain = () => b
    for (const m of ['select', 'eq', 'order']) b[m] = vi.fn(chain)

    // Track account_id filters on the whatsapp_config list query so the
    // isolation assertion below has something concrete to check.
    b.eq = vi.fn((col: string, val: unknown) => {
      if (table === 'whatsapp_config' && col === 'account_id') {
        listQueryAccountIds.push(val as string)
      }
      return b
    })

    b.select = vi.fn((_cols?: string, opts?: { count?: string; head?: boolean }) => {
      if (table === 'whatsapp_config' && opts?.head) {
        // The isFirstConnection count check.
        return {
          eq: () => Promise.resolve({ count: existingConfigCount, error: null }),
        }
      }
      return b
    })

    b.insert = vi.fn((row: Record<string, unknown>) => {
      didInsert = true
      insertedRow = row
      insertedRows.push(row)
      return b
    })
    b.single = vi.fn(async () => ({ data: { id: 'new-cfg-id' }, error: null }))
    b.maybeSingle = vi.fn(async () => {
      if (table === 'profiles') {
        return { data: { account_id: callerAccountId, account_role: callerRole }, error: null }
      }
      if (table === 'accounts') {
        return { data: { id: callerAccountId, name: 'Acme' }, error: null }
      }
      return { data: null, error: null }
    })
    // Bare-awaited list query: select().eq().order().order()
    b.then = (resolve: (v: unknown) => unknown) => {
      if (didInsert) return resolve({ data: insertedRow, error: null })
      if (table === 'whatsapp_config') {
        return resolve({
          data: [
            { id: 'cfg-1', account_id: callerAccountId, provider: 'meta', is_default: true },
          ],
          error: null,
        })
      }
      return resolve({ data: null, error: null })
    }
    return b
  }

  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null })),
    },
    from: vi.fn((table: string) => builder(table)),
  }
}

let supabaseMock = rlsSupabaseMock()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => supabaseMock),
}))

// Service-role client used only for the cross-account "phone number
// already claimed" check — no other account has claimed anything in
// these tests.
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          neq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
        }),
      }),
    }),
  })),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  encrypt: (v: string) => `enc:${v}`,
  decrypt: (v: string) => v.replace(/^enc:/, ''),
}))

vi.mock('@/lib/whatsapp/meta-api', () => ({
  verifyPhoneNumber: vi.fn(async () => ({ verified_name: 'Acme', display_phone_number: '+15550001' })),
  registerPhoneNumber: vi.fn(async () => ({})),
  subscribeWabaToApp: vi.fn(async () => ({})),
}))

vi.mock('@/lib/zernio/api', () => ({
  verifyZernioAccount: vi.fn(async () => ({ username: 'acme', displayName: 'Acme' })),
}))

import { GET, POST } from './route'

beforeEach(() => {
  callerAccountId = 'acct-1'
  callerRole = 'admin'
  existingConfigCount = 0
  insertedRows.length = 0
  listQueryAccountIds.length = 0
  supabaseMock = rlsSupabaseMock()
})

afterEach(() => {
  vi.clearAllMocks()
})

function postConfig(body: Record<string, unknown>) {
  return POST(
    new Request('http://localhost/api/whatsapp/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

describe('GET /api/whatsapp/config — multi-tenant isolation', () => {
  it('only ever queries the caller own account_id', async () => {
    callerAccountId = 'acct-other-company'
    const res = await GET()
    expect(res.status).toBe(200)
    // Never leaks a query scoped to a different account than the caller's.
    expect(listQueryAccountIds.every((id) => id === 'acct-other-company')).toBe(true)
    expect(listQueryAccountIds.length).toBeGreaterThan(0)
  })
})

describe('POST /api/whatsapp/config — default-connection invariant', () => {
  it("forces the account's very first connection to be the default even if the caller didn't ask", async () => {
    existingConfigCount = 0
    await postConfig({
      provider: 'meta',
      phone_number_id: 'pn-1',
      access_token: 'tok',
      is_default: false, // caller explicitly says no — server overrides anyway.
    })
    expect(insertedRows).toHaveLength(1)
    expect(insertedRows[0].is_default).toBe(true)
  })

  it('respects the caller-supplied is_default for a second connection', async () => {
    existingConfigCount = 1
    await postConfig({
      provider: 'meta',
      phone_number_id: 'pn-2',
      access_token: 'tok',
      // is_default omitted → defaults false, not forced true.
    })
    expect(insertedRows).toHaveLength(1)
    expect(insertedRows[0].is_default).toBe(false)
  })

  it('rejects a non-admin caller', async () => {
    callerRole = 'agent'
    const res = await postConfig({ provider: 'meta', phone_number_id: 'pn-1', access_token: 'tok' })
    expect(res.status).toBe(403)
    expect(insertedRows).toHaveLength(0)
  })
})
