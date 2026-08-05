import { beforeEach, describe, expect, it, vi } from 'vitest'

// GET /api/email/templates/[id] — carga un template con body_html (agent+).

let templateRow: Record<string, unknown> | null = null

function makeSupabaseMock() {
  function builder(table: string) {
    const b: Record<string, unknown> = {}
    const chain = () => b
    b.select = vi.fn(() => b)
    b.eq = vi.fn(() => b)
    b.maybeSingle = vi.fn(async () =>
      table === 'email_templates'
        ? { data: templateRow, error: null }
        : { data: null, error: null },
    )
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
      if (RANK.agent < RANK[min]) throw new actual.ForbiddenError(`requires ${min}`)
      return { accountId: 'acct-1', role: 'agent', account: { id: 'acct-1', name: 'Acme' }, supabase: supabaseMock }
    }),
  }
})

import { GET } from './route'

function get(id: string) {
  return GET(new Request(`http://localhost/api/email/templates/${id}`) as never, {
    params: Promise.resolve({ id }),
  })
}

beforeEach(() => {
  templateRow = {
    id: 't1',
    name: 'welcome',
    subject: 'Hola',
    body_html: '<h1>hola</h1>',
    updated_at: 'x',
  }
  supabaseMock = makeSupabaseMock()
})

describe('GET /api/email/templates/[id]', () => {
  it('devuelve el template con body_html', async () => {
    const res = await get('t1')
    expect(res.status).toBe(200)
    const json = (await res.json()) as { template: Record<string, unknown> }
    expect(json.template).toMatchObject({ name: 'welcome', body_html: '<h1>hola</h1>' })
  })

  it('404 cuando el template no existe o no es del account', async () => {
    templateRow = null
    const res = await get('nope')
    expect(res.status).toBe(404)
  })
})