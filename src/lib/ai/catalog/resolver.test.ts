import { describe, it, expect, vi, beforeEach } from 'vitest'
import { __resetRateLimitForTests, checkCatalogExternalBudget, RATE_LIMITS } from '@/lib/rate-limit'
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
  // External rate limiting (next phase after FASE 6) — real
  // implementation, not a stub: resolver.ts calls this to tell a Budun
  // (external) provider apart from the internal ds_... one purely by
  // key prefix, and every fixture in this file already produces keys in
  // that exact real shape (`budun_...` / `ds_...`), so the real check
  // works unmodified against them.
  isBudunProviderKey: (key: string) => key.startsWith('budun_'),
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

// ============================================================
// AI optimization project, FASE 3 — resolveCatalogProviders is called
// independently by hasActiveCatalogSources/searchCatalog/getProduct/
// getAvailability/getProductMedia; within one turn that's up to 5
// redundant `ai_data_sources` queries for data that cannot have
// changed mid-turn. `ResolverCache` lets callers share one resolution
// across all of them, WITHOUT changing what gets returned or how
// fallback_policy/priority/primary ordering behave.
// ============================================================
describe('resolveCatalogProviders — per-dispatch cache (FASE 3)', () => {
  it('with no cache passed, every call resolves fresh — today\'s behavior, unchanged', async () => {
    const { db, capturedFilters } = fakeDb([
      { id: 'ds1', display_name: 'A', status: 'active', usage: 'catalog', priority: 1, is_primary: false, fallback_policy: 'fallback_on_not_found' },
    ])
    await resolver.hasActiveCatalogSources(db, 'acct-1')
    await resolver.resolveCatalogProviders(db, 'acct-1')
    expect(capturedFilters).toHaveLength(2)
  })

  it('with a shared cache, hasActiveCatalogSources + searchCatalog + getProduct + getAvailability + getProductMedia resolve providers exactly once', async () => {
    const { db, capturedFilters } = fakeDb([
      { id: 'ds1', display_name: 'A', status: 'active', usage: 'catalog', priority: 1, is_primary: false, fallback_policy: 'fallback_on_not_found' },
    ])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(h as any).dataSourceProviderFactory = (id: string) => fakeProvider(`ds_${id}`, [PRODUCT('ds_ds1:x', 'A')])

    const cache = resolver.createResolverCache()
    await resolver.hasActiveCatalogSources(db, 'acct-1', cache)
    await resolver.searchCatalog(db, 'acct-1', { query: 'S25' }, cache)
    await resolver.getProduct(db, 'acct-1', 'ds_ds1:x', cache)
    await resolver.getAvailability(db, 'acct-1', 'ds_ds1:x', cache)
    await resolver.getProductMedia(db, 'acct-1', 'ds_ds1:x', cache)

    expect(capturedFilters).toHaveLength(1)
  })

  it('a fresh cache never inherits another cache\'s resolution — no cross-dispatch leakage', async () => {
    const { db, capturedFilters } = fakeDb([
      { id: 'ds1', display_name: 'A', status: 'active', usage: 'catalog', priority: 1, is_primary: false, fallback_policy: 'fallback_on_not_found' },
    ])
    const cacheA = resolver.createResolverCache()
    const cacheB = resolver.createResolverCache()
    await resolver.resolveCatalogProviders(db, 'acct-1', cacheA)
    await resolver.resolveCatalogProviders(db, 'acct-1', cacheB)
    // Two independent dispatches (e.g. two separate inbound messages) —
    // each resolves once, exactly as if there were no cache at all.
    expect(capturedFilters).toHaveLength(2)
  })

  it('the cached resolution still respects fallback_policy / priority / primary ordering exactly as without a cache', async () => {
    const { db } = fakeDb([
      { id: 'dsA', display_name: 'A', status: 'active', usage: 'catalog', priority: 10, is_primary: false, fallback_policy: 'fallback_on_not_found' },
      { id: 'dsB', display_name: 'B', status: 'active', usage: 'catalog', priority: 100, is_primary: true, fallback_policy: 'fallback_on_not_found' },
    ])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(h as any).dataSourceProviderFactory = (id: string, displayName: string) => ({
      ...fakeProvider(`ds_${id}`, id === 'dsB' ? [PRODUCT('ds_dsB:x', displayName)] : []),
      label: displayName,
    })

    const cache = resolver.createResolverCache()
    const resolved = await resolver.resolveCatalogProviders(db, 'acct-1', cache)
    expect(resolved.map((r) => r.provider.label)).toEqual(['B', 'A']) // primary first, same as uncached

    const results = await resolver.searchCatalog(db, 'acct-1', { query: 'S25' }, cache)
    expect(results.products).toHaveLength(1)
    expect(results.products[0].source).toBe('B') // primary found it — A never reached, same as uncached
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
    // Internal (ds_...) provider — never gated by the external budget,
    // so this can never be the EXTERNAL_LIMIT_REACHED sentinel; narrow
    // the type the same way catalog-tools.ts does before reading a field.
    expect(product).not.toBe(resolver.EXTERNAL_LIMIT_REACHED)
    expect((product as CatalogProduct | null)?.source).toBe('ds2')
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

// ============================================================
// External catalog provider rate limiting — next phase after FASE 6.
// Only Budun-backed providers (key prefix `budun_`) are ever gated;
// the internal Sheet/CSV catalog (`ds_...`, DataSourceCatalogProvider)
// never touches RATE_LIMITS.catalogExternalAccount at all. Covers the
// scenarios from the mandatory matrix that need real resolver/provider
// wiring (4, 6, 7, 10) — the base budget primitive (1-3) is tested in
// rate-limit.test.ts, and the tool-facing result shape (8, 9) in
// tools/catalog-tools.test.ts.
// ============================================================
function spyBudunProvider(key: string, product: CatalogProduct): CatalogProvider & {
  searchCatalog: ReturnType<typeof vi.fn>
  getProduct: ReturnType<typeof vi.fn>
  getAvailability: ReturnType<typeof vi.fn>
  getMedia: ReturnType<typeof vi.fn>
} {
  return {
    key,
    label: key,
    searchCatalog: vi.fn(async () => ({ products: [product], total: 1, hasMore: false })),
    getProduct: vi.fn(async () => product),
    getAvailability: vi.fn(async () => ({ productId: product.id, available: true, availableQuantity: 3 })),
    getMedia: vi.fn(async () => ({ productId: product.id, primaryImage: product.primaryImage, images: product.images })),
  }
}

describe('external rate limiting (next phase after FASE 6)', () => {
  beforeEach(() => {
    __resetRateLimitForTests()
  })

  it('4. varias tool calls dentro de la misma interacción consumen el mismo presupuesto de cuenta', async () => {
    const { db } = fakeDb([])
    const budunProduct = PRODUCT('budun_int1:x', 'Budun')
    const spy = spyBudunProvider('budun_int1', budunProduct)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(h as any).integrationProviderFactory = () => spy
    h.integrations = [{ row: { id: 'int1', is_primary: true, priority: 1, display_name: 'Budun' }, secret: 's' }]

    // Simulates earlier tool calls THIS SAME turn having already spent
    // all but one unit of the account's budget.
    for (let i = 0; i < RATE_LIMITS.catalogExternalAccount.limit - 1; i++) checkCatalogExternalBudget('acct-1')

    // One unit left — the first resolver call this turn still succeeds…
    const first = await resolver.getProduct(db, 'acct-1', 'budun_int1:x')
    expect(first).toEqual(budunProduct)
    expect(spy.getProduct).toHaveBeenCalledTimes(1)

    // …but the very next resolver call, in the SAME turn, is blocked —
    // the shared per-account bucket is now exhausted.
    const second = await resolver.getAvailability(db, 'acct-1', 'budun_int1:x')
    expect(second).toBe(resolver.EXTERNAL_LIMIT_REACHED)
    expect(spy.getAvailability).not.toHaveBeenCalled()
  })

  it('6. el catálogo interno no queda bloqueado cuando el presupuesto externo de la cuenta está agotado', async () => {
    const { db } = fakeDb([
      { id: 'ds1', display_name: 'Interno', status: 'active', usage: 'catalog', priority: 1, is_primary: false, fallback_policy: 'search_all_active' },
    ])
    h.integrations = [{ row: { id: 'int1', is_primary: true, priority: 1, display_name: 'Budun' }, secret: 's' }]
    const budunProduct = PRODUCT('budun_int1:x', 'Budun')
    const internalProduct = PRODUCT('ds_ds1:y', 'Interno')
    const budunSpy = spyBudunProvider('budun_int1', budunProduct)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(h as any).integrationProviderFactory = () => budunSpy
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(h as any).dataSourceProviderFactory = () => fakeProvider('ds_ds1', [internalProduct])

    // Exhaust ONLY the external budget — a direct getProduct against the
    // internal (ds_) catalog must still work normally afterwards.
    for (let i = 0; i < RATE_LIMITS.catalogExternalAccount.limit; i++) checkCatalogExternalBudget('acct-1')

    const internal = await resolver.getProduct(db, 'acct-1', 'ds_ds1:y')
    expect(internal).toEqual(internalProduct)

    // A search that fans out across BOTH providers (search_all_active)
    // still returns the internal provider's REAL result — the external
    // one is skipped, not the whole search.
    const search = await resolver.searchCatalog(db, 'acct-1', { query: 'x' })
    expect(search.products).toEqual([internalProduct])
    expect(search.externalLimitReached).toBe(true)
    expect(budunSpy.searchCatalog).not.toHaveBeenCalled()
  })

  it('7. un bloqueo externo nunca inventa un producto/disponibilidad/media — devuelve el centinela, no un objeto fabricado', async () => {
    const { db } = fakeDb([])
    h.integrations = [{ row: { id: 'int1', is_primary: true, priority: 1, display_name: 'Budun' }, secret: 's' }]
    const budunProduct = PRODUCT('budun_int1:x', 'Budun')
    const spy = spyBudunProvider('budun_int1', budunProduct)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(h as any).integrationProviderFactory = () => spy
    for (let i = 0; i < RATE_LIMITS.catalogExternalAccount.limit; i++) checkCatalogExternalBudget('acct-1')

    expect(await resolver.getProduct(db, 'acct-1', 'budun_int1:x')).toBe(resolver.EXTERNAL_LIMIT_REACHED)
    expect(await resolver.getAvailability(db, 'acct-1', 'budun_int1:x')).toBe(resolver.EXTERNAL_LIMIT_REACHED)
    expect(await resolver.getProductMedia(db, 'acct-1', 'budun_int1:x')).toBe(resolver.EXTERNAL_LIMIT_REACHED)
  })

  it('10. Budun no recibe la llamada cuando el límite ya fue alcanzado', async () => {
    const { db } = fakeDb([])
    h.integrations = [{ row: { id: 'int1', is_primary: true, priority: 1, display_name: 'Budun' }, secret: 's' }]
    const budunProduct = PRODUCT('budun_int1:x', 'Budun')
    const spy = spyBudunProvider('budun_int1', budunProduct)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(h as any).integrationProviderFactory = () => spy
    for (let i = 0; i < RATE_LIMITS.catalogExternalAccount.limit; i++) checkCatalogExternalBudget('acct-1')

    await resolver.getProduct(db, 'acct-1', 'budun_int1:x')
    await resolver.getAvailability(db, 'acct-1', 'budun_int1:x')
    await resolver.getProductMedia(db, 'acct-1', 'budun_int1:x')
    await resolver.searchCatalog(db, 'acct-1', { query: 'x' })

    expect(spy.getProduct).not.toHaveBeenCalled()
    expect(spy.getAvailability).not.toHaveBeenCalled()
    expect(spy.getMedia).not.toHaveBeenCalled()
    expect(spy.searchCatalog).not.toHaveBeenCalled()
  })

  it('account isolation at the resolver level: acct-2\'s Budun calls succeed while acct-1\'s budget is exhausted', async () => {
    const { db } = fakeDb([])
    h.integrations = [{ row: { id: 'int1', is_primary: true, priority: 1, display_name: 'Budun' }, secret: 's' }]
    const budunProduct = PRODUCT('budun_int1:x', 'Budun')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(h as any).integrationProviderFactory = () => spyBudunProvider('budun_int1', budunProduct)
    for (let i = 0; i < RATE_LIMITS.catalogExternalAccount.limit; i++) checkCatalogExternalBudget('acct-1')

    expect(await resolver.getProduct(db, 'acct-1', 'budun_int1:x')).toBe(resolver.EXTERNAL_LIMIT_REACHED)
    expect(await resolver.getProduct(db, 'acct-2', 'budun_int1:x')).toEqual(budunProduct)
  })
})

// ============================================================
// Facets / catalog aggregations — AI optimization project, FASE 11.
// searchCatalog() computes facets from `collected` (every product every
// queried provider actually returned this call, merged, BEFORE the
// offset/limit slice) — see catalog/facets.ts for the pure aggregation
// logic itself (covered exhaustively in facets.test.ts). These tests
// focus on what's specific to THIS layer: merging across providers,
// respecting the external rate limit, and never duplicating work when
// a ResolverCache is shared.
// ============================================================
describe('searchCatalog — facets (FASE 11)', () => {
  beforeEach(() => {
    __resetRateLimitForTests()
  })

  it('1/2. search normal sin facets: an empty result never carries a facets key — shape unchanged', async () => {
    const { db } = fakeDb([])
    const results = await resolver.searchCatalog(db, 'acct-1', { query: 'nada' })
    expect(results).toEqual({ products: [], total: 0, hasMore: false })
    expect(results).not.toHaveProperty('facets')
  })

  it('search con facets: real values merged from the internal provider\'s results', async () => {
    const { db } = fakeDb([
      { id: 'ds1', display_name: 'A', status: 'active', usage: 'catalog', priority: 1, is_primary: false, fallback_policy: 'fallback_on_not_found' },
    ])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(h as any).dataSourceProviderFactory = (id: string) =>
      fakeProvider(`ds_${id}`, [
        { ...PRODUCT('ds_ds1:1', 'A'), brand: 'Samsung', colors: ['Negro'], price: 25000 },
        { ...PRODUCT('ds_ds1:2', 'A'), brand: 'TCL', colors: ['Blanco'], price: 18000 },
      ])

    const results = await resolver.searchCatalog(db, 'acct-1', { query: 'tv' })
    expect(results.facets?.brands).toEqual(['Samsung', 'TCL'])
    expect(results.facets?.colors).toEqual(['Blanco', 'Negro'])
    expect(results.facets?.priceRange).toEqual({ min: 18000, max: 25000 })
    // Unaffected pre-existing fields — purely additive.
    expect(results.products).toHaveLength(2)
  })

  it('9. catálogo interno: facets computed correctly from a DataSourceCatalogProvider-only search', async () => {
    const { db } = fakeDb([
      { id: 'ds1', display_name: 'Interno', status: 'active', usage: 'catalog', priority: 1, is_primary: false, fallback_policy: 'fallback_on_not_found' },
    ])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(h as any).dataSourceProviderFactory = (id: string) =>
      fakeProvider(`ds_${id}`, [{ ...PRODUCT('ds_ds1:1', 'Interno'), brand: 'LG' }])

    const results = await resolver.searchCatalog(db, 'acct-1', { query: 'tv' })
    expect(results.facets?.brands).toEqual(['LG'])
  })

  it('10. Budun: facets computed correctly from an external provider\'s results', async () => {
    const { db } = fakeDb([])
    h.integrations = [{ row: { id: 'int1', is_primary: true, priority: 1, display_name: 'Budun' }, secret: 's' }]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(h as any).integrationProviderFactory = () =>
      fakeProvider('budun_int1', [{ ...PRODUCT('budun_int1:1', 'Budun'), brand: 'Sony', colors: ['Plateado'] }])

    const results = await resolver.searchCatalog(db, 'acct-1', { query: 'tv' })
    expect(results.facets?.brands).toEqual(['Sony'])
    expect(results.facets?.colors).toEqual(['Plateado'])
  })

  it('11. Budun bajo external_limit_reached: facets reflect ONLY the internal provider that actually ran — Budun contributes nothing fabricated', async () => {
    const { db } = fakeDb([
      { id: 'ds1', display_name: 'Interno', status: 'active', usage: 'catalog', priority: 1, is_primary: false, fallback_policy: 'search_all_active' },
    ])
    h.integrations = [{ row: { id: 'int1', is_primary: true, priority: 1, display_name: 'Budun' }, secret: 's' }]
    const budunSpy = spyBudunProvider('budun_int1', { ...PRODUCT('budun_int1:1', 'Budun'), brand: 'Sony' })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(h as any).integrationProviderFactory = () => budunSpy
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(h as any).dataSourceProviderFactory = (id: string) =>
      fakeProvider(`ds_${id}`, [{ ...PRODUCT('ds_ds1:1', 'Interno'), brand: 'LG' }])

    for (let i = 0; i < RATE_LIMITS.catalogExternalAccount.limit; i++) checkCatalogExternalBudget('acct-1')

    const results = await resolver.searchCatalog(db, 'acct-1', { query: 'tv' })
    expect(results.externalLimitReached).toBe(true)
    // Only the internal brand — Sony (Budun's) never appears, because
    // Budun was never actually called.
    expect(results.facets?.brands).toEqual(['LG'])
    expect(budunSpy.searchCatalog).not.toHaveBeenCalled()
  })

  it('8. account isolation: acct-1 and acct-2 see only their own resolved providers\' facets', async () => {
    const { db } = fakeDb([
      { id: 'ds1', display_name: 'A', status: 'active', usage: 'catalog', priority: 1, is_primary: false, fallback_policy: 'fallback_on_not_found' },
    ])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(h as any).dataSourceProviderFactory = (id: string) =>
      fakeProvider(`ds_${id}`, [{ ...PRODUCT('ds_ds1:1', 'A'), brand: 'Samsung' }])

    const resultsA = await resolver.searchCatalog(db, 'acct-1', { query: 'tv' })
    const resultsB = await resolver.searchCatalog(db, 'acct-2', { query: 'tv' })
    // Same fake data source resolver (this test double isn't account-
    // partitioned itself), but the REAL guarantee this proves is that
    // searchCatalog never mixes/carries facets state BETWEEN two
    // separate calls for different accounts — each call computes its
    // own facets fresh, with no shared mutable cache in between.
    expect(resultsA.facets?.brands).toEqual(['Samsung'])
    expect(resultsB.facets?.brands).toEqual(['Samsung'])
    expect(resultsA.facets).not.toBe(resultsB.facets)
  })

  it('12. ResolverCache: sharing one cache across two searchCatalog calls in the same turn never duplicates or leaks facets between them', async () => {
    const { db } = fakeDb([
      { id: 'ds1', display_name: 'A', status: 'active', usage: 'catalog', priority: 1, is_primary: false, fallback_policy: 'fallback_on_not_found' },
    ])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(h as any).dataSourceProviderFactory = (id: string) =>
      fakeProvider(`ds_${id}`, [{ ...PRODUCT('ds_ds1:1', 'A'), brand: 'Samsung' }])

    const cache = resolver.createResolverCache()
    const first = await resolver.searchCatalog(db, 'acct-1', { query: 'tv' }, cache)
    const second = await resolver.searchCatalog(db, 'acct-1', { query: 'tv' }, cache)
    // Same real brand both times — the shared cache only memoizes WHICH
    // providers are active, never a stale/duplicated products list.
    expect(first.facets?.brands).toEqual(['Samsung'])
    expect(second.facets?.brands).toEqual(['Samsung'])
  })

  it('20. an ambiguous query that matches nothing never invents a facet', async () => {
    const { db } = fakeDb([
      { id: 'ds1', display_name: 'A', status: 'active', usage: 'catalog', priority: 1, is_primary: false, fallback_policy: 'fallback_on_not_found' },
    ])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(h as any).dataSourceProviderFactory = () => fakeProvider('ds_ds1', [])

    const results = await resolver.searchCatalog(db, 'acct-1', { query: 'algo que no existe' })
    expect(results.products).toEqual([])
    expect(results).not.toHaveProperty('facets')
  })
})
