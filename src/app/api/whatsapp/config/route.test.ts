import { beforeEach, describe, expect, it, vi } from 'vitest'

let callerRole = 'admin'
let signedIn = true

const configInserts: Record<string, unknown>[] = []
const configUpdates: Record<string, unknown>[] = []
let configDeletes = 0

const STORED_CONFIG = {
  id: 'cfg-1',
  phone_number_id: '111222333',
  waba_id: '444555666',
  access_token: 'enc-token',
  status: 'connected',
  registered_at: null,
  verify_token: null,
}

let storedConfig: Omit<typeof STORED_CONFIG, 'registered_at'> & {
  registered_at: string | null
} | null = null

function makeSupabaseMock() {
  function builder(table: string) {
    const result = () => {
      switch (table) {
        case 'profiles':
          return {
            data: { account_id: 'acct-1', account_role: callerRole },
            error: null,
          }
        case 'accounts':
          return { data: { id: 'acct-1', name: 'Acme' }, error: null }
        case 'whatsapp_config':
          return { data: storedConfig, error: null }
        default:
          return { data: null, error: null }
      }
    }

    const b: Record<string, unknown> = {}
    const chain = () => b
    for (const m of ['select', 'eq', 'neq']) b[m] = vi.fn(chain)
    b.insert = vi.fn((row: Record<string, unknown>) => {
      if (table === 'whatsapp_config') configInserts.push(row)
      return b
    })
    b.update = vi.fn((patch: Record<string, unknown>) => {
      if (table === 'whatsapp_config') configUpdates.push(patch)
      return b
    })
    b.delete = vi.fn(() => {
      if (table === 'whatsapp_config') configDeletes += 1
      return b
    })
    b.single = vi.fn(async () => result())
    b.maybeSingle = vi.fn(async () => result())
    b.then = (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null })
    return b
  }

  return {
    auth: {
      getUser: vi.fn(async () =>
        signedIn
          ? { data: { user: { id: 'user-1' } }, error: null }
          : { data: { user: null }, error: { message: 'no session' } },
      ),
    },
    from: vi.fn((table: string) => builder(table)),
  }
}

let supabaseMock = makeSupabaseMock()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => supabaseMock),
}))

const serviceRole = vi.hoisted(() => ({ lookups: 0 }))

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => {
      serviceRole.lookups += 1
      const b: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'neq']) b[m] = vi.fn(() => b)
      b.maybeSingle = vi.fn(async () => ({ data: null, error: null }))
      return b
    }),
  })),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: vi.fn(() => 'plaintext-token'),
  encrypt: vi.fn(() => 'enc-token'),
}))

const meta = vi.hoisted(() => ({
  verifyPhoneNumber: vi.fn(async () => ({ id: '111222333', display_phone_number: '+1 555 0100' })),
  listWabaPhoneNumbers: vi.fn(async () => [{ id: '111222333' }]),
  registerPhoneNumber: vi.fn(async () => ({ success: true })),
  subscribeWabaToApp: vi.fn(async () => ({ success: true })),
  getSubscribedApps: vi.fn(async () => []),
}))
vi.mock('@/lib/whatsapp/meta-api', () => meta)

import { DELETE, GET, POST } from './route'
import { __resetRateLimitForTests } from '@/lib/rate-limit'

function saveConfig(overrides: Record<string, unknown> = {}) {
  return POST(
    new Request('http://localhost/api/whatsapp/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone_number_id: '111222333',
        waba_id: '444555666',
        access_token: 'caller-supplied-token',
        pin: '123456',
        ...overrides,
      }),
    }),
  )
}

function metaCallCount() {
  return (
    meta.verifyPhoneNumber.mock.calls.length +
    meta.listWabaPhoneNumbers.mock.calls.length +
    meta.registerPhoneNumber.mock.calls.length +
    meta.subscribeWabaToApp.mock.calls.length +
    meta.getSubscribedApps.mock.calls.length
  )
}

beforeEach(() => {
  __resetRateLimitForTests()
  callerRole = 'admin'
  signedIn = true
  storedConfig = null
  configInserts.length = 0
  configUpdates.length = 0
  configDeletes = 0
  serviceRole.lookups = 0
  supabaseMock = makeSupabaseMock()
  for (const fn of Object.values(meta)) fn.mockClear()
})

describe('POST /api/whatsapp/config', () => {
  it.each(['viewer', 'agent'])('refuses the %s role before any Meta call', async (role) => {
    callerRole = role

    const res = await saveConfig()

    expect(res.status).toBe(403)
    expect(metaCallCount()).toBe(0)
    expect(serviceRole.lookups).toBe(0)
    expect(configInserts).toHaveLength(0)
    expect(configUpdates).toHaveLength(0)
  })

  it('answers 401 without a session and calls nothing', async () => {
    signedIn = false

    const res = await saveConfig()

    expect(res.status).toBe(401)
    expect(metaCallCount()).toBe(0)
    expect(serviceRole.lookups).toBe(0)
  })

  it.each(['admin', 'owner'])('lets the %s role verify, register, subscribe and save', async (role) => {
    callerRole = role

    const res = await saveConfig()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ success: true, saved: true, registered: true })
    expect(meta.verifyPhoneNumber).toHaveBeenCalledTimes(1)
    expect(meta.listWabaPhoneNumbers).toHaveBeenCalledTimes(1)
    expect(meta.registerPhoneNumber).toHaveBeenCalledTimes(1)
    expect(meta.subscribeWabaToApp).toHaveBeenCalledTimes(1)
    expect(configInserts).toHaveLength(1)
    expect(configInserts[0]).toMatchObject({ account_id: 'acct-1', user_id: 'user-1' })
  })
})

describe('POST /api/whatsapp/config registration state', () => {
  const REGISTERED_AT = '2026-01-01T00:00:00.000Z'

  it('clears registered_at when the phone number changes and no PIN is given', async () => {
    storedConfig = { ...STORED_CONFIG, registered_at: REGISTERED_AT }
    meta.verifyPhoneNumber.mockResolvedValueOnce({
      id: '999888777',
      display_phone_number: '+1 555 0199',
    })
    meta.listWabaPhoneNumbers.mockResolvedValueOnce([{ id: '999888777' }])

    const res = await saveConfig({ phone_number_id: '999888777', pin: undefined })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      success: true,
      saved: true,
      registered: false,
      registration_skipped: true,
    })
    expect(meta.registerPhoneNumber).not.toHaveBeenCalled()
    expect(configUpdates).toHaveLength(1)
    expect(configUpdates[0]).toMatchObject({
      phone_number_id: '999888777',
      registered_at: null,
    })
  })

  it('keeps registered_at when the same registered number is saved without a PIN', async () => {
    storedConfig = { ...STORED_CONFIG, registered_at: REGISTERED_AT }

    const res = await saveConfig({ pin: undefined })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ success: true, registered: true, registration_skipped: false })
    expect(meta.registerPhoneNumber).not.toHaveBeenCalled()
    expect(configUpdates[0]).toMatchObject({ registered_at: REGISTERED_AT })
  })
})

describe('DELETE /api/whatsapp/config', () => {
  it.each(['viewer', 'agent'])('refuses the %s role and deletes nothing', async (role) => {
    callerRole = role
    storedConfig = STORED_CONFIG

    const res = await DELETE()

    expect(res.status).toBe(403)
    expect(configDeletes).toBe(0)
  })

  it('lets an admin reset the configuration', async () => {
    storedConfig = STORED_CONFIG

    const res = await DELETE()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
    expect(configDeletes).toBe(1)
  })
})

describe('GET /api/whatsapp/config', () => {
  it('stays readable for a viewer and never returns the token', async () => {
    callerRole = 'viewer'
    storedConfig = STORED_CONFIG

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.connected).toBe(true)
    expect(JSON.stringify(body)).not.toContain('plaintext-token')
    expect(JSON.stringify(body)).not.toContain('enc-token')
  })
})
