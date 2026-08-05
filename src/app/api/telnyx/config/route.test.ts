import { beforeEach, describe, expect, it, vi } from 'vitest'

// POST /api/telnyx/config — owner-only. Valida la key, la encripta y hace upsert.

let callerRole = 'owner'
let listError: Error | null = null
let upsertError: { message?: string } | null = null
const upserted: Array<Record<string, unknown>> = []

function makeSupabaseMock() {
  function builder(table: string) {
    const b: Record<string, unknown> = {}
    const chain = () => b
    for (const m of ['select', 'eq', 'maybeSingle']) b[m] = vi.fn(chain)
    b.upsert = vi.fn(async (payload: Record<string, unknown>) => {
      if (table === 'telnyx_config') upserted.push(payload)
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
      if (RANK[callerRole] < RANK[min]) {
        throw new actual.ForbiddenError(`requires ${min}`)
      }
      return {
        accountId: 'acct-1',
        role: callerRole,
        account: { id: 'acct-1', name: 'Acme' },
        supabase: supabaseMock,
      }
    }),
  }
})

vi.mock('@/lib/whatsapp/encryption', () => ({
  encrypt: vi.fn(() => 'enc-key'),
  decrypt: vi.fn(),
}))

const listPhoneNumbers = vi.fn(async () => [{ id: 'n1' }])
vi.mock('@/lib/telnyx/api', () => ({
  createTelnyxClient: vi.fn(() => ({ listPhoneNumbers })),
}))

import { POST } from './route'

function post(body: unknown) {
  const req = new Request('http://localhost/api/telnyx/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(req as unknown as Parameters<typeof POST>[0])
}

beforeEach(() => {
  callerRole = 'owner'
  listError = null
  upsertError = null
  upserted.length = 0
  supabaseMock = makeSupabaseMock()
  listPhoneNumbers.mockClear()
})

describe('POST /api/telnyx/config', () => {
  it('requiere api_key', async () => {
    const res = await post({})
    expect(res.status).toBe(400)
  })

  it('rechaza una key inválida antes de guardar', async () => {
    listPhoneNumbers.mockRejectedValueOnce(new Error('401'))
    const res = await post({ api_key: 'bad' })
    expect(res.status).toBe(400)
    expect(upserted).toHaveLength(0)
  })

  it('valida, encripta y hace upsert por account_id (owner)', async () => {
    const res = await post({
      api_key: 'key-1',
      default_from_number: '+15550000001',
      call_control_app_id: 'ccapp-1',
      messaging_profile_id: 'mp-1',
    })
    expect(res.status).toBe(200)
    expect(upserted).toHaveLength(1)
    expect(upserted[0]).toMatchObject({
      account_id: 'acct-1',
      api_key_encrypted: 'enc-key',
      messaging_profile_id: 'mp-1',
    })
  })

  it('permite solo owner', async () => {
    callerRole = 'agent'
    const res = await post({ api_key: 'key-1' })
    expect([401, 403]).toContain(res.status)
    expect(upserted).toHaveLength(0)
  })
})