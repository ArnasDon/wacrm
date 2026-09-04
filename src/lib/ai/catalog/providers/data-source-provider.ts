// ============================================================
// CatalogProvider backed by a structured Google Sheets / CSV data
// source (usage: catalog | both). Reads `ai_catalog_products`, the
// table `src/lib/ai/data-sources/service.ts` populates on refresh.
//
// This is the "GoogleSheetsCatalogProvider" from
// docs/integrations/ai-data-integration/01_MASTER_EXECUTION.md
// ("CATALOG PROVIDER") — named generically here because the same table
// backs any of the three source types (google_sheets/remote_csv/
// uploaded_csv), not just Sheets.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { encodeCatalogId } from '../id'
import { toCatalogProduct } from '../whitelist'
import { rankBySignificantTokens } from '../normalize'
import type {
  CatalogAvailability,
  CatalogMedia,
  CatalogProduct,
  CatalogProvider,
  CatalogSearchArgs,
  CatalogSearchResult,
} from '../types'

/** Cap on how many of this data source's rows the in-memory fallback
 *  tier (normalize.ts) scans when the DB-side exact/FTS search finds
 *  nothing. Bounds cost for large catalogs — see the module doc in
 *  normalize.ts for why this tier is TypeScript-side rather than SQL. */
const FALLBACK_SCAN_LIMIT = 500

interface CatalogProductRow {
  id: string
  source_product_id: string
  sku: string | null
  name: string
  brand: string | null
  model: string | null
  description: string | null
  color: string | null
  variant_label: string | null
  capacity: string | null
  size: string | null
  price: number | string | null
  currency: string | null
  available: boolean
  available_quantity: number | null
  primary_image_url: string | null
  images: { url: string; alt?: string }[] | null
}

/** Only present on rows returned by the search_ai_catalog_products RPC
 *  (migration 047) — count(*) OVER() computed over the FULL filtered
 *  set before LIMIT/OFFSET, so every row in one response carries the
 *  same true total. Absent (undefined) on rows read via plain
 *  `.select('*')` (getProduct, the fallback-tier scan). */
interface CatalogProductRowWithTotal extends CatalogProductRow {
  total_count?: number | string
}

/** Provider key prefix for structured-data-source-backed providers. See
 *  catalog/id.ts — must never contain a colon. */
export function dataSourceProviderKey(dataSourceId: string): string {
  return `ds_${dataSourceId}`
}

function rowToProduct(row: CatalogProductRow, providerKey: string, label: string): CatalogProduct {
  return toCatalogProduct({
    id: encodeCatalogId(providerKey, row.source_product_id),
    name: row.name,
    brand: row.brand,
    model: row.model,
    sku: row.sku,
    description: row.description,
    variants: row.variant_label ? [row.variant_label] : [],
    colors: row.color ? [row.color] : [],
    capacity: row.capacity,
    size: row.size,
    price: row.price === null ? null : Number(row.price),
    currency: row.currency,
    available: row.available,
    available_quantity: row.available_quantity,
    primary_image: row.primary_image_url ? { url: row.primary_image_url } : null,
    images: row.images ?? [],
    source: label,
  })
}

export class DataSourceCatalogProvider implements CatalogProvider {
  readonly key: string
  readonly label: string

  constructor(
    private readonly db: SupabaseClient,
    private readonly accountId: string,
    private readonly dataSourceId: string,
    displayName: string,
  ) {
    this.key = dataSourceProviderKey(dataSourceId)
    this.label = displayName
  }

  async searchCatalog(args: CatalogSearchArgs): Promise<CatalogSearchResult> {
    const limit = args.limit ?? 10
    const offset = args.offset ?? 0
    const { data, error } = await this.db.rpc('search_ai_catalog_products', {
      p_account_id: this.accountId,
      p_data_source_ids: [this.dataSourceId],
      p_query: args.query ?? '',
      p_color: args.color ?? null,
      p_match_count: limit,
      p_offset: offset,
      p_available_only: args.availableOnly ?? false,
    })
    if (error) {
      console.error('[catalog] data-source search failed:', error.message)
      return { products: [], total: null, hasMore: false }
    }
    const rows = (data ?? []) as CatalogProductRowWithTotal[]
    if (rows.length > 0) {
      const total = Number(rows[0].total_count ?? rows.length)
      return {
        products: rows.map((r) => rowToProduct(r, this.key, this.label)),
        total,
        hasMore: offset + rows.length < total,
      }
    }
    if (!args.query || !args.query.trim()) {
      return { products: [], total: 0, hasMore: false }
    }

    // Progressive fallback (AI_Catalog_Fix_Kit FASE 5): the DB-side
    // exact/FTS pass found nothing, e.g. `TCL de 50 pulgadas` against a
    // stored name of `TV TCL ... 50 ...` with no literal "pulgadas".
    // Scan this source's rows and rank by normalized/tolerant token
    // overlap instead of failing straight to "no encontrado".
    //
    // Falls through regardless of `offset`: the DB tier's WHERE clause
    // doesn't depend on offset for WHETHER anything matches, only which
    // slice is returned — so if it found zero rows at this query, it
    // would find zero at ANY offset too, and this is never reached in
    // practice with a non-zero offset anyway (the resolver, the only
    // real caller, always asks each provider for its own rows from 0 —
    // see catalog/resolver.ts's module doc). A direct caller that does
    // pass a non-zero offset here gets the tolerant tier's own
    // [offset, offset+limit) slice below, which is internally
    // consistent (same ranking every call for the same query).
    return this.fallbackSearch(args)
  }

  private async fallbackSearch(args: CatalogSearchArgs): Promise<CatalogSearchResult> {
    const limit = args.limit ?? 10
    const offset = args.offset ?? 0
    const { data, error } = await this.db
      .from('ai_catalog_products')
      .select('*')
      .eq('account_id', this.accountId)
      .eq('data_source_id', this.dataSourceId)
      // Deterministic base order — without it Postgres doesn't
      // guarantee the same row order across separate calls, and since
      // rankBySignificantTokens' sort is stable (ties keep INPUT
      // order), an undeterministic scan here would make pagination
      // within this tier flaky: the same row could land on two
      // different pages, or on neither, between the offset=0 and
      // offset=N calls of one "dame todas las X" listing.
      .order('id', { ascending: true })
      .limit(FALLBACK_SCAN_LIMIT)
    if (error || !data) {
      if (error) console.error('[catalog] fallback scan failed:', error.message)
      return { products: [], total: null, hasMore: false }
    }

    const rows = (data as CatalogProductRow[]).filter((r) => !args.availableOnly || r.available)
    const ranked = rankBySignificantTokens(
      args.query,
      rows,
      (r) => [r.name, r.sku, r.brand, r.model, r.color, r.capacity, r.size].filter(Boolean).join(' '),
    )
    const colorFiltered = args.color
      ? ranked.filter((m) => !m.item.color || m.item.color.toLowerCase().includes(args.color!.toLowerCase()))
      : ranked
    // Stable partition: available matches first, agotados after —
    // relative ranking order preserved within each group. Mirrors the
    // DB tier's `ORDER BY available DESC, rank DESC` (migration 047)
    // so a customer browsing ("qué tienen") never sees an agotado item
    // pushed ahead of an available one just because this particular
    // query happened to miss the DB-side FTS pass and land here
    // instead (AI Sales Agent audit, Part 9).
    const filtered = [...colorFiltered.filter((m) => m.item.available), ...colorFiltered.filter((m) => !m.item.available)]
    const page = filtered.slice(offset, offset + limit).map((m) => rowToProduct(m.item, this.key, this.label))
    // `total` here is honestly bounded by FALLBACK_SCAN_LIMIT — this
    // tier only ever scans the first 500 rows of the data source, so
    // for a source with more rows than that, a very broad query could
    // under-count. True for both `total` and `hasMore` alike; noted
    // rather than silently presented as exact.
    return { products: page, total: filtered.length, hasMore: offset + page.length < filtered.length }
  }

  async getProduct(nativeId: string): Promise<CatalogProduct | null> {
    const { data, error } = await this.db
      .from('ai_catalog_products')
      .select('*')
      .eq('account_id', this.accountId)
      .eq('data_source_id', this.dataSourceId)
      .eq('source_product_id', nativeId)
      .maybeSingle()
    if (error || !data) return null
    return rowToProduct(data as CatalogProductRow, this.key, this.label)
  }

  async getAvailability(nativeId: string): Promise<CatalogAvailability | null> {
    const product = await this.getProduct(nativeId)
    if (!product) return null
    return {
      productId: product.id,
      available: product.available,
      availableQuantity: product.availableQuantity,
    }
  }

  async getMedia(nativeId: string): Promise<CatalogMedia | null> {
    const product = await this.getProduct(nativeId)
    if (!product) return null
    return { productId: product.id, primaryImage: product.primaryImage, images: product.images }
  }
}
