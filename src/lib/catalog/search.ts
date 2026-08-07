import type { WacrmSupabaseClient } from '@/lib/supabase/types'
import { decrypt } from '@/lib/whatsapp/encryption'
import type {
  CatalogProduct,
  CatalogSearchInput,
  CatalogSourceRow,
  ExternalFieldMapping,
} from './types'

const REQUEST_TIMEOUT_MS = 8_000

function valueAt(input: unknown, path: string | undefined): unknown {
  if (!path) return undefined
  return path.split('.').reduce<unknown>((value, key) => {
    if (!value || typeof value !== 'object') return undefined
    return (value as Record<string, unknown>)[key]
  }, input)
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function assertSafeExternalUrl(raw: string): URL {
  const url = new URL(raw)
  if (url.protocol !== 'https:') throw new Error('Catalogue API must use HTTPS.')
  const host = url.hostname.toLowerCase()
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.endsWith('.local') ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    throw new Error('Private network catalogue URLs are not allowed.')
  }
  return url
}

function normalizeExternalProduct(
  item: unknown,
  mapping: ExternalFieldMapping,
  source: CatalogSourceRow,
  index: number,
): CatalogProduct | null {
  const name = text(valueAt(item, mapping.name ?? 'name'))
  const price = numberValue(valueAt(item, mapping.price ?? 'price'))
  if (!name || price === null || price < 0) return null

  return {
    id: text(valueAt(item, mapping.id ?? 'id')) ?? `${source.id}:${index}`,
    name,
    description: text(valueAt(item, mapping.description ?? 'description')),
    price,
    currency: text(valueAt(item, mapping.currency ?? 'currency')) ?? 'MZN',
    imageUrl: text(valueAt(item, mapping.imageUrl ?? 'image_url')),
    productUrl: text(valueAt(item, mapping.productUrl ?? 'product_url')),
    category: text(valueAt(item, mapping.category ?? 'category')),
    stockQuantity: numberValue(valueAt(item, mapping.stockQuantity ?? 'stock_quantity')),
    sourceName: source.name,
  }
}

async function searchExternalSource(
  source: CatalogSourceRow,
  input: CatalogSearchInput,
): Promise<CatalogProduct[]> {
  if (!source.base_url) return []
  const base = assertSafeExternalUrl(source.base_url)
  const path = source.search_path || ''
  const expanded = path
    .replaceAll('{query}', encodeURIComponent(input.query))
    .replaceAll('{limit}', String(input.limit))
  const url = assertSafeExternalUrl(new URL(expanded, base).toString())
  if (!path.includes('{query}')) url.searchParams.set('q', input.query)
  if (!path.includes('{limit}')) url.searchParams.set('limit', String(input.limit))

  const headers: Record<string, string> = { Accept: 'application/json' }
  if (source.auth_secret_encrypted) {
    const secret = decrypt(source.auth_secret_encrypted)
    if (source.auth_type === 'bearer') headers.Authorization = `Bearer ${secret}`
    if (source.auth_type === 'api_key_header') {
      headers[source.auth_header || 'X-API-Key'] = secret
    }
  }

  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`Catalogue API returned ${response.status}.`)
  const payload: unknown = await response.json()
  const mapping = source.field_mapping ?? {}
  const itemsValue = mapping.items ? valueAt(payload, mapping.items) : payload
  const items = Array.isArray(itemsValue) ? itemsValue : []

  return items
    .slice(0, input.limit)
    .map((item, index) => normalizeExternalProduct(item, mapping, source, index))
    .filter((item): item is CatalogProduct => item !== null)
}

async function searchInternal(
  db: WacrmSupabaseClient,
  accountId: string,
  input: CatalogSearchInput,
): Promise<CatalogProduct[]> {
  const { data, error } = await db
    .from('catalog_products')
    .select('id, name, description, price, currency, image_url, product_url, category, stock_quantity')
    .eq('account_id', accountId)
    .eq('is_active', true)
    .or(`name.ilike.%${input.query}%,description.ilike.%${input.query}%,category.ilike.%${input.query}%`)
    .limit(input.limit)
  if (error || !data) return []

  return data.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    price: Number(row.price),
    currency: row.currency,
    imageUrl: row.image_url,
    productUrl: row.product_url,
    category: row.category,
    stockQuantity: row.stock_quantity,
    sourceName: 'Catálogo interno',
  }))
}

export async function searchCatalogues(
  db: WacrmSupabaseClient,
  accountId: string,
  input: CatalogSearchInput,
): Promise<CatalogProduct[]> {
  const internal = await searchInternal(db, accountId, input)
  if (internal.length >= input.limit) return internal.slice(0, input.limit)

  const { data: sourceRows } = await db
    .from('catalog_sources')
    .select('*')
    .eq('account_id', accountId)
    .eq('source_type', 'external_rest')
    .eq('is_active', true)

  const sources = (sourceRows ?? []) as CatalogSourceRow[]
  const externalSettled = await Promise.allSettled(
    sources.map((source) => searchExternalSource(source, input)),
  )
  const external = externalSettled.flatMap((result) =>
    result.status === 'fulfilled' ? result.value : [],
  )

  return [...internal, ...external].slice(0, input.limit)
}
