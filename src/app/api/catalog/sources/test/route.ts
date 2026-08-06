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
  if (url.protocol !== 'https:') throw new Error('A API deve usar HTTPS.')
  const host = url.hostname.toLowerCase()
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local') || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
    throw new Error('Endereços privados ou locais não são permitidos.')
  }
  return url
}

export async function POST(request: Request) {
  try {
    await requireRole('admin')
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 })
    const input = body as Record<string, unknown>
    const baseUrl = typeof input.base_url === 'string' ? input.base_url.trim() : ''
    const searchPath = typeof input.search_path === 'string' ? input.search_path : ''
    const query = typeof input.query === 'string' && input.query.trim() ? input.query.trim() : 'produto'
    const mapping = input.field_mapping && typeof input.field_mapping === 'object' && !Array.isArray(input.field_mapping)
      ? input.field_mapping as Record<string, string>
      : {}
    if (!baseUrl) return NextResponse.json({ error: 'base_url is required.' }, { status: 400 })

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
    if (!response.ok) return NextResponse.json({ error: `A API respondeu com HTTP ${response.status}.` }, { status: 400 })
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

    return NextResponse.json({ ok: true, request_url: url.toString(), products, raw_item_count: items.length })
  } catch (error) {
    return toErrorResponse(error)
  }
}
