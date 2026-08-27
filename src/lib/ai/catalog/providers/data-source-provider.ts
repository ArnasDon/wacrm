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

  async searchCatalog(args: CatalogSearchArgs): Promise<CatalogProduct[]> {
    const limit = args.limit ?? 10
    const { data, error } = await this.db.rpc('search_ai_catalog_products', {
      p_account_id: this.accountId,
      p_data_source_ids: [this.dataSourceId],
      p_query: args.query ?? '',
      p_color: args.color ?? null,
      p_match_count: limit,
    })
    if (error) {
      console.error('[catalog] data-source search failed:', error.message)
      return []
    }
    const exact = ((data ?? []) as CatalogProductRow[]).map((r) => rowToProduct(r, this.key, this.label))
    if (exact.length > 0 || !args.query || !args.query.trim()) return exact

    // Progressive fallback (AI_Catalog_Fix_Kit FASE 5): the DB-side
    // exact/FTS pass found nothing, e.g. `TCL de 50 pulgadas` against a
    // stored name of `TV TCL ... 50 ...` with no literal "pulgadas".
    // Scan this source's rows and rank by normalized/tolerant token
    // overlap instead of failing straight to "no encontrado".
    return this.fallbackSearch(args)
  }

  private async fallbackSearch(args: CatalogSearchArgs): Promise<CatalogProduct[]> {
    const limit = args.limit ?? 10
    const { data, error } = await this.db
      .from('ai_catalog_products')
      .select('*')
      .eq('account_id', this.accountId)
      .eq('data_source_id', this.dataSourceId)
      .limit(FALLBACK_SCAN_LIMIT)
    if (error || !data) {
      if (error) console.error('[catalog] fallback scan failed:', error.message)
      return []
    }

    const rows = data as CatalogProductRow[]
    const ranked = rankBySignificantTokens(
      args.query,
      rows,
      (r) => [r.name, r.sku, r.brand, r.model, r.color, r.capacity, r.size].filter(Boolean).join(' '),
    )
    const filtered = args.color
      ? ranked.filter((m) => !m.item.color || m.item.color.toLowerCase().includes(args.color!.toLowerCase()))
      : ranked
    return filtered.slice(0, limit).map((m) => rowToProduct(m.item, this.key, this.label))
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
