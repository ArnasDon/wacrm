import { createClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import type { CatalogSourceRow } from './types'

type Mapping = Record<string, unknown>
type Row = Record<string, unknown>

function identifier(value: unknown, fallback?: string): string {
  const candidate = String(value ?? fallback ?? '').trim()
  if (!candidate || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(candidate)) {
    throw new Error(`Invalid catalogue identifier: ${candidate || '(empty)'}`)
  }
  return candidate
}

function safeExternalUrl(raw: string): string {
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
  return url.toString().replace(/\/$/, '')
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : String(value ?? '').trim()
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function valueAt(row: Row, key: unknown): unknown {
  const path = stringValue(key)
  if (!path) return undefined
  return path.split('.').reduce<unknown>((current, part) => {
    if (Array.isArray(current) && /^\d+$/.test(part)) return current[Number(part)]
    if (!current || typeof current !== 'object') return undefined
    return (current as Row)[part]
  }, row)
}

function first(row: Row, values: unknown[]): unknown {
  for (const value of values) {
    const key = stringValue(value)
    if (!key) continue
    const resolved = valueAt(row, key)
    if (resolved !== undefined && resolved !== null && resolved !== '') return resolved
  }
  return undefined
}

function csvCell(value: unknown): string {
  const text = String(value ?? '').replace(/\r?\n/g, ' ').trim()
  return `"${text.replace(/"/g, '""')}"`
}

function absoluteProductLink(id: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://wacrm.datacenterhub.tech').replace(/\/$/, '')
  return `${base}/catalog?product=${encodeURIComponent(id)}`
}

/**
 * A short, filesystem/header-safe slug of the source's own configured
 * name — used for the CSV filename and the "brand" column so this feed
 * never needs to know which business it belongs to. Any tenant naming
 * their catalogue source produces a sensible generic filename.
 */
export function metaCatalogFeedSlug(source: CatalogSourceRow): string {
  const slug = source.name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'catalog'
}

/**
 * Builds the Meta/Google-style product CSV feed for exactly one
 * catalogue source. The caller is responsible for resolving `source`
 * safely (see the [token] route) — this function has no knowledge of
 * tenants, account_id checks, or any particular business.
 */
export async function buildMetaCatalogFeedCsv(source: CatalogSourceRow): Promise<string> {
  if (!source.base_url || !source.auth_secret_encrypted) {
    throw new Error('This catalogue source is not configured for external Supabase access.')
  }

  const mapping = (source.field_mapping && typeof source.field_mapping === 'object' && !Array.isArray(source.field_mapping)
    ? source.field_mapping
    : {}) as Mapping
  const schema = identifier(mapping.schema, 'public')
  const catalogueTable = identifier(mapping.catalogTable, 'products')
  const key = decrypt(source.auth_secret_encrypted)
  const client = createClient(safeExternalUrl(source.base_url), key, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: schema as never },
  })

  const { data, error } = await client.from(catalogueTable).select('*')
  if (error) throw new Error(`${catalogueTable}: ${error.message}`)

  const rows = (data ?? []) as Row[]
  const headers = [
    'id',
    'title',
    'description',
    'availability',
    'condition',
    'price',
    'link',
    'image_link',
    'brand',
  ]

  const brand = source.name.trim() || 'Catálogo'

  const feedRows = rows.flatMap((row) => {
    const id = stringValue(first(row, [mapping.catalogId, mapping.id, 'id']))
    const title = stringValue(first(row, [mapping.catalogName, mapping.name, 'name', 'title']))
    const price = numberValue(first(row, [mapping.catalogPrice, 'price_mt', 'base_price', 'base_price_mt', 'price']))
    const image = stringValue(first(row, [mapping.catalogImageUrl, 'image_url', 'gallery.0.url']))
    const description = stringValue(first(row, [mapping.catalogDescription, 'description'])) || title
    const activeRaw = first(row, [mapping.catalogActiveColumn, 'is_active'])
    const active = activeRaw === undefined ? true : Boolean(activeRaw)
    if (!id || !title || price === null || price < 0 || !image || !active) return []

    return [[
      id,
      title,
      description,
      'in stock',
      'new',
      `${price.toFixed(2)} MZN`,
      absoluteProductLink(id),
      image,
      brand,
    ]]
  })

  return [headers, ...feedRows].map((row) => row.map(csvCell).join(',')).join('\n')
}
