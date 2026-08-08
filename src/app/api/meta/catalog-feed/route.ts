import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { decrypt } from '@/lib/whatsapp/encryption'

export const dynamic = 'force-dynamic'

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

export async function GET() {
  try {
    const db = supabaseAdmin()
    const { data: source, error: sourceError } = await db
      .from('catalog_sources')
      .select('id, name, base_url, auth_secret_encrypted, field_mapping')
      .eq('source_type', 'external_supabase')
      .eq('is_active', true)
      .ilike('name', 'Base LC Fitness')
      .limit(1)
      .maybeSingle()

    if (sourceError) throw sourceError
    if (!source?.base_url || !source.auth_secret_encrypted) {
      return NextResponse.json({ error: 'Base LC Fitness catalogue source is not configured.' }, { status: 404 })
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
        'LC Fitness',
      ]]
    })

    const csv = [headers, ...feedRows]
      .map((row) => row.map(csvCell).join(','))
      .join('\n')

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'inline; filename="lc-fitness-meta-catalog.csv"',
        'Cache-Control': 'public, max-age=300, s-maxage=300',
      },
    })
  } catch (error) {
    console.error('[meta catalog feed] failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to build catalogue feed.' },
      { status: 500 },
    )
  }
}
