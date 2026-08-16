import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Multi-tenant isolation + role gating for the session-authenticated webhook
// management endpoint (mirrors src/app/api/whatsapp/config/route.test.ts's
// pattern from the multi-number work). Two things matter most:
//   1. GET only ever queries the caller's own account_id.
//   2. POST (create) is admin-gated and stores an encrypted secret while
//      returning the plaintext exactly once.
// ---------------------------------------------------------------------------

let callerAccountId = 'acct-1'
let callerRole = 'admin'
const insertedRows: Array<Record<string, unknown>> = []
const listQueryAccountIds: string[] = []

function rlsSupabaseMock() {
  function builder(table: string) {
    let didInsert = false
    let insertedRow: Record<string, unknown> | null = null

    const b: Record<string, unknown> = {}
    const chain = () => b
    for (const m of ['select', 'order']) b[m] = vi.fn(chain)

    b.eq = vi.fn((col: string, val: unknown) => {
      if (table === 'webhook_endpoints' && col === 'account_id') {
        listQueryAccountIds.push(val as string)
      }
      return b
    })

    b.insert = vi.fn((row: Record<string, unknown>) => {
      didInsert = true
      insertedRow = row
      insertedRows.push(row)
      return b
    })
    b.single = vi.fn(async () => ({
      data: { id: 'wh-1', ...insertedRow, secret: undefined },
      error: null,
    }))
    b.maybeSingle = vi.fn(async () => {
      if (table === 'profiles') {
        return { data: { account_id: callerAccountId, account_role: callerRole }, error: null }
      }
      if (table === 'accounts') {
        return { data: { id: callerAccountId, name: 'Acme' }, error: null }
      }
      return { data: null, error: null }
    })
    b.then = (resolve: (v: unknown) => unknown) => {
      if (didInsert) return resolve({ data: insertedRow, error: null })
      if (table === 'webhook_endpoints') {
        return resolve({
          data: [
            {
              id: 'wh-existing',
              url: 'https://existing.test/hook',
              events: ['message.received'],
              is_active: true,
              last_delivery_at: null,
              failure_count: 0,
              created_at: '2026-01-01T00:00:00Z',
            },
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

vi.mock('@/lib/whatsapp/encryption', () => ({
  encrypt: (v: string) => `enc:${v}`,
  decrypt: (v: string) => v.replace(/^enc:/, ''),
}))

import { GET, POST } from './route'

beforeEach(() => {
  callerAccountId = 'acct-1'
  callerRole = 'admin'
  insertedRows.length = 0
  listQueryAccountIds.length = 0
  supabaseMock = rlsSupabaseMock()
})

afterEach(() => {
  vi.clearAllMocks()
})

function postWebhook(body: Record<string, unknown>) {
  return POST(
    new Request('http://localhost/api/account/webhooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

describe('GET /api/account/webhooks — multi-tenant isolation', () => {
  it('only ever queries the caller own account_id', async () => {
    callerAccountId = 'acct-other-company'
    const res = await GET()
    expect(res.status).toBe(200)
    expect(listQueryAccountIds.every((id) => id === 'acct-other-company')).toBe(true)
    expect(listQueryAccountIds.length).toBeGreaterThan(0)
  })

  it('never returns the encrypted secret column', async () => {
    const res = await GET()
    const body = await res.json()
    expect(body.webhooks[0]).not.toHaveProperty('secret')
  })
})

describe('POST /api/account/webhooks — validation + admin gating', () => {
  it('rejects a non-https url', async () => {
    const res = await postWebhook({ url: 'http://insecure.test/hook', events: ['message.received'] })
    expect(res.status).toBe(400)
    expect(insertedRows).toHaveLength(0)
  })

  it('rejects an unknown event name', async () => {
    const res = await postWebhook({ url: 'https://ok.test/hook', events: ['not.a.real.event'] })
    expect(res.status).toBe(400)
    expect(insertedRows).toHaveLength(0)
  })

  it('stores the secret encrypted and returns the plaintext exactly once', async () => {
    const res = await postWebhook({ url: 'https://ok.test/hook', events: ['deal.won'] })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(typeof body.secret).toBe('string')
    expect(body.secret.startsWith('whsec_')).toBe(true)
    expect(insertedRows[0].secret).toBe(`enc:${body.secret}`)
    expect(insertedRows[0].account_id).toBe('acct-1')
  })

  it('rejects a non-admin caller', async () => {
    callerRole = 'agent'
    const res = await postWebhook({ url: 'https://ok.test/hook', events: ['deal.won'] })
    expect(res.status).toBe(403)
    expect(insertedRows).toHaveLength(0)
  })
})
