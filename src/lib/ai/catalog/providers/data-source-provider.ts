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
import type {
  CatalogAvailability,
  CatalogMedia,
  CatalogProduct,
  CatalogProvider,
  CatalogSearchArgs,
} from '../types'

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
    const { data, error } = await this.db.rpc('search_ai_catalog_products', {
      p_account_id: this.accountId,
      p_data_source_ids: [this.dataSourceId],
      p_query: args.query ?? '',
      p_color: args.color ?? null,
      p_match_count: args.limit ?? 10,
    })
    if (error) {
      console.error('[catalog] data-source search failed:', error.message)
      return []
    }
    return ((data ?? []) as CatalogProductRow[]).map((r) => rowToProduct(r, this.key, this.label))
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
