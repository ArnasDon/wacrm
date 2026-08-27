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

  it('search_catalog forwards accountId + args and strips `source` from every result', async () => {
    h.searchCatalog.mockResolvedValue([PRODUCT])
    const result = (await execute({ id: 'c1', name: SEARCH_CATALOG, input: { query: 'S25', color: 'Negro' } })) as {
      products: unknown[]
    }
    expect(h.searchCatalog).toHaveBeenCalledWith({}, 'account-1', { query: 'S25', color: 'Negro', limit: 8 })
    expect(result.products).toHaveLength(1)
    expect(result.products[0]).not.toHaveProperty('source')
  })

  it('search_catalog with an empty query short-circuits without hitting the resolver', async () => {
    const result = await execute({ id: 'c1', name: SEARCH_CATALOG, input: { query: '  ' } })
    expect(h.searchCatalog).not.toHaveBeenCalled()
    expect(result).toEqual({ products: [] })
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

  it('ignores an account_id the caller tries to smuggle through tool input', async () => {
    h.searchCatalog.mockResolvedValue([])
    await execute({ id: 'c12', name: SEARCH_CATALOG, input: { query: 'x', account_id: 'someone-elses-account' } })
    // executeCatalogTool is bound to 'account-1' via closure — whatever
    // the model puts in `input` has no path to override it.
    expect(h.searchCatalog).toHaveBeenCalledWith({}, 'account-1', expect.anything())
  })
})
