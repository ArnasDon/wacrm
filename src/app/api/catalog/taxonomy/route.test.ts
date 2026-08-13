import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ requireRole: vi.fn() }))

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn((error: unknown) =>
    Response.json({ error: error instanceof Error ? error.message : 'error' }, { status: 500 }),
  ),
}))

import { GET, POST } from './route'

type TermRow = { id: string; account_id: string; kind: string; canonical_value: string; aliases: string[]; enabled: boolean }
type ProductRow = { category: string | null; color: string | null }

function fakeSupabase(terms: TermRow[], products: ProductRow[]) {
  const inserted: Record<string, unknown>[] = []
  return {
    inserted,
    from: (table: string) => {
      if (table === 'catalog_taxonomy_terms') {
        const chain = {
          select: () => chain,
          insert: (row: Record<string, unknown>) => {
            inserted.push(row)
            return chain
          },
          eq: () => chain,
          order: () => chain,
          single: () => Promise.resolve({ data: { id: 'new-term', ...inserted[0] }, error: null }),
          then: (resolve: (result: { data: TermRow[]; error: null }) => unknown) =>
            resolve({ data: terms, error: null }),
        }
        return chain
      }
      if (table === 'catalog_products') {
        const chain = {
          select: () => chain,
          eq: () => chain,
          then: (resolve: (result: { data: ProductRow[]; error: null }) => unknown) =>
            resolve({ data: products, error: null }),
        }
        return chain
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/catalog/taxonomy', () => {
  it("returns only this account's own terms with an approximate product count", async () => {
    const supabase = fakeSupabase(
      [
        { id: 't1', account_id: 'lc-account', kind: 'category', canonical_value: 'legging', aliases: ['leggings'], enabled: true },
      ],
      [{ category: 'Legging', color: null }, { category: 'legging', color: null }, { category: 'top', color: null }],
    )
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'lc-account' })

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.terms).toHaveLength(1)
    expect(body.terms[0].productCount).toBe(2)
  })
})

describe('POST /api/catalog/taxonomy — tenant scoping', () => {
  it('inserts the new term scoped to the caller own account_id', async () => {
    const supabase = fakeSupabase([], [])
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'car-rental-account' })

    const response = await POST(
      new Request('https://crm.test/api/catalog/taxonomy', {
        method: 'POST',
        body: JSON.stringify({ kind: 'category', canonical_value: 'SUV', aliases: ['jipe', 'crossover'] }),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(supabase.inserted[0]).toMatchObject({
      account_id: 'car-rental-account',
      kind: 'category',
      canonical_value: 'SUV',
      aliases: ['jipe', 'crossover'],
    })
    expect(body.term.productCount).toBe(0)
  })

  it('rejects a missing canonical_value', async () => {
    const supabase = fakeSupabase([], [])
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'lc-account' })

    const response = await POST(
      new Request('https://crm.test/api/catalog/taxonomy', {
        method: 'POST',
        body: JSON.stringify({ kind: 'category', canonical_value: '' }),
      }),
    )

    expect(response.status).toBe(500)
  })

  it('rejects an invalid kind', async () => {
    const supabase = fakeSupabase([], [])
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'lc-account' })

    const response = await POST(
      new Request('https://crm.test/api/catalog/taxonomy', {
        method: 'POST',
        body: JSON.stringify({ kind: 'size', canonical_value: 'M' }),
      }),
    )

    expect(response.status).toBe(400)
  })
})
