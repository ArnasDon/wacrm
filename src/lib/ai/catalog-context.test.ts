import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadCatalogContext } from './catalog-context'

function makeDb(
  products: { id?: string; name: string; price: number; description: string | null }[],
  defaultCurrency: string | undefined = 'USD',
  opts: { vertical?: string; rates?: unknown[] } = {},
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
      if (table === 'product_rates') {
        const chain = {
          select: () => chain,
          eq: () => chain,
          in: () => Promise.resolve({ data: opts.rates ?? [], error: null }),
        }
        return chain
      }
      // accounts
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: {
                  default_currency: defaultCurrency,
                  industry_vertical: opts.vertical ?? 'generic',
                },
                error: null,
              }),
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
    // Assert on structure, not the localized currency symbol: Intl
    // renders GTQ as "Q150" under an es-* runtime locale but "GTQ 150"
    // under en-* (the CI runner), and formatCurrency passes `undefined`
    // for the locale. Same reason the USD test below only checks "(".
    const res = await loadCatalogContext(
      makeDb([{ name: 'Camisa', price: 150, description: null }], 'GTQ'),
      'acct-1',
    )
    expect(res).toHaveLength(1)
    expect(res![0]).toMatch(/^- Camisa \(.*150\)/)
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

  it('shows a room rate structure for a hotel account', async () => {
    const res = await loadCatalogContext(
      makeDb(
        [{ id: 'r1', name: 'Hab 101', price: 0, description: 'Vista jardín' }],
        'GTQ',
        {
          vertical: 'hotel',
          rates: [
            { product_id: 'r1', weekday_group: 'weekday', occupancy: 'standard', price: 800, date_from: null, date_to: null },
            { product_id: 'r1', weekday_group: 'weekend', occupancy: 'standard', price: 1200, date_from: null, date_to: null },
            { product_id: 'r1', weekday_group: 'weekday', occupancy: 'couple', price: 950, date_from: null, date_to: null },
          ],
        },
      ),
      'acct-1',
    )
    expect(res).toHaveLength(1)
    expect(res![0]).toContain('Hab 101:')
    // comma/space in "1,200" varies by runtime locale — match loosely
    expect(res![0]).toMatch(/Lun–Jue .*800/)
    expect(res![0]).toMatch(/Vie–Dom .*1.?200/)
    expect(res![0]).toMatch(/pareja Lun–Jue .*950/)
    expect(res![0]).toContain('— Vista jardín')
  })

  it('a hotel product with no rates still shows its base price', async () => {
    const res = await loadCatalogContext(
      makeDb([{ id: 's1', name: 'Masaje', price: 250, description: null }], 'GTQ', {
        vertical: 'hotel',
        rates: [],
      }),
      'acct-1',
    )
    expect(res![0]).toMatch(/^- Masaje \(.*250\)/)
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
