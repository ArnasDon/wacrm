import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  updates: [] as Record<string, unknown>[],
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: vi.fn(async () => ({ accountId: 'acc-1', userId: 'user-1' })),
  toErrorResponse: vi.fn(() => Response.json({ error: 'auth' }, { status: 403 })),
}))

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => {
      let op = 'select'
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        update: (patch: Record<string, unknown>) => {
          op = 'update'
          h.updates.push(patch)
          return builder
        },
        delete: () => {
          op = 'delete'
          return builder
        },
        maybeSingle: () => Promise.resolve({ data: h.row, error: null }),
        then: (resolve: (v: { data: unknown; error: null }) => void) =>
          resolve({
            data: op === 'delete' ? (h.row ? [{ id: 'q' }] : []) : null,
            error: null,
          }),
      }
      return builder
    },
  }),
}))

import { DELETE, PATCH } from './route'

const ID = '3f2b8c1e-9a4d-4e2f-b6a1-0c9d8e7f6a5b'
const params = (id = ID) => ({ params: Promise.resolve({ id }) })

function patch(body: unknown) {
  return new Request(`http://localhost/api/quick-replies/${ID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  h.row = { kind: 'text', content_text: 'Hi', interactive_payload: null }
  h.updates = []
})

describe('/api/quick-replies/[id]', () => {
  it('PATCH returns 404 for a quick reply outside the account or missing', async () => {
    h.row = null
    const res = await PATCH(patch({ title: 'x' }), params())
    expect(res.status).toBe(404)
    expect(h.updates).toHaveLength(0)
  })

  it('PATCH returns 404 for a non-UUID id without querying', async () => {
    const res = await PATCH(patch({ title: 'x' }), params('nope'))
    expect(res.status).toBe(404)
  })

  it('PATCH rejects emptying a text snippet without a kind', async () => {
    const res = await PATCH(patch({ content_text: '' }), params())
    expect(res.status).toBe(400)
    expect(h.updates).toHaveLength(0)
  })

  it('PATCH writes a valid partial edit', async () => {
    const res = await PATCH(patch({ content_text: 'Hello' }), params())
    expect(res.status).toBe(200)
    expect(h.updates).toEqual([{ content_text: 'Hello' }])
  })

  it('DELETE returns 404 when nothing was deleted', async () => {
    h.row = null
    const res = await DELETE(new Request('http://localhost'), params())
    expect(res.status).toBe(404)
  })

  it('DELETE returns ok when the row was deleted', async () => {
    const res = await DELETE(new Request('http://localhost'), params())
    expect(res.status).toBe(200)
  })
})
