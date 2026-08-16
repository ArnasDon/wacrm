import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadCatalogContext } from './catalog-context'

function makeDb(
  products: { name: string; price: number; description: string | null }[],
  defaultCurrency = 'USD',
) {
  const db = {
    from: (table: string) => {
      if (table === 'products') {
        const chain = {
          select: () => chain,
          eq: () => chain,
          order: () => chain,
          limit: () => Promise.resolve({ data: products, error: null }),
        }
        return chain
      }
      // accounts
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: { default_currency: defaultCurrency }, error: null }),
          }),
        }),
      }
    },
  }
  return db as unknown as SupabaseClient
}

describe('loadCatalogContext', () => {
  it('returns null when the account has no active products', async () => {
    const res = await loadCatalogContext(makeDb([]), 'acct-1')
    expect(res).toBeNull()
  })

  it('formats each product with its currency-formatted price', async () => {
    // Non-breaking-space-tolerant, matching src/lib/currency.test.ts's
    // convention — Intl may insert an NBSP between symbol and amount.
    const res = await loadCatalogContext(
      makeDb([{ name: 'Camisa', price: 150, description: null }], 'GTQ'),
      'acct-1',
    )
    expect(res).toHaveLength(1)
    expect(res![0]).toContain('- Camisa (Q')
    expect(res![0]).toContain('150)')
  })

  it('appends a short description when present', async () => {
    const res = await loadCatalogContext(
      makeDb([{ name: 'Camisa', price: 150, description: 'Algodón 100%' }], 'GTQ'),
      'acct-1',
    )
    expect(res).toHaveLength(1)
    expect(res![0]).toContain('— Algodón 100%')
  })

  it('truncates a long description instead of blowing up the prompt', async () => {
    const longDesc = 'x'.repeat(200)
    const res = await loadCatalogContext(
      makeDb([{ name: 'Camisa', price: 150, description: longDesc }], 'GTQ'),
      'acct-1',
    )
    expect(res![0].length).toBeLessThan(longDesc.length)
    expect(res![0]).toContain('…')
  })

  it('falls back to USD when the account has no default_currency', async () => {
    const res = await loadCatalogContext(
      makeDb([{ name: 'Widget', price: 10, description: null }], undefined),
      'acct-1',
    )
    expect(res).toHaveLength(1)
    expect(res![0]).toContain('- Widget (')
    expect(res![0]).toContain('10')
  })
})
