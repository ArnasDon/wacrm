// ============================================================
// Provider-agnostic catalog types — the shape every CatalogProvider
// (BudunProvider, DataSourceCatalogProvider) must normalize into before
// anything reaches the resolver, the generic catalog tools, or the LLM.
//
// This is the single choke point described in
// docs/integrations/budun-erp/WACRM_ERP_CATALOG_INTEGRATION_SPEC_v4.md
// §6/§7 and docs/integrations/ai-data-integration/01_MASTER_EXECUTION.md
// "WHITELIST ERP": a provider's `search`/`getProduct`/... methods return
// ONLY these fields. There is no field here for IMEI/serial/cost/
// margin/supplier — a provider adapter cannot leak them because there is
// nowhere on `CatalogProduct` to put them, independent of whatever the
// upstream ERP/sheet actually returned.
// ============================================================

export interface CatalogImage {
  url: string
  alt?: string
}

export interface CatalogProduct {
  /** Composite id: `${providerKey}:${nativeId}` — see catalog/id.ts.
   *  Opaque to the LLM; used to route a follow-up get_product /
   *  get_availability / get_product_media call back to the exact same
   *  provider + row without a second free-text search (the "no mixing
   *  sources" guardrail). */
  id: string
  name: string
  brand: string | null
  model: string | null
  sku: string | null
  description: string | null
  /** Raw variant descriptor when the source doesn't break out
   *  color/capacity/size separately (e.g. "256GB Negro"). */
  variants: string[]
  colors: string[]
  capacity: string | null
  size: string | null
  price: number | null
  currency: string | null
  available: boolean
  availableQuantity: number | null
  primaryImage: CatalogImage | null
  images: CatalogImage[]
  /** Which provider resolved this row — surfaced to the resolver/tools
   *  for logging and the no-mixing guardrail, never sent to the LLM
   *  (the tool layer strips it before returning). */
  source: string
}

export interface CatalogSearchArgs {
  query: string
  color?: string
  limit?: number
  /** How many matching rows to skip — pagination for an exhaustive
   *  ("dame todas las TCL") follow-up. 0/undefined = first page. */
  offset?: number
  /** Opt-in stock filter. Never applied unless explicitly requested —
   *  a specific product/variant lookup must still surface an agotado
   *  item so the agent can say so honestly, rather than silently
   *  seeing nothing and guessing it doesn't exist. */
  availableOnly?: boolean
}

/**
 * search_catalog's real result shape (AI Sales Agent audit — Part 2):
 * a bare `CatalogProduct[]` gave the model no way to know whether it
 * was looking at the whole matching set or an arbitrary partial slice
 * of it, which is the root cause of "shows 2 KOOLHOME TVs and calls it
 * the full inventory" when other brands existed too.
 */
export interface CatalogSearchResult {
  products: CatalogProduct[]
  /** Total rows matching the query (after any availableOnly filter),
   *  independent of `limit`/`offset`. `null` when the provider can't
   *  report an exact count (e.g. an ERP search endpoint that doesn't
   *  return one) — callers must treat `null` as "unknown", never as
   *  zero or as "no more results". */
  total: number | null
  /** True when there are more matching rows beyond this page. Always
   *  computable even when `total` is null (falls back to "we got a
   *  full page, so there's likely more"). */
  hasMore: boolean
}

export interface CatalogAvailability {
  productId: string
  available: boolean
  availableQuantity: number | null
  /** Present when the source can break stock down by variant (color,
   *  capacity, ...). Absent means "aggregate only". */
  byVariant?: { label: string; availableQuantity: number | null; available: boolean }[]
}

export interface CatalogMedia {
  productId: string
  primaryImage: CatalogImage | null
  images: CatalogImage[]
}

export class CatalogError extends Error {
  readonly code: string
  constructor(message: string, code = 'catalog_error') {
    super(message)
    this.name = 'CatalogError'
    this.code = code
  }
}

/**
 * Common interface every catalog data source (ERP or structured
 * Sheet/CSV) implements. `key` is this provider instance's stable
 * identifier — used as the `id` prefix so results from different
 * providers are never ambiguous to a follow-up call.
 */
export interface CatalogProvider {
  readonly key: string
  readonly label: string
  searchCatalog(args: CatalogSearchArgs): Promise<CatalogSearchResult>
  getProduct(nativeId: string): Promise<CatalogProduct | null>
  getAvailability(nativeId: string): Promise<CatalogAvailability | null>
  getMedia(nativeId: string): Promise<CatalogMedia | null>
}
