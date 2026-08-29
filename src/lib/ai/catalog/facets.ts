// ============================================================
// Catalog facets — AI optimization project, FASE 11.
//
// Computed EXCLUSIVELY from `CatalogProduct[]` rows a search already
// fetched — never a second query, never a second HTTP call to Budun,
// never a new RPC. This is a deliberate design choice (not a shortcut):
// docs/integrations/ai-data-integration audits and this phase's own
// authorization both prioritize "reuse what was already obtained" over
// a technically-more-complete-but-costlier full-catalog aggregation.
// Every value here is read straight off the whitelisted CatalogProduct
// shape (catalog/whitelist.ts already stripped everything not on that
// allow-list) — a facet can therefore never surface a field the
// whitelist wouldn't already allow onto a product.
//
// HONESTY: facets reflect only the products THIS search call actually
// examined (catalog/resolver.ts passes it the same `collected` array
// used to build the page/total/has_more result) — exactly the same
// "partial view, not the whole catalog" caveat `has_more` already
// carries for `products` itself. Never treat facets as an exhaustive
// list of every value that could ever exist in the catalog.
// ============================================================

import type { CatalogProduct } from './types'

/** Cap on how many distinct values one facet reports — keeps the tool
 *  result small/stable even for a data source with an unusually wide
 *  spread of brands/colors (analogous in spirit to MAX_SEARCH_LIMIT,
 *  but deliberately a SEPARATE constant: this bounds a facet array's
 *  size, not a page of products, and the two must never be conflated
 *  or accidentally share a knob). */
const MAX_FACET_VALUES = 50

export interface CatalogPriceRange {
  min: number
  max: number
}

export interface CatalogStockSummary {
  inStock: number
  outOfStock: number
}

/**
 * Real, distinct aggregations over one search's matching products.
 * Every field is OPTIONAL and omitted (never an empty array/zero-ed
 * object) when there is nothing real to report — e.g. no product in
 * this result had a brand, or none had a price — so the agent can tell
 * "not asked for" apart from "confirmed absent" apart from "no data".
 * There is deliberately NO `categories` field: `CatalogProduct` has no
 * category column anywhere in the provider contract (see catalog/
 * types.ts) — inventing one here would violate the "no fabricar datos"
 * rule this phase was explicitly built to protect.
 */
export interface CatalogFacets {
  brands?: string[]
  colors?: string[]
  capacities?: string[]
  sizes?: string[]
  priceRange?: CatalogPriceRange
  stock?: CatalogStockSummary
}

function distinctSorted(values: (string | null | undefined)[]): string[] | undefined {
  const set = new Set<string>()
  for (const raw of values) {
    const v = raw?.trim()
    if (v) set.add(v)
  }
  if (set.size === 0) return undefined
  return [...set].sort((a, b) => a.localeCompare(b)).slice(0, MAX_FACET_VALUES)
}

/**
 * Aggregate real facets from a set of already-fetched products. Returns
 * `undefined` (never an empty `{}`) when there's nothing to report —
 * callers should omit the `facets` field entirely in that case, the
 * same discipline already used for `externalLimitReached`.
 */
export function computeFacets(products: CatalogProduct[]): CatalogFacets | undefined {
  if (products.length === 0) return undefined

  const facets: CatalogFacets = {}

  const brands = distinctSorted(products.map((p) => p.brand))
  if (brands) facets.brands = brands

  const colors = distinctSorted(products.flatMap((p) => p.colors))
  if (colors) facets.colors = colors

  const capacities = distinctSorted(products.map((p) => p.capacity))
  if (capacities) facets.capacities = capacities

  const sizes = distinctSorted(products.map((p) => p.size))
  if (sizes) facets.sizes = sizes

  const prices = products
    .map((p) => p.price)
    .filter((p): p is number => typeof p === 'number' && Number.isFinite(p))
  if (prices.length > 0) {
    facets.priceRange = { min: Math.min(...prices), max: Math.max(...prices) }
  }

  // Stock is a plain count, not a "distinct values" facet — always
  // computable (every product has a real boolean `available`), so
  // unlike the string facets above it's included whenever there's at
  // least one product, even if every one of them is in (or out of)
  // stock.
  const inStock = products.filter((p) => p.available).length
  facets.stock = { inStock, outOfStock: products.length - inStock }

  return facets
}
