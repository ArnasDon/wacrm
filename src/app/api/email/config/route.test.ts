import { beforeEach, describe, expect, it, vi } from 'vitest'

// POST /api/email/config — owner-only. Encripta la key Resend y hace upsert.

let callerRole = 'owner'
let upsertError: { message?: string } | null = null
const upserted: Array<Record<string, unknown>> = []

function makeSupabaseMock() {
  function builder(table: string) {
    const b: Record<string, unknown> = {}
    const chain = () => b
    for (const m of ['select', 'eq', 'maybeSingle']) b[m] = vi.fn(chain)
    b.upsert = vi.fn(async (payload: Record<string, unknown>) => {
      if (table === 'email_config') upserted.push(payload)
      return upsertError ? { error: upsertError } : { error: null, data: null }
    })
    return b
  }
  return { from: vi.fn((table: string) => builder(table)) }
}

let supabaseMock = makeSupabaseMock()

vi.mock('@/lib/auth/account', async (importOriginal) => {
  const actual = (await importOriginal()) as { ForbiddenError: new (m: string) => Error }
  const RANK: Record<string, number> = { viewer: 0, agent: 1, admin: 2, owner: 3 }
  return {
    ...actual,
    requireRole: vi.fn(async (min: string) => {
      if (RANK[callerRole] < RANK[min]) throw new actual.ForbiddenError(`requires ${min}`)
      return { accountId: 'acct-1', role: callerRole, account: { id: 'acct-1', name: 'Acme' }, supabase: supabaseMock }
    }),
  }
})

vi.mock('@/lib/whatsapp/encryption', () => ({
  encrypt: vi.fn(() => 'enc-key'),
  decrypt: vi.fn(),
}))

import { POST } from './route'

function post(body: unknown) {
  const req = new Request('http://localhost/api/email/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(req as unknown as Parameters<typeof POST>[0])
}

beforeEach(() => {
  callerRole = 'owner'
  upsertError = null
  upserted.length = 0
  supabaseMock = makeSupabaseMock()
})

describe('POST /api/email/config', () => {
  it('requiere api_key y from_email', async () => {
    expect((await post({ api_key: 'k' })).status).toBe(400)
    expect((await post({ from_email: 'a@b.com' })).status).toBe(400)
  })

  it('encripta la key y hace upsert por account_id (owner)', async () => {
    const res = await post({ api_key: 're_123', from_email: 'Mi Pyme <hola@midominio.com>', reply_to: 'no-reply@midominio.com' })
    expect(res.status).toBe(200)
    expect(upserted).toHaveLength(1)
    expect(upserted[0]).toMatchObject({
      account_id: 'acct-1',
      resend_api_key_encrypted: 'enc-key',
      from_email: 'Mi Pyme <hola@midominio.com>',
      reply_to: 'no-reply@midominio.com',
    })
  })

  it('omite reply_to si no viene', async () => {
    await post({ api_key: 're_123', from_email: 'a@b.com' })
    expect(upserted[0]).not.toHaveProperty('reply_to')
  })

  it('permite solo owner', async () => {
    callerRole = 'agent'
    const res = await post({ api_key: 're_123', from_email: 'a@b.com' })
    expect([401, 403]).toContain(res.status)
    expect(upserted).toHaveLength(0)
  })
})