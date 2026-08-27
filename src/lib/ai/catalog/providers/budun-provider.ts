// ============================================================
// BudunProvider — CatalogProvider adapter for Budun ERP.
//
// Per docs/integrations/budun-erp/WACRM_ERP_CATALOG_INTEGRATION_SPEC_v4.md
// §4 ("Provider vs Tool"): Budun is a provider/adapter behind the
// generic CatalogProvider interface — the agent's tools are
// search_catalog/get_product/get_availability/get_product_media, never
// Budun-named. This file is the ONLY place that imports
// `src/lib/budun/client.ts`; the resolver and tools never talk to Budun
// directly.
// ============================================================

import { BudunClient, type BudunProductPayload } from '@/lib/budun/client'
import { encodeCatalogId } from '../id'
import { toCatalogProduct } from '../whitelist'
import type {
  CatalogAvailability,
  CatalogMedia,
  CatalogProduct,
  CatalogProvider,
  CatalogSearchArgs,
} from '../types'

/** Provider key prefix for Budun integrations. See catalog/id.ts —
 *  must never contain a colon. */
export function budunProviderKey(integrationId: string): string {
  return `budun_${integrationId}`
}

export class BudunProvider implements CatalogProvider {
  readonly key: string
  readonly label: string
  private readonly client: BudunClient

  constructor(integrationId: string, displayName: string, client: BudunClient) {
    this.key = budunProviderKey(integrationId)
    this.label = displayName
    this.client = client
  }

  private toProduct(raw: BudunProductPayload): CatalogProduct {
    return toCatalogProduct({
      ...raw,
      id: encodeCatalogId(this.key, String(raw.id)),
      source: this.label,
    })
  }

  async searchCatalog(args: CatalogSearchArgs): Promise<CatalogProduct[]> {
    const results = await this.client.search(args.query, args.color, args.limit)
    return results.map((r) => this.toProduct(r))
  }

  async getProduct(nativeId: string): Promise<CatalogProduct | null> {
    const raw = await this.client.getProduct(nativeId)
    return raw ? this.toProduct(raw) : null
  }

  async getAvailability(nativeId: string): Promise<CatalogAvailability | null> {
    const raw = await this.client.getAvailability(nativeId)
    if (!raw) return null
    const availableQuantity =
      typeof raw.available_quantity === 'number' ? raw.available_quantity : null
    return {
      productId: encodeCatalogId(this.key, nativeId),
      available: typeof raw.available === 'boolean' ? raw.available : (availableQuantity ?? 0) > 0,
      availableQuantity,
      byVariant: Array.isArray(raw.variants)
        ? raw.variants
            .map((v) => ({
              label: typeof v.label === 'string' ? v.label : '',
              availableQuantity: typeof v.available_quantity === 'number' ? v.available_quantity : null,
              available:
                typeof v.available === 'boolean'
                  ? v.available
                  : (typeof v.available_quantity === 'number' ? v.available_quantity : 0) > 0,
            }))
            .filter((v) => v.label)
        : undefined,
    }
  }

  /** No confirmed standalone "media for product" endpoint in the spec
   *  (see the note in src/lib/budun/client.ts) — the product detail
   *  payload already carries `primary_image`/`images`, so media is
   *  derived from `getProduct` rather than a second unconfirmed call. */
  async getMedia(nativeId: string): Promise<CatalogMedia | null> {
    const product = await this.getProduct(nativeId)
    if (!product) return null
    return { productId: product.id, primaryImage: product.primaryImage, images: product.images }
  }
}
