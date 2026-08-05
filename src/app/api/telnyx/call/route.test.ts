import { beforeEach, describe, expect, it, vi } from 'vitest'

// POST /api/telnyx/call — marca al contacto (salida). agent+.
// Mockeamos requireRole (devuelve ctx con supabase) y la lib telnyx.

let callerRole = 'agent'
let contactRow: { id: string; phone: string } | null = null
let dialError: Error | null = null
let cfgConnectionId = 'ccapp-1'
let callInsertError: { message?: string } | null = null
const dialedResult = { callControlId: 'ctrl-1', callLegId: 'leg-1', callSessionId: 'sess-1' }

function makeSupabaseMock() {
  function builder(table: string) {
    const b: Record<string, unknown> = {}
    const chain = () => b
    for (const m of ['select', 'eq', 'order', 'limit']) b[m] = vi.fn(chain)
    b.maybeSingle = vi.fn(async () =>
      table === 'contacts'
        ? { data: contactRow, error: null }
        : { data: null, error: null },
    )
    b.insert = vi.fn(async (_p: unknown) =>
      callInsertError ? { error: callInsertError } : { error: null, data: null },
    )
    return b
  }
  return { from: vi.fn((table: string) => builder(table)) }
}

let supabaseMock = makeSupabaseMock()

vi.mock('@/lib/auth/account', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    requireRole: vi.fn(async () => ({
      accountId: 'acct-1',
      accountRole: callerRole,
      supabase: supabaseMock,
    })),
  }
})

const dial = vi.fn(async (_opts: unknown) => dialedResult)
vi.mock('@/lib/telnyx/api', () => ({
  createTelnyxClient: vi.fn(() => ({ dial })),
  loadTelnyxDialConfig: vi.fn(async () => ({
    apiKey: 'key-1',
    connectionId: cfgConnectionId,
    fromNumber: '+15550000001',
  })),
}))

import { POST } from './route'

function post(body: unknown) {
  const req = new Request('http://localhost/api/telnyx/call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(req as unknown as Parameters<typeof POST>[0])
}

beforeEach(() => {
  callerRole = 'agent'
  contactRow = { id: 'contact-1', phone: '+15551234567' }
  dialError = null
  cfgConnectionId = 'ccapp-1'
  callInsertError = null
  supabaseMock = makeSupabaseMock()
  dial.mockClear()
})

describe('POST /api/telnyx/call', () => {
  it('dialea al contacto e inserta la fila outbound vía ctx.supabase', async () => {
    const res = await post({ contactId: 'contact-1' })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toEqual({ ok: true, callControlId: 'ctrl-1' })
    expect(dial).toHaveBeenCalledTimes(1)
    expect(dial.mock.calls[0][0]).toMatchObject({ to: '+15551234567', connectionId: 'ccapp-1' })

    const insertCall = supabaseMock.from.mock.calls.find(([t]) => t === 'calls')
    expect(insertCall).toBeTruthy()
  })

  it('404 cuando el contacto no es del account', async () => {
    contactRow = null
    const res = await post({ contactId: 'contact-x' })
    expect(res.status).toBe(404)
    expect(dial).not.toHaveBeenCalled()
  })

  it('400 si falta Telnyx Call Control App config', async () => {
    cfgConnectionId = ''
    const res = await post({ contactId: 'contact-1' })
    expect(res.status).toBe(400)
    expect(dial).not.toHaveBeenCalled()
  })

  it('400 con bad body y 400 si la llamada no se pudo loguear', async () => {
    const badReq = new Request('http://localhost/api/telnyx/call', { method: 'POST' })
    const bad = await POST(badReq as unknown as Parameters<typeof POST>[0])
    expect(bad.status).toBe(400)

    callInsertError = { message: 'rlx' }
    const res = await post({ contactId: 'contact-1' })
    expect(res.status).toBe(500)
  })
})