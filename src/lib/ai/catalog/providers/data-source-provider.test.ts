import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { DataSourceCatalogProvider } from './data-source-provider'

// ============================================================
// AI Sales Agent audit, Part 2/24 ("RESULTADOS PARCIALES"): this
// provider is the ONE place that turns a raw ai_catalog_products query
// into { products, total, hasMore } — the signal the agent needs to
// know it's looking at a partial page rather than "all we have".
// Previously untested directly (only indirectly, through a mocked
// stand-in, via resolver.test.ts).
// ============================================================

interface RpcCall {
  fn: string
  params: Record<string, unknown>
}

function fakeDb(opts: {
  rpcRows?: Record<string, unknown>[]
  rpcError?: { message: string } | null
  scanRows?: Record<string, unknown>[]
  scanError?: { message: string } | null
}) {
  const rpcCalls: RpcCall[] = []
  const db = {
    rpc: vi.fn(async (fn: string, params: Record<string, unknown>) => {
      rpcCalls.push({ fn, params })
      if (opts.rpcError) return { data: null, error: opts.rpcError }
      return { data: opts.rpcRows ?? [], error: null }
    }),
    from: (table: string) => {
      if (table !== 'ai_catalog_products') throw new Error(`unexpected table ${table}`)
      const filters: [string, unknown][] = []
      const api = {
        select: () => api,
        eq: (col: string, val: unknown) => {
          filters.push([col, val])
          return api
        },
        order: () => api,
        limit: () => Promise.resolve(opts.scanError ? { data: null, error: opts.scanError } : { data: opts.scanRows ?? [], error: null }),
        maybeSingle: () => {
          if (opts.scanError) return Promise.resolve({ data: null, error: opts.scanError })
          const sourceProductId = filters.find(([c]) => c === 'source_product_id')?.[1]
          const match = (opts.scanRows ?? []).find((r) => r.source_product_id === sourceProductId)
          return Promise.resolve({ data: match ?? null, error: null })
        },
      }
      return api
    },
  }
  return { db: db as unknown as SupabaseClient, rpcCalls }
}

function row(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'row-1',
    source_product_id: 'row-1',
    sku: null,
    name: 'TV TCL GOOGLE TV 50 4K',
    brand: 'TCL',
    model: null,
    description: null,
    color: null,
    variant_label: null,
    capacity: null,
    size: null,
    price: 25000,
    currency: 'DOP',
    available: true,
    available_quantity: 5,
    primary_image_url: null,
    images: [],
    ...over,
  }
}

describe('DataSourceCatalogProvider.searchCatalog — DB tier pagination', () => {
  it('Caso "resultados parciales": total=25, limit=10 → hasMore=true, total reported honestly', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => row({ id: `r${i}`, source_product_id: `r${i}`, total_count: 25 }))
    const { db, rpcCalls } = fakeDb({ rpcRows: rows })
    const provider = new DataSourceCatalogProvider(db, 'acct-1', 'ds-1', 'PRUEBA')

    const result = await provider.searchCatalog({ query: 'tv', limit: 10, offset: 0 })
    expect(result.products).toHaveLength(10)
    expect(result.total).toBe(25)
    expect(result.hasMore).toBe(true)
    expect(rpcCalls[0].params).toMatchObject({ p_match_count: 10, p_offset: 0, p_available_only: false })
  })

  it('the next page (offset=10) reflects the remaining rows and eventually hasMore=false', async () => {
    // Page 2 of 25: rows 10-19, still 5 more after this page.
    const rows = Array.from({ length: 10 }, (_, i) => row({ id: `r${10 + i}`, source_product_id: `r${10 + i}`, total_count: 25 }))
    const { db, rpcCalls } = fakeDb({ rpcRows: rows })
    const provider = new DataSourceCatalogProvider(db, 'acct-1', 'ds-1', 'PRUEBA')

    const result = await provider.searchCatalog({ query: 'tv', limit: 10, offset: 10 })
    expect(result.total).toBe(25)
    expect(result.hasMore).toBe(true) // 10 + 10 = 20 < 25
    expect(rpcCalls[0].params).toMatchObject({ p_offset: 10 })
  })

  it('the last page reports hasMore=false once offset+returned reaches total', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => row({ id: `r${20 + i}`, source_product_id: `r${20 + i}`, total_count: 25 }))
    const { db } = fakeDb({ rpcRows: rows })
    const provider = new DataSourceCatalogProvider(db, 'acct-1', 'ds-1', 'PRUEBA')

    const result = await provider.searchCatalog({ query: 'tv', limit: 10, offset: 20 })
    expect(result.hasMore).toBe(false) // 20 + 5 = 25, nothing left
    expect(result.total).toBe(25)
  })

  it('passes availableOnly through to the RPC as p_available_only', async () => {
    const { db, rpcCalls } = fakeDb({ rpcRows: [row({ total_count: 1 })] })
    const provider = new DataSourceCatalogProvider(db, 'acct-1', 'ds-1', 'PRUEBA')
    await provider.searchCatalog({ query: 'tv', availableOnly: true })
    expect(rpcCalls[0].params.p_available_only).toBe(true)
  })

  it('a genuinely empty result at offset 0 reports total=0, not null (a real "no matches")', async () => {
    const { db } = fakeDb({ rpcRows: [] })
    const provider = new DataSourceCatalogProvider(db, 'acct-1', 'ds-1', 'PRUEBA')
    const result = await provider.searchCatalog({ query: 'producto-inexistente-xyz' })
    expect(result.products).toEqual([])
    expect(result.total).toBe(0)
    expect(result.hasMore).toBe(false)
  })

  it('an RPC error degrades to an empty, honestly-unknown-total result instead of throwing', async () => {
    const { db } = fakeDb({ rpcError: { message: 'db down' } })
    const provider = new DataSourceCatalogProvider(db, 'acct-1', 'ds-1', 'PRUEBA')
    const result = await provider.searchCatalog({ query: 'tv' })
    expect(result).toEqual({ products: [], total: null, hasMore: false })
  })
})

describe('DataSourceCatalogProvider.searchCatalog — fallback tier (DB-side FTS found nothing)', () => {
  it('falls through to the tolerant ranker and reports a real total/hasMore for it too', async () => {
    const scanRows = [
      row({ id: 'r1', source_product_id: 'r1', name: 'TV TCL GOOGLE TV SMART 50 4K ULTRA HD' }),
      row({ id: 'r2', source_product_id: 'r2', name: 'TV TCL 55 QLED' }),
      row({ id: 'r3', source_product_id: 'r3', name: 'NEVERA WHIRLPOOL 15 PIES' }), // not a match
    ]
    const { db } = fakeDb({ rpcRows: [], scanRows })
    const provider = new DataSourceCatalogProvider(db, 'acct-1', 'ds-1', 'PRUEBA')

    // "TCL de 50 pulgadas" has no literal "pulgadas" in either TCL row —
    // exercises the exact scenario the fallback tier exists for.
    const result = await provider.searchCatalog({ query: 'tcl de 50 pulgadas', limit: 10 })
    expect(result.products.length).toBeGreaterThan(0)
    expect(result.products.every((p) => p.brand === 'TCL')).toBe(true)
    expect(result.total).toBe(result.products.length)
    expect(result.hasMore).toBe(false)
  })

  it('paginates within the fallback tier too (offset/limit applied after ranking)', async () => {
    const scanRows = Array.from({ length: 8 }, (_, i) =>
      row({ id: `r${i}`, source_product_id: `r${i}`, name: `TV TCL MODELO ${i} 50 PULGADAS` }),
    )
    const { db } = fakeDb({ rpcRows: [], scanRows })
    const provider = new DataSourceCatalogProvider(db, 'acct-1', 'ds-1', 'PRUEBA')

    const page1 = await provider.searchCatalog({ query: 'tcl', limit: 5, offset: 0 })
    expect(page1.products).toHaveLength(5)
    expect(page1.total).toBe(8)
    expect(page1.hasMore).toBe(true)

    const page2 = await provider.searchCatalog({ query: 'tcl', limit: 5, offset: 5 })
    expect(page2.products).toHaveLength(3)
    expect(page2.hasMore).toBe(false)
  })

  it('availableOnly excludes agotados from the fallback tier without hiding them from a specific lookup', async () => {
    const scanRows = [
      row({ id: 'r1', source_product_id: 'r1', name: 'TV TCL 50 DISPONIBLE', available: true, available_quantity: 3 }),
      row({ id: 'r2', source_product_id: 'r2', name: 'TV TCL 50 AGOTADA', available: false, available_quantity: 0 }),
    ]
    const { db } = fakeDb({ rpcRows: [], scanRows })
    const provider = new DataSourceCatalogProvider(db, 'acct-1', 'ds-1', 'PRUEBA')

    const onlyAvailable = await provider.searchCatalog({ query: 'tcl 50', availableOnly: true })
    expect(onlyAvailable.products).toHaveLength(1)
    expect(onlyAvailable.products[0].available).toBe(true)

    const everything = await provider.searchCatalog({ query: 'tcl 50' })
    expect(everything.products).toHaveLength(2) // the agotado one is still findable
  })

  it('without availableOnly, an available match still sorts BEFORE an agotado one — never hidden behind it (AI Sales Agent audit re-pass, Part 9)', async () => {
    // Deliberately inserted agotado-first, and the agotado row is a
    // "better" textual match (appears earlier alphabetically / matches
    // more tokens) than the available one, so a naive score-only sort
    // would put it first. Availability must win as the primary key,
    // same as the DB tier's `ORDER BY available DESC` (migration 047).
    const scanRows = [
      row({ id: 'r1', source_product_id: 'r1', name: 'TV TCL 50 4K AGOTADA', brand: 'TCL', available: false, available_quantity: 0 }),
      row({ id: 'r2', source_product_id: 'r2', name: 'TV TCL 50 QLED', brand: 'TCL', available: true, available_quantity: 4 }),
    ]
    const { db } = fakeDb({ rpcRows: [], scanRows })
    const provider = new DataSourceCatalogProvider(db, 'acct-1', 'ds-1', 'PRUEBA')

    const result = await provider.searchCatalog({ query: 'tcl 50' })
    expect(result.products).toHaveLength(2) // both still findable...
    expect(result.products[0].available).toBe(true) // ...but the available one leads
  })
})

describe('DataSourceCatalogProvider.searchCatalog — no-omission across brands (Part 24 "NO OMISIÓN" dataset)', () => {
  it('a broad "tv" query is not arbitrarily limited to the first brand — every real brand is reachable', async () => {
    // Reproduces the reported real-world bug: "qué TVs tienen" only
    // showing KOOLHOME when Samsung/TCL rows existed too. This dataset
    // has 3 real brands; the fallback tier's tolerant ranker must
    // surface all of them for a plain "tv" query, not silently prefer
    // one.
    const scanRows = [
      row({ id: 'k1', source_product_id: 'k1', name: 'TV KOOLHOME 32 SMART', brand: 'KOOLHOME' }),
      row({ id: 'k2', source_product_id: 'k2', name: 'TV KOOLHOME 43 4K', brand: 'KOOLHOME' }),
      row({ id: 's1', source_product_id: 's1', name: 'TV SAMSUNG 50 QLED', brand: 'Samsung' }),
      row({ id: 's2', source_product_id: 's2', name: 'TV SAMSUNG 55 CRYSTAL UHD', brand: 'Samsung' }),
      row({ id: 't1', source_product_id: 't1', name: 'TV TCL GOOGLE TV 50 4K ULTRA HD', brand: 'TCL' }),
      row({ id: 't2', source_product_id: 't2', name: 'TV TCL 65 QLED', brand: 'TCL' }),
      row({ id: 'n1', source_product_id: 'n1', name: 'NEVERA WHIRLPOOL 15 PIES', brand: 'Whirlpool' }), // not a TV
    ]
    const { db } = fakeDb({ rpcRows: [], scanRows })
    const provider = new DataSourceCatalogProvider(db, 'acct-1', 'ds-1', 'PRUEBA')

    const result = await provider.searchCatalog({ query: 'tv', limit: 20 })
    const brands = new Set(result.products.map((p) => p.brand))
    expect(brands.has('KOOLHOME')).toBe(true)
    expect(brands.has('Samsung')).toBe(true)
    expect(brands.has('TCL')).toBe(true)
    expect(brands.has('Whirlpool')).toBe(false) // the nevera correctly excluded
    expect(result.total).toBe(6) // all 6 TVs, not just one brand's
  })

  it('the same coverage holds for the "televisor"/"tele" synonyms, not just the literal word "tv"', async () => {
    const scanRows = [
      row({ id: 'k1', source_product_id: 'k1', name: 'TV KOOLHOME 32 SMART', brand: 'KOOLHOME' }),
      row({ id: 's1', source_product_id: 's1', name: 'TV SAMSUNG 50 QLED', brand: 'Samsung' }),
    ]
    const { db } = fakeDb({ rpcRows: [], scanRows })
    const provider = new DataSourceCatalogProvider(db, 'acct-1', 'ds-1', 'PRUEBA')

    for (const query of ['televisor', 'tele', 'television']) {
      const result = await provider.searchCatalog({ query, limit: 20 })
      const brands = new Set(result.products.map((p) => p.brand))
      expect(brands.has('KOOLHOME')).toBe(true)
      expect(brands.has('Samsung')).toBe(true)
    }
  })
})

describe('DataSourceCatalogProvider — getProduct/getAvailability/getMedia untouched by the pagination changes', () => {
  it('getProduct still resolves a single row by source_product_id', async () => {
    const { db } = fakeDb({ scanRows: [row({ id: 'r1', source_product_id: 'row-42', name: 'Producto X' })] })
    const provider = new DataSourceCatalogProvider(db, 'acct-1', 'ds-1', 'PRUEBA')
    const product = await provider.getProduct('row-42')
    expect(product?.name).toBe('Producto X')
  })
})
