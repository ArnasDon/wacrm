// ============================================================
// Server-side whitelist — the single choke point every catalog result
// passes through before it can reach the LLM.
//
// docs/integrations/ai-data-integration/01_MASTER_EXECUTION.md
// ("WHITELIST ERP") and docs/integrations/budun-erp/
// WACRM_ERP_CATALOG_INTEGRATION_SPEC_v4.md (§6/§7) both require this:
// raw provider responses (Budun's Catalog API JSON, a parsed CSV row)
// must never be forwarded to the model as-is. `toCatalogProduct` below
// is an ALLOW-list, not a deny-list — it only reads the named fields off
// its input, so a field the input additionally carries (IMEI, cost,
// margin, supplier, ...) has no path onto the output no matter what the
// upstream sends. Both CatalogProvider implementations (BudunProvider,
// DataSourceCatalogProvider) call this before returning.
// ============================================================

import type { CatalogImage, CatalogProduct } from './types'

export interface RawCatalogProductInput {
  id: string
  name?: unknown
  brand?: unknown
  model?: unknown
  sku?: unknown
  description?: unknown
  variants?: unknown
  colors?: unknown
  capacity?: unknown
  size?: unknown
  price?: unknown
  currency?: unknown
  available?: unknown
  available_quantity?: unknown
  primary_image?: unknown
  images?: unknown
  source: string
}

function str(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim()
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return null
}

function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.map((x) => str(x)).filter((x): x is string => x !== null)
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v)
  return null
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

function image(v: unknown): CatalogImage | null {
  if (!v || typeof v !== 'object') return null
  const url = str((v as { url?: unknown }).url)
  if (!url) return null
  const alt = str((v as { alt?: unknown }).alt)
  return alt ? { url, alt } : { url }
}

function imageArray(v: unknown): CatalogImage[] {
  if (!Array.isArray(v)) return []
  return v.map(image).filter((x): x is CatalogImage => x !== null)
}

/**
 * Allow-list mapping from an arbitrary provider payload to the strict
 * `CatalogProduct` shape. Anything not read here (IMEI, serial,
 * unit_cost, margin, supplier, stock_movements, private customer data,
 * payments, ...) is dropped by construction, not by a filter that could
 * miss a field name.
 */
export function toCatalogProduct(raw: RawCatalogProductInput): CatalogProduct {
  const available = bool(raw.available, (num(raw.available_quantity) ?? 0) > 0)
  return {
    id: raw.id,
    name: str(raw.name) ?? 'Producto',
    brand: str(raw.brand),
    model: str(raw.model),
    sku: str(raw.sku),
    description: str(raw.description),
    variants: strArray(raw.variants),
    colors: strArray(raw.colors),
    capacity: str(raw.capacity),
    size: str(raw.size),
    price: num(raw.price),
    currency: str(raw.currency),
    available,
    availableQuantity: num(raw.available_quantity),
    primaryImage: image(raw.primary_image),
    images: imageArray(raw.images),
    source: raw.source,
  }
}

/** What actually gets serialized into the tool result the LLM reads —
 *  drops `source` (internal routing/audit only, never business-relevant
 *  to the model) on top of the allow-list `toCatalogProduct` already
 *  applied. */
export function toToolResultProduct(p: CatalogProduct): Omit<CatalogProduct, 'source'> {
  const { source, ...rest } = p
  void source
  return rest
}
