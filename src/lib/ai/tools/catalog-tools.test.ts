import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CatalogAvailability, CatalogMedia, CatalogProduct } from '../catalog/types'

const h = vi.hoisted(() => ({
  searchCatalog: vi.fn(),
  getProduct: vi.fn(),
  getAvailability: vi.fn(),
  getProductMedia: vi.fn(),
}))

vi.mock('../catalog/resolver', () => ({
  searchCatalog: h.searchCatalog,
  getProduct: h.getProduct,
  getAvailability: h.getAvailability,
  getProductMedia: h.getProductMedia,
  // FASE 3 — executeCatalogTool's default parameter calls this to build
  // its own cache when the caller doesn't pass one; the resolver
  // functions above are mocked anyway, so the cache's actual shape is
  // never inspected here — only that it exists and is callable.
  createResolverCache: () => ({}),
  // External rate limiting (next phase after FASE 6) — catalog-tools.ts
  // compares a lookup's result against this sentinel via `import *`
  // namespace access; a mock that omits it makes that access throw
  // (Vitest's "no export defined on mock"), which the tool's own
  // try/catch then masks as a misleading `catalog_unavailable`. Same
  // literal value as the real export — see resolver.ts's doc.
  EXTERNAL_LIMIT_REACHED: 'external_limit_reached',
}))

import {
  executeCatalogTool,
  GET_AVAILABILITY,
  GET_PRODUCT,
  GET_PRODUCT_MEDIA,
  SEARCH_CATALOG,
} from './catalog-tools'

const PRODUCT: CatalogProduct = {
  id: 'ds_1:sku-1',
  name: 'Samsung Galaxy S25 256GB',
  brand: 'Samsung',
  model: 'S25',
  sku: 'SAM-S25-256',
  description: null,
  variants: [],
  colors: ['Negro'],
  capacity: '256GB',
  size: null,
  price: 34900,
  currency: 'DOP',
  available: true,
  availableQuantity: 4,
  primaryImage: { url: 'https://x/img.jpg' },
  images: [{ url: 'https://x/img.jpg' }],
  source: 'Test source', // internal — must not survive into the tool result
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('executeCatalogTool', () => {
  const execute = executeCatalogTool({} as never, 'account-1')

  it('search_catalog forwards accountId + args (with default limit/offset) and strips `source` from every result', async () => {
    h.searchCatalog.mockResolvedValue({ products: [PRODUCT], total: 1, hasMore: false })
    const result = (await execute({ id: 'c1', name: SEARCH_CATALOG, input: { query: 'S25', color: 'Negro' } })) as {
      products: unknown[]
      returned: number
      total: number | null
      has_more: boolean
    }
    expect(h.searchCatalog).toHaveBeenCalledWith(
      {},
      'account-1',
      {
        query: 'S25',
        color: 'Negro',
        limit: 20,
        offset: 0,
        availableOnly: false,
      },
      // FASE 3 — the shared ResolverCache this dispatch's executor
      // created; its identity is irrelevant here, only that one is
      // always passed through.
      expect.anything(),
    )
    expect(result.products).toHaveLength(1)
    expect(result.products[0]).not.toHaveProperty('source')
    expect(result.returned).toBe(1)
    expect(result.total).toBe(1)
    expect(result.has_more).toBe(false)
    // FASE 7 Caso 6: the tool result is the ONLY currency source the model
    // is allowed to quote — it must carry whatever the resolver returned,
    // never a hardcoded 'USD'.
    expect(result.products[0]).toMatchObject({ price: 34900, currency: 'DOP' })
  })

  it('search_catalog respects an explicit limit/offset/available_only, clamped to the safe range', async () => {
    h.searchCatalog.mockResolvedValue({ products: [PRODUCT], total: 47, hasMore: true })
    const result = (await execute({
      id: 'c1',
      name: SEARCH_CATALOG,
      input: { query: 'TCL', limit: 999, offset: 20, available_only: true },
    })) as { has_more: boolean; next_offset: number }
    expect(h.searchCatalog).toHaveBeenCalledWith(
      {},
      'account-1',
      {
        query: 'TCL',
        color: undefined,
        limit: 50, // clamped to MAX_SEARCH_LIMIT
        offset: 20,
        availableOnly: true,
      },
      expect.anything(),
    )
    // has_more=true must carry a next_offset the model can pass straight
    // back in as `offset` to continue an exhaustive listing.
    expect(result.has_more).toBe(true)
    expect(result.next_offset).toBe(21) // offset(20) + returned(1)
  })

  it('search_catalog with an empty query short-circuits without hitting the resolver', async () => {
    const result = await execute({ id: 'c1', name: SEARCH_CATALOG, input: { query: '  ' } })
    expect(h.searchCatalog).not.toHaveBeenCalled()
    expect(result).toEqual({ products: [], returned: 0, total: 0, has_more: false })
  })

  // ============================================================
  // Facets — AI optimization project, FASE 11. The resolver already
  // computes real facets (facets.test.ts/resolver.test.ts); this only
  // proves the tool surfaces them additively and never invents one.
  // ============================================================
  describe('facets', () => {
    it('search con facets: surfaces resolver.facets verbatim alongside the unchanged product/total/has_more shape', async () => {
      h.searchCatalog.mockResolvedValue({
        products: [PRODUCT],
        total: 1,
        hasMore: false,
        facets: { brands: ['Samsung'], colors: ['Negro'], priceRange: { min: 34900, max: 34900 } },
      })
      const result = (await execute({ id: 'c1', name: SEARCH_CATALOG, input: { query: 'S25' } })) as {
        products: unknown[]
        total: number
        has_more: boolean
        facets?: { brands?: string[] }
      }
      // Pre-existing shape is completely unchanged.
      expect(result.products).toHaveLength(1)
      expect(result.total).toBe(1)
      expect(result.has_more).toBe(false)
      expect(result.facets).toEqual({ brands: ['Samsung'], colors: ['Negro'], priceRange: { min: 34900, max: 34900 } })
    })

    it('search normal sin facets: omits the key entirely when the resolver found nothing to aggregate — never a fabricated empty object', async () => {
      h.searchCatalog.mockResolvedValue({ products: [], total: 0, hasMore: false })
      const result = await execute({ id: 'c1', name: SEARCH_CATALOG, input: { query: 'nada' } })
      expect(result).toEqual({ products: [], returned: 0, total: 0, has_more: false })
      expect(result).not.toHaveProperty('facets')
    })

    it('facets coexist correctly with external_limit_reached — Budun being skipped never blanks out real facets from another provider', async () => {
      h.searchCatalog.mockResolvedValue({
        products: [PRODUCT],
        total: 1,
        hasMore: false,
        externalLimitReached: true,
        facets: { brands: ['Samsung'] },
      })
      const result = (await execute({ id: 'c1', name: SEARCH_CATALOG, input: { query: 'S25' } })) as {
        external_limit_reached?: boolean
        facets?: { brands?: string[] }
      }
      expect(result.external_limit_reached).toBe(true)
      expect(result.facets).toEqual({ brands: ['Samsung'] })
    })
  })

  it('get_product returns {error: "not_found"} for an id the resolver can\'t match — never invents data', async () => {
    h.getProduct.mockResolvedValue(null)
    const result = await execute({ id: 'c2', name: GET_PRODUCT, input: { id: 'ds_x:fabricated' } })
    expect(result).toEqual({ error: 'not_found' })
  })

  it('get_product returns the whitelisted product on a real match', async () => {
    h.getProduct.mockResolvedValue(PRODUCT)
    const result = (await execute({ id: 'c3', name: GET_PRODUCT, input: { id: PRODUCT.id } })) as {
      product: Record<string, unknown>
    }
    expect(result.product.price).toBe(34900)
    // FASE 7 Caso 7: get_product must also pass the resolver's currency
    // through untouched — this is the value the AI response is required
    // to quote (e.g. "RD$34,900"), never a guessed or hardcoded one.
    expect(result.product.currency).toBe('DOP')
    expect(result.product).not.toHaveProperty('source')
  })

  it('get_availability passes the id straight through and surfaces not_found honestly', async () => {
    h.getAvailability.mockResolvedValue(null)
    expect(await execute({ id: 'c4', name: GET_AVAILABILITY, input: { id: 'nope' } })).toEqual({ error: 'not_found' })

    const availability: CatalogAvailability = { productId: PRODUCT.id, available: true, availableQuantity: 4 }
    h.getAvailability.mockResolvedValue(availability)
    expect(await execute({ id: 'c5', name: GET_AVAILABILITY, input: { id: PRODUCT.id } })).toEqual(availability)
  })

  it('get_product_media reports no_media_available instead of fabricating a photo', async () => {
    const noMedia: CatalogMedia = { productId: PRODUCT.id, primaryImage: null, images: [] }
    h.getProductMedia.mockResolvedValue(noMedia)
    const result = await execute({ id: 'c6', name: GET_PRODUCT_MEDIA, input: { id: PRODUCT.id } })
    expect(result).toEqual({ error: 'no_media_available' })
  })

  it('a missing/blank id on get_product/get_availability/get_product_media never reaches the resolver', async () => {
    await execute({ id: 'c7', name: GET_PRODUCT, input: {} })
    await execute({ id: 'c8', name: GET_AVAILABILITY, input: {} })
    await execute({ id: 'c9', name: GET_PRODUCT_MEDIA, input: {} })
    expect(h.getProduct).not.toHaveBeenCalled()
    expect(h.getAvailability).not.toHaveBeenCalled()
    expect(h.getProductMedia).not.toHaveBeenCalled()
  })

  it('swallows an infrastructure failure into a safe generic error, never the raw message', async () => {
    h.searchCatalog.mockRejectedValue(new Error('ECONNREFUSED 10.0.0.5:443 — internal ERP host'))
    const result = await execute({ id: 'c10', name: SEARCH_CATALOG, input: { query: 'S25' } })
    expect(result).toEqual({ error: 'catalog_unavailable' })
  })

  it('an unknown tool name returns a structured error instead of throwing', async () => {
    const result = await execute({ id: 'c11', name: 'search_budun', input: {} })
    expect(result).toEqual({ error: 'unknown tool: search_budun' })
  })

  it('shares ONE resolver cache across every tool call from the same executor (FASE 3)', async () => {
    h.searchCatalog.mockResolvedValue({ products: [PRODUCT], total: 1, hasMore: false })
    h.getProduct.mockResolvedValue(PRODUCT)
    h.getAvailability.mockResolvedValue({ productId: PRODUCT.id, available: true, availableQuantity: 4 })

    await execute({ id: 'a', name: SEARCH_CATALOG, input: { query: 'S25' } })
    await execute({ id: 'b', name: GET_PRODUCT, input: { id: PRODUCT.id } })
    await execute({ id: 'c', name: GET_AVAILABILITY, input: { id: PRODUCT.id } })

    const searchCache = h.searchCatalog.mock.calls[0][3]
    const productCache = h.getProduct.mock.calls[0][3]
    const availabilityCache = h.getAvailability.mock.calls[0][3]
    expect(searchCache).toBeDefined()
    // Same object reference — one resolution shared by the whole turn,
    // not a fresh cache (and thus a fresh DB round trip) per tool call.
    expect(productCache).toBe(searchCache)
    expect(availabilityCache).toBe(searchCache)
  })

  it('ignores an account_id the caller tries to smuggle through tool input', async () => {
    h.searchCatalog.mockResolvedValue([])
    await execute({ id: 'c12', name: SEARCH_CATALOG, input: { query: 'x', account_id: 'someone-elses-account' } })
    // executeCatalogTool is bound to 'account-1' via closure — whatever
    // the model puts in `input` has no path to override it.
    expect(h.searchCatalog).toHaveBeenCalledWith({}, 'account-1', expect.anything(), expect.anything())
  })

  // ============================================================
  // External catalog rate limiting — next phase after FASE 6. Covers
  // the tool-facing result shape (8) and the account_id-never-from-the-
  // model guarantee specifically for this new gate (9); the actual
  // budget/isolation mechanics are exercised end-to-end in
  // catalog/resolver.test.ts and rate-limit.test.ts.
  // ============================================================
  describe('external_limit_reached', () => {
    it('8. get_product/get_availability/get_product_media return a controlled, explicit error — never a fabricated result', async () => {
      h.getProduct.mockResolvedValue('external_limit_reached')
      h.getAvailability.mockResolvedValue('external_limit_reached')
      h.getProductMedia.mockResolvedValue('external_limit_reached')

      expect(await execute({ id: 'c13', name: GET_PRODUCT, input: { id: PRODUCT.id } })).toEqual({
        error: 'external_limit_reached',
      })
      expect(await execute({ id: 'c14', name: GET_AVAILABILITY, input: { id: PRODUCT.id } })).toEqual({
        error: 'external_limit_reached',
      })
      expect(await execute({ id: 'c15', name: GET_PRODUCT_MEDIA, input: { id: PRODUCT.id } })).toEqual({
        error: 'external_limit_reached',
      })
    })

    it('8b. a blocked-and-therefore-null-shaped result is NEVER reported as the generic "not_found" — the caller must be able to tell them apart', async () => {
      // Belt-and-braces against a future refactor accidentally collapsing
      // the sentinel back into a falsy/null check: the tool result for
      // the two cases must be textually distinct.
      h.getProduct.mockResolvedValue(null)
      const notFound = await execute({ id: 'c16', name: GET_PRODUCT, input: { id: 'x' } })
      h.getProduct.mockResolvedValue('external_limit_reached')
      const limited = await execute({ id: 'c17', name: GET_PRODUCT, input: { id: 'x' } })
      expect(notFound).not.toEqual(limited)
      expect(notFound).toEqual({ error: 'not_found' })
      expect(limited).toEqual({ error: 'external_limit_reached' })
    })

    it('8c. search_catalog surfaces external_limit_reached as additive metadata, never replacing real products from another provider', async () => {
      h.searchCatalog.mockResolvedValue({
        products: [PRODUCT],
        total: 1,
        hasMore: false,
        externalLimitReached: true,
      })
      const result = (await execute({ id: 'c18', name: SEARCH_CATALOG, input: { query: 'x' } })) as {
        products: unknown[]
        external_limit_reached?: boolean
      }
      // The real result from whatever OTHER provider actually ran is
      // untouched — this is metadata alongside it, not a replacement.
      expect(result.products).toHaveLength(1)
      expect(result.external_limit_reached).toBe(true)
    })

    it('search_catalog omits external_limit_reached entirely in the ordinary case — no shape change for existing callers', async () => {
      h.searchCatalog.mockResolvedValue({ products: [PRODUCT], total: 1, hasMore: false })
      const result = await execute({ id: 'c19', name: SEARCH_CATALOG, input: { query: 'x' } })
      expect(result).not.toHaveProperty('external_limit_reached')
    })

    it('9. account_id is never taken from tool input for this gate either — the resolver call is still keyed by the closure\'s accountId', async () => {
      h.getProduct.mockResolvedValue('external_limit_reached')
      await execute({
        id: 'c20',
        name: GET_PRODUCT,
        input: { id: PRODUCT.id, account_id: 'someone-elses-account', accountId: 'someone-elses-account' },
      })
      expect(h.getProduct).toHaveBeenCalledWith({}, 'account-1', PRODUCT.id, expect.anything())
    })
  })
})
