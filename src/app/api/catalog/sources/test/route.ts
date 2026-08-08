import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

const TIMEOUT_MS = 8_000

function at(value: unknown, path?: string): unknown {
  if (!path) return value
  return path.split('.').reduce<unknown>((current, key) => {
    if (Array.isArray(current) && /^\d+$/.test(key)) return current[Number(key)]
    if (!current || typeof current !== 'object') return undefined
    return (current as Record<string, unknown>)[key]
  }, value)
}

function safeUrl(raw: string): URL {
  const url = new URL(raw)
  if (url.protocol !== 'https:') throw new Error('A ligação deve usar HTTPS.')
  const host = url.hostname.toLowerCase()
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local') || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
    throw new Error('Endereços privados ou locais não são permitidos.')
  }
  return url
}

function identifier(value: unknown, fallback?: string): string {
  const candidate = String(value ?? fallback ?? '').trim()
  if (!candidate || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(candidate)) throw new Error(`Identificador inválido: ${candidate || '(vazio)'}`)
  return candidate
}

function optionalIdentifier(value: unknown): string | null {
  if (value == null || value === '') return null
  return identifier(value)
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

async function testSupabase(input: Record<string, unknown>) {
  const baseUrl = typeof input.base_url === 'string' ? input.base_url.trim() : ''
  const secret = typeof input.auth_secret === 'string' ? input.auth_secret.trim() : ''
  const mapping = input.field_mapping && typeof input.field_mapping === 'object' && !Array.isArray(input.field_mapping)
    ? input.field_mapping as Record<string, unknown>
    : {}
  if (!baseUrl || !secret) throw new Error('URL do Supabase e API key são obrigatórios.')

  const schema = identifier(mapping.schema, 'public')
  const table = identifier(mapping.table)
  const nameColumn = identifier(mapping.name, 'name')
  const priceColumn = identifier(mapping.price, 'price')
  const idColumn = identifier(mapping.id, 'id')
  const imageColumn = optionalIdentifier(mapping.imageUrl)
  const currencyColumn = optionalIdentifier(mapping.currency)
  const queryText = typeof input.query === 'string' && input.query.trim() ? input.query.trim() : ''

  const client = createClient(safeUrl(baseUrl).toString().replace(/\/$/, ''), secret, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: schema as never },
  })

  const selected = [idColumn, nameColumn, priceColumn, currencyColumn, imageColumn].filter((value): value is string => Boolean(value))
  let query = client.from(table).select(selected.join(','))
  if (queryText) query = query.ilike(nameColumn, `%${queryText.replace(/[,%()]/g, ' ')}%`)
  if (mapping.activeColumn) query = query.eq(identifier(mapping.activeColumn), true)
  if (mapping.publishedColumn) query = query.eq(identifier(mapping.publishedColumn), true)

  const result = await Promise.race([
    query.limit(3),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('A ligação excedeu o tempo limite.')), TIMEOUT_MS)),
  ])
  if (result.error) throw new Error(result.error.message)

  const rows: unknown[] = Array.isArray(result.data) ? result.data as unknown[] : []
  const products = rows
    .map((value, index) => {
      const item = record(value)
      if (!item) return null
      return {
        id: String(item[idColumn] ?? index),
        name: String(item[nameColumn] ?? ''),
        price: Number(item[priceColumn]),
        currency: String(currencyColumn ? item[currencyColumn] ?? 'MZN' : 'MZN'),
        imageUrl: imageColumn ? item[imageColumn] ?? null : null,
      }
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item?.name) && Number.isFinite(item?.price))

  return { ok: true, source_type: 'external_supabase', schema, table, products, raw_item_count: rows.length }
}

async function testRest(input: Record<string, unknown>) {
  const baseUrl = typeof input.base_url === 'string' ? input.base_url.trim() : ''
  const searchPath = typeof input.search_path === 'string' ? input.search_path : ''
  const query = typeof input.query === 'string' && input.query.trim() ? input.query.trim() : 'produto'
  const mapping = input.field_mapping && typeof input.field_mapping === 'object' && !Array.isArray(input.field_mapping)
    ? input.field_mapping as Record<string, string>
    : {}
  if (!baseUrl) throw new Error('base_url is required.')

  const expanded = searchPath.replaceAll('{query}', encodeURIComponent(query)).replaceAll('{limit}', '3')
  const url = safeUrl(new URL(expanded, safeUrl(baseUrl)).toString())
  if (!searchPath.includes('{query}')) url.searchParams.set('q', query)
  if (!searchPath.includes('{limit}')) url.searchParams.set('limit', '3')

  const headers: Record<string, string> = { Accept: 'application/json' }
  const authType = String(input.auth_type ?? 'none')
  const secret = typeof input.auth_secret === 'string' ? input.auth_secret.trim() : ''
  if (authType === 'bearer' && secret) headers.Authorization = `Bearer ${secret}`
  if (authType === 'api_key_header' && secret) {
    const header = typeof input.auth_header === 'string' && input.auth_header.trim() ? input.auth_header.trim() : 'X-API-Key'
    headers[header] = secret
  }

  const response = await fetch(url, { headers, cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!response.ok) throw new Error(`A API respondeu com HTTP ${response.status}.`)
  const payload: unknown = await response.json()
  const itemsValue = mapping.items ? at(payload, mapping.items) : payload
  const items = Array.isArray(itemsValue) ? itemsValue.slice(0, 3) : []
  const products = items.map((item, index) => ({
    id: String(at(item, mapping.id ?? 'id') ?? index),
    name: String(at(item, mapping.name ?? 'name') ?? ''),
    price: Number(at(item, mapping.price ?? 'price')),
    currency: String(at(item, mapping.currency ?? 'currency') ?? 'MZN'),
    imageUrl: at(item, mapping.imageUrl ?? 'image_url') ?? null,
    productUrl: at(item, mapping.productUrl ?? 'product_url') ?? null,
  })).filter((item) => item.name && Number.isFinite(item.price))

  return { ok: true, source_type: 'external_rest', request_url: url.toString(), products, raw_item_count: items.length }
}

export async function POST(request: Request) {
  try {
    await requireRole('admin')
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 })
    const input = body as Record<string, unknown>
    const sourceType = String(input.source_type ?? 'external_rest')
    const result = sourceType === 'external_supabase' ? await testSupabase(input) : await testRest(input)
    return NextResponse.json(result)
  } catch (error) {
    return toErrorResponse(error)
  }
}
