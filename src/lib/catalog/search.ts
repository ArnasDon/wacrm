import { createClient } from '@supabase/supabase-js'
import type { WacrmSupabaseClient } from '@/lib/supabase/types'
import { decrypt } from '@/lib/whatsapp/encryption'
import type {
  CatalogProduct,
  CatalogProductVariant,
  CatalogSearchInput,
  CatalogSourceRow,
  ExternalFieldMapping,
} from './types'

const REQUEST_TIMEOUT_MS = 8_000
const MAX_SEARCH_VARIANTS = 8

const PRODUCT_SYNONYM_GROUPS = [
  ['legging', 'leggings', 'colante', 'colantes', 'calca de treino', 'calcas de treino', 'calca fitness', 'calcas fitness', 'tights'],
  ['sapatilha', 'sapatilhas', 'tenis', 'calcado desportivo', 'sapato desportivo'],
  ['camisola', 'camisolas', 'camiseta', 'camisetas', 't-shirt', 't-shirts'],
  ['calcoes', 'short', 'shorts'],
] as const

function valueAt(input: unknown, path: string | undefined): unknown {
  if (!path) return undefined
  return path.split('.').reduce<unknown>((value, key) => {
    if (Array.isArray(value) && /^\d+$/.test(key)) return value[Number(key)]
    if (!value || typeof value !== 'object') return undefined
    return (value as Record<string, unknown>)[key]
  }, input)
}

function firstValueAt(input: unknown, paths: Array<string | undefined>): unknown {
  for (const path of paths) {
    if (!path) continue
    const value = valueAt(input, path)
    if (value !== undefined && value !== null && value !== '') return value
  }
  return undefined
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
  normalized.split(' ').filter((word) => word.length >= 3).forEach(add)

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

function safeIdentifier(value: string | undefined, fallback?: string): string {
  const candidate = (value || fallback || '').trim()
  if (!candidate || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(candidate)) {
    throw new Error(`Invalid external catalogue identifier: ${candidate || '(empty)'}`)
  }
  return candidate
}

function assertSafeExternalUrl(raw: string): URL {
  const url = new URL(raw)
  if (url.protocol !== 'https:') throw new Error('External catalogue URL must use HTTPS.')
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

function externalItems(payload: unknown, mapping: ExternalFieldMapping): unknown[] {
  if (mapping.items) {
    const mapped = valueAt(payload, mapping.items)
    if (Array.isArray(mapped)) return mapped
  }
  if (Array.isArray(payload)) return payload
  const common = firstValueAt(payload, ['products', 'data.products', 'items', 'data.items', 'data'])
  return Array.isArray(common) ? common : []
}

function normalizeExternalProduct(
  item: unknown,
  mapping: ExternalFieldMapping,
  source: CatalogSourceRow,
  index: number,
): CatalogProduct | null {
  const name = text(firstValueAt(item, [mapping.name, 'name', 'title', 'product_name']))
  const price = numberValue(firstValueAt(item, [mapping.price, 'price', 'amount', 'unit_price', 'base_price_mt']))
  if (!name || price === null || price < 0) return null

  return {
    id: text(firstValueAt(item, [mapping.id, 'id', 'sku', 'external_id'])) ?? `${source.id}:${index}`,
    name,
    description: text(firstValueAt(item, [mapping.description, 'description', 'short_description', 'summary'])),
    price,
    currency: text(firstValueAt(item, [mapping.currency, 'currency', 'currency_code'])) ?? 'MZN',
    imageUrl: text(firstValueAt(item, [mapping.imageUrl, 'image_url', 'imageUrl', 'thumbnail', 'image', 'images.0.url', 'images.0'])),
    productUrl: text(firstValueAt(item, [mapping.productUrl, 'product_url', 'productUrl', 'url', 'link'])),
    category: text(firstValueAt(item, [mapping.category, 'category.name', 'category', 'type'])),
    stockQuantity: numberValue(firstValueAt(item, [mapping.stockQuantity, 'stock_quantity', 'stockQuantity', 'stock', 'quantity', 'current_stock'])),
    sourceName: source.name,
  }
}

function catalogTableMapping(mapping: ExternalFieldMapping): ExternalFieldMapping {
  return {
    id: mapping.catalogId || mapping.id,
    name: mapping.catalogName || mapping.name,
    description: mapping.catalogDescription || mapping.description,
    price: mapping.catalogPrice || mapping.price,
    currency: mapping.catalogCurrency || mapping.currency,
    imageUrl: mapping.catalogImageUrl || mapping.imageUrl,
    productUrl: mapping.catalogProductUrl || mapping.productUrl,
    category: mapping.catalogCategory || mapping.category,
    searchColumns: mapping.catalogSearchColumns?.length ? mapping.catalogSearchColumns : mapping.searchColumns,
    activeColumn: mapping.catalogActiveColumn,
    publishedColumn: mapping.catalogPublishedColumn,
  }
}

function productIdentityKeys(product: CatalogProduct): string[] {
  const keys = [`id:${normalizeSearchText(product.id)}`]
  const normalizedName = normalizeSearchText(product.name)
  if (normalizedName) keys.push(`name:${normalizedName}`)
  return keys
}

function mergeCatalogueProduct(stockProduct: CatalogProduct, catalogueProduct: CatalogProduct): CatalogProduct {
  return {
    ...stockProduct,
    description: stockProduct.description || catalogueProduct.description,
    imageUrl: stockProduct.imageUrl || catalogueProduct.imageUrl,
    productUrl: stockProduct.productUrl || catalogueProduct.productUrl,
    category: stockProduct.category || catalogueProduct.category,
  }
}

async function searchExternalRestSource(
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
    if (source.auth_type === 'api_key_header') headers[source.auth_header || 'X-API-Key'] = secret
  }

  console.info('[catalog search] external REST request:', {
    sourceId: source.id,
    sourceName: source.name,
    query: input.query,
    url: url.toString(),
  })

  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`Catalogue API ${source.name} returned HTTP ${response.status}.`)

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new Error(`Catalogue API ${source.name} returned invalid JSON.`)
  }

  const mapping = source.field_mapping ?? {}
  const items = externalItems(payload, mapping)
  const products = items
    .slice(0, input.limit)
    .map((item, index) => normalizeExternalProduct(item, mapping, source, index))
    .filter((item): item is CatalogProduct => item !== null)

  console.info('[catalog search] external REST results:', {
    sourceId: source.id,
    sourceName: source.name,
    query: input.query,
    rawItemCount: items.length,
    normalizedCount: products.length,
  })

  return products
}

async function searchExternalSupabaseSource(
  source: CatalogSourceRow,
  input: CatalogSearchInput,
): Promise<CatalogProduct[]> {
  if (!source.base_url || !source.auth_secret_encrypted) return []
  const baseUrl = assertSafeExternalUrl(source.base_url).toString().replace(/\/$/, '')
  const key = decrypt(source.auth_secret_encrypted)
  const mapping = source.field_mapping ?? {}
  const schema = safeIdentifier(mapping.schema, 'public')
  const table = safeIdentifier(mapping.table)
  const searchColumns = (mapping.searchColumns?.length ? mapping.searchColumns : [mapping.name || 'name'])
    .map((column) => safeIdentifier(column))
    .slice(0, 6)
  const variants = buildSearchVariants(input.query)
  const terms = variants.length ? variants.slice(0, 4) : [normalizeSearchText(input.query)]

  const client = createClient(baseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema },
    global: { headers: { 'X-WACRM-Source': source.id } },
  })

  const selectColumns = Array.from(new Set([
    mapping.id || 'id',
    mapping.name || 'name',
    mapping.description || 'description',
    mapping.price || 'price',
    mapping.currency || 'currency',
    mapping.imageUrl || 'image_url',
    mapping.productUrl || 'product_url',
    mapping.category || 'category',
    mapping.stockQuantity || 'stock_quantity',
  ].filter(Boolean).map((column) => safeIdentifier(column)))).join(',')

  let query = client.from(table).select(selectColumns)
  if (mapping.activeColumn) query = query.eq(safeIdentifier(mapping.activeColumn), true)
  if (mapping.publishedColumn) query = query.eq(safeIdentifier(mapping.publishedColumn), true)

  const filters = terms.flatMap((term) => {
    const safeTerm = safePostgrestTerm(term)
    return searchColumns.map((column) => `${column}.ilike.%${safeTerm}%`)
  })
  if (filters.length) query = query.or(filters.join(','))

  const result = await Promise.race([
    query.limit(input.limit),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`External Supabase source ${source.name} timed out.`)), REQUEST_TIMEOUT_MS)),
  ])

  const { data, error } = result
  if (error) throw new Error(`External Supabase source ${source.name} failed: ${error.message}`)

  let products = (data ?? [])
    .map((item, index) => normalizeExternalProduct(item, mapping, source, index))
    .filter((item): item is CatalogProduct => item !== null)

  if (mapping.variantsTable && products.length > 0) {
    const variantsTable = safeIdentifier(mapping.variantsTable)
    const variantId = safeIdentifier(mapping.variantId, 'id')
    const variantProductId = safeIdentifier(mapping.variantProductId, 'product_id')
    const variantSize = safeIdentifier(mapping.variantSize, 'size')
    const variantColor = safeIdentifier(mapping.variantColor, 'color')
    const variantStock = safeIdentifier(mapping.variantStock, 'stock_quantity')
    const variantColumns = Array.from(new Set([variantId, variantProductId, variantSize, variantColor, variantStock])).join(',')
    const productIds = products.map((product) => product.id)

    let variantsQuery = client.from(variantsTable).select(variantColumns).in(variantProductId, productIds)
    if (mapping.variantActiveColumn) variantsQuery = variantsQuery.eq(safeIdentifier(mapping.variantActiveColumn), true)

    const variantsResult = await Promise.race([
      variantsQuery.limit(Math.max(input.limit * 20, 100)),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`External Supabase variants ${source.name} timed out.`)), REQUEST_TIMEOUT_MS)),
    ])

    if (variantsResult.error) {
      console.error('[catalog search] external Supabase variants failed:', variantsResult.error.message)
    } else {
      const variantsByProduct = new Map<string, CatalogProductVariant[]>()
      for (const row of variantsResult.data ?? []) {
        const item = row as Record<string, unknown>
        const productId = String(item[variantProductId] ?? '')
        if (!productId) continue
        const variant: CatalogProductVariant = {
          id: String(item[variantId] ?? `${productId}:${variantsByProduct.get(productId)?.length ?? 0}`),
          size: text(item[variantSize]),
          color: text(item[variantColor]),
          stockQuantity: numberValue(item[variantStock]),
        }
        const current = variantsByProduct.get(productId) ?? []
        current.push(variant)
        variantsByProduct.set(productId, current)
      }
      products = products.map((product) => ({
        ...product,
        variants: variantsByProduct.get(product.id) ?? undefined,
      }))
    }
  }

  if (mapping.catalogTable) {
    const catalogueTable = safeIdentifier(mapping.catalogTable)
    const catalogueMapping = catalogTableMapping(mapping)
    const catalogueSearchColumns = (catalogueMapping.searchColumns?.length
      ? catalogueMapping.searchColumns
      : [catalogueMapping.name || 'name'])
      .map((column) => safeIdentifier(column))
      .slice(0, 6)
    const catalogueSelectColumns = Array.from(new Set([
      catalogueMapping.id || 'id',
      catalogueMapping.name || 'name',
      catalogueMapping.description || 'description',
      catalogueMapping.price || 'price',
      catalogueMapping.currency || 'currency',
      catalogueMapping.imageUrl || 'image_url',
      catalogueMapping.productUrl || 'product_url',
      catalogueMapping.category || 'category',
    ].filter(Boolean).map((column) => safeIdentifier(column)))).join(',')

    let catalogueQuery = client.from(catalogueTable).select(catalogueSelectColumns)
    if (catalogueMapping.activeColumn) catalogueQuery = catalogueQuery.eq(safeIdentifier(catalogueMapping.activeColumn), true)
    if (catalogueMapping.publishedColumn) catalogueQuery = catalogueQuery.eq(safeIdentifier(catalogueMapping.publishedColumn), true)

    const catalogueFilters = terms.flatMap((term) => {
      const safeTerm = safePostgrestTerm(term)
      return catalogueSearchColumns.map((column) => `${column}.ilike.%${safeTerm}%`)
    })
    if (catalogueFilters.length) catalogueQuery = catalogueQuery.or(catalogueFilters.join(','))

    const catalogueResult = await Promise.race([
      catalogueQuery.limit(input.limit),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`External Supabase catalogue ${source.name} timed out.`)), REQUEST_TIMEOUT_MS)),
    ])

    if (catalogueResult.error) {
      console.error('[catalog search] external Supabase catalogue-only table failed:', catalogueResult.error.message)
    } else {
      const catalogueProducts = (catalogueResult.data ?? [])
        .map((item, index) => normalizeExternalProduct(item, catalogueMapping, source, index))
        .filter((item): item is CatalogProduct => item !== null)
        .map((product) => ({ ...product, stockQuantity: null }))

      const stockIndex = new Map<string, number>()
      products.forEach((product, index) => {
        for (const keyName of productIdentityKeys(product)) stockIndex.set(keyName, index)
      })

      for (const catalogueProduct of catalogueProducts) {
        const match = productIdentityKeys(catalogueProduct)
          .map((keyName) => stockIndex.get(keyName))
          .find((index): index is number => index !== undefined)
        if (match !== undefined) {
          products[match] = mergeCatalogueProduct(products[match], catalogueProduct)
          continue
        }
        const nextIndex = products.length
        products.push(catalogueProduct)
        for (const keyName of productIdentityKeys(catalogueProduct)) stockIndex.set(keyName, nextIndex)
      }
    }
  }

  console.info('[catalog search] external Supabase results:', {
    sourceId: source.id,
    sourceName: source.name,
    schema,
    table,
    variantsTable: mapping.variantsTable || null,
    catalogTable: mapping.catalogTable || null,
    brandsTable: mapping.brandsTable || null,
    query: input.query,
    normalizedCount: products.length,
  })

  return products.slice(0, input.limit)
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

  if (error) throw new Error(`Internal catalogue search failed: ${error.message}`)
  if (!data) return []

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
    .in('source_type', ['external_rest', 'external_supabase'])
    .eq('is_active', true)

  if (sourcesError) throw new Error(`External catalogue source lookup failed: ${sourcesError.message}`)

  const sources = (sourceRows ?? []) as CatalogSourceRow[]
  const variants = buildSearchVariants(input.query)
  const externalQueries = variants.length > 0 ? variants.slice(0, 4) : [input.query]

  const tasks = sources.flatMap((source) => {
    if (source.source_type === 'external_supabase') {
      return [searchExternalSupabaseSource(source, input)]
    }
    return externalQueries.map((query) => searchExternalRestSource(source, { ...input, query }))
  })

  const externalSettled = await Promise.allSettled(tasks)
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
