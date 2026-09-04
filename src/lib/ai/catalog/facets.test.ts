import { describe, it, expect } from 'vitest'
import { computeFacets } from './facets'
import type { CatalogProduct } from './types'

// ============================================================
// computeFacets — AI optimization project, FASE 11. Pure function, no
// DB, no network — every case is a plain input/output assertion, same
// convention as routing.test.ts/handoff-intent.test.ts. Covers the
// "facets con catálogo vacío / una sola marca / múltiples marcas /
// datos incompletos / no inventar valores" items of the mandatory
// matrix; the resolver/tool-level scenarios (Budun, external limit,
// ResolverCache, account isolation) live in resolver.test.ts and
// catalog-tools.test.ts instead.
// ============================================================

function product(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    id: 'ds_1:sku-1',
    name: 'TV Samsung 50"',
    brand: 'Samsung',
    model: '50Q60',
    sku: 'SKU-1',
    description: null,
    variants: [],
    colors: ['Negro'],
    capacity: null,
    size: '50"',
    price: 25000,
    currency: 'DOP',
    available: true,
    availableQuantity: 3,
    primaryImage: null,
    images: [],
    source: 'Catálogo',
    ...overrides,
  }
}

describe('computeFacets — empty catalog', () => {
  it('2. returns undefined for an empty product list — never an empty {} object', () => {
    expect(computeFacets([])).toBeUndefined()
  })
})

describe('computeFacets — a single value per dimension', () => {
  it('3. a single product yields single-value facets, all real', () => {
    const facets = computeFacets([product()])
    expect(facets).toEqual({
      brands: ['Samsung'],
      colors: ['Negro'],
      sizes: ['50"'],
      priceRange: { min: 25000, max: 25000 },
      stock: { inStock: 1, outOfStock: 0 },
    })
    // No categories key — CatalogProduct has no such field anywhere;
    // inventing one would violate the "no fabricar datos" rule.
    expect(facets).not.toHaveProperty('categories')
    // No capacities key either — none of the fixture products set it.
    expect(facets).not.toHaveProperty('capacities')
  })
})

describe('computeFacets — multiple values per dimension', () => {
  it('4. multiple distinct brands are all reported, sorted, deduped', () => {
    const facets = computeFacets([
      product({ brand: 'Samsung' }),
      product({ brand: 'TCL' }),
      product({ brand: 'Samsung' }), // duplicate — must not appear twice
      product({ brand: 'LG' }),
    ])
    expect(facets?.brands).toEqual(['LG', 'Samsung', 'TCL'])
  })

  it('colors are flattened across the array field, deduped', () => {
    const facets = computeFacets([
      product({ colors: ['Negro', 'Blanco'] }),
      product({ colors: ['Negro'] }),
      product({ colors: ['Azul'] }),
    ])
    expect(facets?.colors).toEqual(['Azul', 'Blanco', 'Negro'])
  })

  it('price range spans the real min/max among matching products', () => {
    const facets = computeFacets([
      product({ price: 18000 }),
      product({ price: 25000 }),
      product({ price: 21000 }),
    ])
    expect(facets?.priceRange).toEqual({ min: 18000, max: 25000 })
  })

  it('stock counts in/out of stock correctly', () => {
    const facets = computeFacets([
      product({ available: true }),
      product({ available: true }),
      product({ available: false }),
    ])
    expect(facets?.stock).toEqual({ inStock: 2, outOfStock: 1 })
  })
})

describe('computeFacets — incomplete data (6)', () => {
  it('products missing a field are skipped for THAT facet, never fabricated or crashing', () => {
    const facets = computeFacets([
      product({ brand: 'Samsung', colors: [], capacity: null, price: 25000 }),
      product({ brand: null, colors: ['Negro'], capacity: '128GB', price: null }),
    ])
    expect(facets?.brands).toEqual(['Samsung']) // the null-brand product contributes nothing
    expect(facets?.colors).toEqual(['Negro']) // the empty-colors product contributes nothing
    expect(facets?.capacities).toEqual(['128GB'])
    // Only one product had a real price — range collapses to that one value, never invented.
    expect(facets?.priceRange).toEqual({ min: 25000, max: 25000 })
    // stock is always computable (every product has a real boolean).
    expect(facets?.stock).toEqual({ inStock: 2, outOfStock: 0 })
  })

  it('omits a facet key entirely when NO product has real data for it — never an empty array', () => {
    const facets = computeFacets([
      product({ brand: null, colors: [], capacity: null, size: null, price: null }),
    ])
    expect(facets).not.toHaveProperty('brands')
    expect(facets).not.toHaveProperty('colors')
    expect(facets).not.toHaveProperty('capacities')
    expect(facets).not.toHaveProperty('sizes')
    expect(facets).not.toHaveProperty('priceRange')
    // stock is the one facet that's always present (boolean, never absent).
    expect(facets?.stock).toEqual({ inStock: 1, outOfStock: 0 })
  })

  it('blank-string values are treated the same as null — never surfaced as a real facet value', () => {
    const facets = computeFacets([product({ brand: '   ', colors: [''] })])
    expect(facets).not.toHaveProperty('brands')
    expect(facets).not.toHaveProperty('colors')
  })
})

describe('computeFacets — never invents values (7)', () => {
  it('only values that literally appear on a real product are ever reported', () => {
    const facets = computeFacets([product({ brand: 'Samsung', colors: ['Negro'] })])
    // Exact real values only — nothing resembling a "typical phone
    // colors" guess (Azul/Blanco/Rojo) ever appears.
    expect(facets?.brands).toEqual(['Samsung'])
    expect(facets?.colors).toEqual(['Negro'])
    expect(facets?.brands).not.toContain('Apple')
    expect(facets?.colors).not.toContain('Azul')
  })

  it('caps each string facet at 50 distinct values rather than growing unbounded', () => {
    const products = Array.from({ length: 60 }, (_, i) => product({ brand: `Marca${i}` }))
    const facets = computeFacets(products)
    expect(facets?.brands).toHaveLength(50)
  })
})
