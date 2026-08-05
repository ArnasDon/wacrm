import { beforeEach, describe, expect, it, vi } from 'vitest'

// /api/email/templates — GET (agent+) lista; POST (owner) upsert; DELETE (owner).

let callerRole = 'owner'
let listRows: Array<Record<string, unknown>> = []
let opError: { message?: string } | null = null
const upserted: Array<Record<string, unknown>> = []

function makeSupabaseMock() {
  function builder(table: string) {
    const b: Record<string, unknown> = {}
    const chain = () => b
    let op: 'select' | 'delete' = 'select'
    b.select = vi.fn(() => b)
    b.order = vi.fn(() => b)
    b.eq = vi.fn(() => b)
    b.upsert = vi.fn(async (payload: Record<string, unknown>) => {
      if (table === 'email_templates') upserted.push(payload)
      return opError ? { error: opError } : { error: null, data: null }
    })
    b.delete = vi.fn(() => {
      op = 'delete'
      return b
    })
    b.then = (resolve: (v: unknown) => unknown) => {
      if (op === 'delete') return resolve(opError ? { error: opError } : { error: null, data: null })
      return resolve(table === 'email_templates' ? { data: listRows, error: null } : { data: null, error: null })
    }
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

import { DELETE, GET, POST } from './route'

function post(body: unknown) {
  const req = new Request('http://localhost/api/email/templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(req as unknown as Parameters<typeof POST>[0])
}

beforeEach(() => {
  callerRole = 'owner'
  listRows = [{ id: 't1', name: 'welcome', subject: 'Hola', updated_at: 'x' }]
  opError = null
  upserted.length = 0
  supabaseMock = makeSupabaseMock()
})

describe('/api/email/templates', () => {
  it('GET lista templates del account (agent+)', async () => {
    callerRole = 'agent'
    const res = await GET()
    expect(res.status).toBe(200)
    expect((await res.json()).templates).toHaveLength(1)
  })

  it('POST upsert por (account_id, name)', async () => {
    const res = await post({ name: 'welcome', subject: 'Hola', body_html: '<p>hi</p>' })
    expect(res.status).toBe(200)
    expect(upserted[0]).toMatchObject({ account_id: 'acct-1', name: 'welcome', body_html: '<p>hi</p>' })
  })

  it('POST 400 si faltan campos', async () => {
    expect((await post({ name: 'x' })).status).toBe(400)
    expect((await post({ name: 'x', subject: 's' })).status).toBe(400)
  })

  it('DELETE por id y 400 sin id', async () => {
    const del = await DELETE(new Request('http://localhost/api/email/templates?id=t1') as unknown as Parameters<typeof DELETE>[0])
    expect(del.status).toBe(200)
    const noId = await DELETE(new Request('http://localhost/api/email/templates') as unknown as Parameters<typeof DELETE>[0])
    expect(noId.status).toBe(400)
  })
})