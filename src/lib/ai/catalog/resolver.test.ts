import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CatalogProduct, CatalogProvider } from './types'

// ============================================================
// Resolver tests focus on the two guarantees the guardrails call out
// explicitly:
//   1. tenant isolation — every query is scoped by the accountId the
//      caller passed in, never by anything from tool-call input.
//   2. fallback_policy semantics (primary_only / fallback_on_not_found
//      / search_all_active) and provider routing by composite id, which
//      is the mechanism that makes "never mix sources" hold
//      structurally rather than by prompt wording alone.
// ============================================================

const h = vi.hoisted(() => ({
  integrations: [] as { row: { id: string; is_primary: boolean; priority: number; display_name: string }; secret: string }[],
  dataSourcesResult: { data: [] as unknown[], error: null as unknown },
}))

vi.mock('./integrations', () => ({
  loadActiveCatalogIntegrations: vi.fn(async () => h.integrations),
  buildBudunClient: vi.fn(() => ({})),
}))

function fakeProvider(key: string, products: CatalogProduct[]): CatalogProvider {
  return {
    key,
    label: key,
    async searchCatalog() {
      return { products, total: products.length, hasMore: false }
    },
    async getProduct(nativeId: string) {
      return products.find((p) => p.id.endsWith(nativeId)) ?? null
    },
    async getAvailability(nativeId: string) {
      const p = products.find((p2) => p2.id.endsWith(nativeId))
      return p ? { productId: p.id, available: p.available, availableQuantity: p.availableQuantity } : null
    },
    async getMedia(nativeId: string) {
      const p = products.find((p2) => p2.id.endsWith(nativeId))
      return p ? { productId: p.id, primaryImage: p.primaryImage, images: p.images } : null
    },
  }
}

// Constructor mocks — MUST be `function`, not an arrow, so `new
// BudunProvider(...)` / `new DataSourceCatalogProvider(...)` in the
// resolver's code under test can invoke them with `new`.
vi.mock('./providers/budun-provider', () => ({
  BudunProvider: vi.fn().mockImplementation(function (integrationId: string, displayName: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (h as any).integrationProviderFactory
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (h as any).integrationProviderFactory(integrationId, displayName)
      : fakeProvider(`budun_${integrationId}`, [])
  }),
}))

vi.mock('./providers/data-source-provider', () => ({
  DataSourceCatalogProvider: vi
    .fn()
    .mockImplementation(function (_db: unknown, _accountId: string, dataSourceId: string, displayName: string) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (h as any).dataSourceProviderFactory
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (h as any).dataSourceProviderFactory(dataSourceId, displayName)
        : fakeProvider(`ds_${dataSourceId}`, [])
    }),
  dataSourceProviderKey: (id: string) => `ds_${id}`,
}))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(h as any).integrationProviderFactory = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(h as any).dataSourceProviderFactory = null

import * as resolver from './resolver'

function fakeDb(dataSourceRows: unknown[]) {
  const capturedFilters: Record<string, unknown>[] = []
  const chain = {
    from: (table: string) => {
      if (table !== 'ai_data_sources') throw new Error(`unexpected table ${table}`)
      const filters: Record<string, unknown> = {}
      const c = {
        select: () => c,
        eq: (col: string, val: unknown) => {
          filters[col] = val
          return c
        },
        in: () => {
          capturedFilters.push({ ...filters })
          return Promise.resolve({ data: dataSourceRows, error: null })
        },
      }
      return c
    },
  }
  return { db: chain as unknown as Parameters<typeof resolver.resolveCatalogProviders>[0], capturedFilters }
}

const PRODUCT = (id: string, source: string): CatalogProduct => ({
  id,
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
  primaryImage: null,
  images: [],
  source,
})

beforeEach(() => {
  h.integrations = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(h as any).integrationProviderFactory = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(h as any).dataSourceProviderFactory = null
})

describe('resolveCatalogProviders — tenant isolation', () => {
  it('scopes the ai_data_sources query by the passed accountId, never by anything else', async () => {
    const { db, capturedFilters } = fakeDb([])
    await resolver.resolveCatalogProviders(db, 'account-xyz')
    expect(capturedFilters).toEqual([
      { account_id: 'account-xyz', status: 'active' },
    ])
  })

  it('returns no providers and hasActiveCatalogSources=false for an unconfigured account', async () => {
    const { db } = fakeDb([])
    const resolved = await resolver.resolveCatalogProviders(db, 'acct-1')
    expect(resolved).toEqual([])
    expect(await resolver.hasActiveCatalogSources(db, 'acct-1')).toBe(false)
  })
})

describe('searchCatalog — fallback policy', () => {
  it('primary_only never falls through to another source, even on an empty result', async () => {
    const { db } = fakeDb([
      { id: 'ds1', display_name: 'Primary', status: 'active', usage: 'catalog', priority: 1, is_primary: true, fallback_policy: 'primary_only' },
      { id: 'ds2', display_name: 'Secondary', status: 'active', usage: 'catalog', priority: 2, is_primary: false, fallback_policy: 'fallback_on_not_found' },
    ])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(h as any).dataSourceProviderFactory = (id: string) =>
      fakeProvider(`ds_${id}`, id === 'ds1' ? [] : [PRODUCT('ds_ds2:x', 'Secondary')])

    const results = await resolver.searchCatalog(db, 'acct-1', { query: 'S25' })
    expect(results.products).toEqual([]) // primary found nothing and the loop stopped there
    expect(results.total).toBe(0)
    expect(results.hasMore).toBe(false)
  })

  it('fallback_on_not_found tries the next source only when the primary found nothing', async () => {
    const { db } = fakeDb([
      { id: 'ds1', display_name: 'Primary', status: 'active', usage: 'catalog', priority: 1, is_primary: true, fallback_policy: 'fallback_on_not_found' },
      { id: 'ds2', display_name: 'Secondary', status: 'active', usage: 'catalog', priority: 2, is_primary: false, fallback_policy: 'fallback_on_not_found' },
    ])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(h as any).dataSourceProviderFactory = (id: string) =>
      fakeProvider(`ds_${id}`, id === 'ds1' ? [] : [PRODUCT('ds_ds2:x', 'Secondary')])

    const results = await resolver.searchCatalog(db, 'acct-1', { query: 'S25' })
    expect(results.products).toHaveLength(1)
    expect(results.products[0].source).toBe('Secondary')
  })

  it('search_all_active merges results (and totals) from every active source', async () => {
    const { db } = fakeDb([
      { id: 'ds1', display_name: 'A', status: 'active', usage: 'catalog', priority: 1, is_primary: true, fallback_policy: 'search_all_active' },
      { id: 'ds2', display_name: 'B', status: 'active', usage: 'catalog', priority: 2, is_primary: false, fallback_policy: 'search_all_active' },
    ])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(h as any).dataSourceProviderFactory = (id: string) => fakeProvider(`ds_${id}`, [PRODUCT(`ds_${id}:x`, id)])

    const results = await resolver.searchCatalog(db, 'acct-1', { query: 'S25' })
    expect(results.products.map((r) => r.source).sort()).toEqual(['ds1', 'ds2'])
    expect(results.total).toBe(2) // 1 product from each of the two merged sources
    expect(results.hasMore).toBe(false)
  })
})

// ============================================================
// "Fuente principal" is an explicit preference, never a requirement —
// the resolver must keep working when zero sources are marked
// is_primary, ordering purely by priority. See the inventory/data-
// sources unification pass, FASE 7/8: the agent must never end up
// unable to reach the catalog just because principalSource === null.
// ============================================================
describe('searchCatalog / resolveCatalogProviders — primary is optional', () => {
  it('Prueba 2: a single active catalog source with is_primary=false is used automatically — no primary required', async () => {
    const { db } = fakeDb([
      { id: 'prueba', display_name: 'PRUEBA', status: 'active', usage: 'catalog', priority: 100, is_primary: false, fallback_policy: 'fallback_on_not_found' },
    ])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(h as any).dataSourceProviderFactory = (id: string) => fakeProvider(`ds_${id}`, [PRODUCT('ds_prueba:x', 'PRUEBA')])

    const resolved = await resolver.resolveCatalogProviders(db, 'acct-1')
    expect(resolved).toHaveLength(1)
    expect(await resolver.hasActiveCatalogSources(db, 'acct-1')).toBe(true)

    const results = await resolver.searchCatalog(db, 'acct-1', { query: 'S25' })
    expect(results.products).toHaveLength(1)
    expect(results.products[0].source).toBe('PRUEBA')
  })

  it('Prueba 3: several active sources, none primary, are ordered and queried by priority ascending', async () => {
    const { db } = fakeDb([
      // Inserted out of priority order on purpose — the resolver, not
      // insertion order, must decide the query sequence.
      { id: 'dsC', display_name: 'C', status: 'active', usage: 'catalog', priority: 100, is_primary: false, fallback_policy: 'fallback_on_not_found' },
      { id: 'dsA', display_name: 'A', status: 'active', usage: 'catalog', priority: 10, is_primary: false, fallback_policy: 'fallback_on_not_found' },
      { id: 'dsB', display_name: 'B', status: 'active', usage: 'catalog', priority: 50, is_primary: false, fallback_policy: 'fallback_on_not_found' },
    ])
    const resolved = await resolver.resolveCatalogProviders(db, 'acct-1')
    expect(resolved.map((r) => r.priority)).toEqual([10, 50, 100])

    const queryOrder: string[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(h as any).dataSourceProviderFactory = (id: string, displayName: string) => ({
      key: `ds_${id}`,
      label: displayName,
      async searchCatalog() {
        queryOrder.push(displayName)
        return { products: [], total: 0, hasMore: false } // nothing found — forces fallback_on_not_found to keep going
      },
      async getProduct() { return null },
      async getAvailability() { return null },
      async getMedia() { return null },
    })

    await resolver.searchCatalog(db, 'acct-1', { query: 'S25' })
    expect(queryOrder).toEqual(['A', 'B', 'C']) // priority 10, then 50, then 100
  })

  it('Prueba 4: when a source IS marked primary, it is queried first regardless of its priority number', async () => {
    const { db } = fakeDb([
      { id: 'dsA', display_name: 'A', status: 'active', usage: 'catalog', priority: 10, is_primary: false, fallback_policy: 'fallback_on_not_found' },
      { id: 'dsB', display_name: 'B', status: 'active', usage: 'catalog', priority: 100, is_primary: true, fallback_policy: 'fallback_on_not_found' },
    ])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(h as any).dataSourceProviderFactory = (id: string, displayName: string) => ({
      ...fakeProvider(`ds_${id}`, id === 'dsB' ? [PRODUCT('ds_dsB:x', displayName)] : []),
      label: displayName,
    })

    const resolved = await resolver.resolveCatalogProviders(db, 'acct-1')
    expect(resolved.map((r) => r.provider.label)).toEqual(['B', 'A']) // primary first despite higher priority number

    const results = await resolver.searchCatalog(db, 'acct-1', { query: 'S25' })
    expect(results.products).toHaveLength(1)
    expect(results.products[0].source).toBe('B') // primary found it — never even reached A
  })
})

describe('by-id routing — no source mixing', () => {
  it('getProduct routes to the exact provider encoded in the id, ignoring every other active source', async () => {
    const { db } = fakeDb([
      { id: 'ds1', display_name: 'A', status: 'active', usage: 'catalog', priority: 1, is_primary: false, fallback_policy: 'fallback_on_not_found' },
      { id: 'ds2', display_name: 'B', status: 'active', usage: 'catalog', priority: 2, is_primary: false, fallback_policy: 'fallback_on_not_found' },
    ])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(h as any).dataSourceProviderFactory = (id: string) => fakeProvider(`ds_${id}`, [PRODUCT(`ds_${id}:x`, id)])

    const product = await resolver.getProduct(db, 'acct-1', 'ds_ds2:x')
    expect(product?.source).toBe('ds2')
  })

  it('returns null for a fabricated / stale id that decodes but matches no active provider', async () => {
    const { db } = fakeDb([])
    expect(await resolver.getProduct(db, 'acct-1', 'ds_nonexistent:x')).toBeNull()
    expect(await resolver.getAvailability(db, 'acct-1', 'ds_nonexistent:x')).toBeNull()
    expect(await resolver.getProductMedia(db, 'acct-1', 'ds_nonexistent:x')).toBeNull()
  })

  it('returns null for a malformed id (no provider prefix) rather than guessing', async () => {
    const { db } = fakeDb([
      { id: 'ds1', display_name: 'A', status: 'active', usage: 'catalog', priority: 1, is_primary: false, fallback_policy: 'fallback_on_not_found' },
    ])
    expect(await resolver.getProduct(db, 'acct-1', 'just-a-sku')).toBeNull()
  })
})
