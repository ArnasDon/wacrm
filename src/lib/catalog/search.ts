import type { WacrmSupabaseClient } from '@/lib/supabase/types'
import { decrypt } from '@/lib/whatsapp/encryption'
import type {
  CatalogProduct,
  CatalogSearchInput,
  CatalogSourceRow,
  ExternalFieldMapping,
} from './types'

const REQUEST_TIMEOUT_MS = 8_000
const MAX_SEARCH_VARIANTS = 8

// Common retail vocabulary. This is deliberately generic and can benefit every
// tenant while account_id continues to isolate each business catalogue.
const PRODUCT_SYNONYM_GROUPS = [
  ['legging', 'leggings', 'colante', 'colantes', 'calca de treino', 'calcas de treino', 'calca fitness', 'calcas fitness', 'tights'],
  ['sapatilha', 'sapatilhas', 'tenis', 'calcado desportivo', 'sapato desportivo'],
  ['camisola', 'camisolas', 'camiseta', 'camisetas', 't-shirt', 't-shirts'],
  ['calcoes', 'short', 'shorts'],
] as const

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

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function buildSearchVariants(query: string): string[] {
  const normalized = normalizeSearchText(query)
  const variants = new Set<string>()
  const add = (value: string) => {
    const cleaned = normalizeSearchText(value)
    if (cleaned.length >= 2) variants.add(cleaned)
  }

  add(query)

  normalized
    .split(' ')
    .filter((word) => word.length >= 3)
    .forEach(add)

  for (const group of PRODUCT_SYNONYM_GROUPS) {
    const normalizedGroup = group.map(normalizeSearchText)
    const matches = normalizedGroup.some(
      (term) => normalized === term || normalized.includes(term) || term.includes(normalized),
    )
    if (matches) group.forEach(add)
  }

  return Array.from(variants).slice(0, MAX_SEARCH_VARIANTS)
}

function safePostgrestTerm(value: string): string {
  return value.replace(/[,%()]/g, ' ').replace(/\s+/g, ' ').trim()
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
  const variants = buildSearchVariants(input.query)
  if (variants.length === 0) return []

  const filters = variants
    .map(safePostgrestTerm)
    .filter(Boolean)
    .flatMap((term) => [
      `name.ilike.%${term}%`,
      `description.ilike.%${term}%`,
      `category.ilike.%${term}%`,
    ])
    .join(',')

  const { data, error } = await db
    .from('catalog_products')
    .select('id, name, description, price, currency, image_url, product_url, category, stock_quantity')
    .eq('account_id', accountId)
    .eq('is_active', true)
    .or(filters)
    .limit(input.limit)

  if (error) {
    console.error('[catalog search] internal query failed:', {
      query: input.query,
      variants,
      message: error.message,
      code: error.code,
    })
    throw new Error(`Internal catalogue search failed: ${error.message}`)
  }
  if (!data) return []

  console.info('[catalog search] internal results:', {
    query: input.query,
    variants,
    count: data.length,
    names: data.map((row) => row.name),
  })

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

  const { data: sourceRows, error: sourcesError } = await db
    .from('catalog_sources')
    .select('*')
    .eq('account_id', accountId)
    .eq('source_type', 'external_rest')
    .eq('is_active', true)

  if (sourcesError) {
    console.error('[catalog search] external source lookup failed:', {
      query: input.query,
      message: sourcesError.message,
      code: sourcesError.code,
    })
  }

  const sources = (sourceRows ?? []) as CatalogSourceRow[]
  const variants = buildSearchVariants(input.query)
  const externalQueries = variants.length > 0 ? variants.slice(0, 4) : [input.query]
  const externalSettled = await Promise.allSettled(
    sources.flatMap((source) =>
      externalQueries.map((query) => searchExternalSource(source, { ...input, query })),
    ),
  )
  const external = externalSettled.flatMap((result) => {
    if (result.status === 'fulfilled') return result.value
    console.error('[catalog search] external query failed:', result.reason)
    return []
  })

  const unique = new Map<string, CatalogProduct>()
  for (const product of [...internal, ...external]) {
    const key = `${product.sourceName}:${product.id}`
    if (!unique.has(key)) unique.set(key, product)
  }

  return Array.from(unique.values()).slice(0, input.limit)
}
