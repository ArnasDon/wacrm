import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'

function identifier(value: unknown, fallback?: string): string {
  const candidate = String(value ?? fallback ?? '').trim()
  if (!candidate || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(candidate)) {
    throw new Error(`Identificador inválido: ${candidate || '(vazio)'}`)
  }
  return candidate
}

function safeUrl(raw: string): string {
  const url = new URL(raw)
  if (url.protocol !== 'https:') throw new Error('A ligação deve usar HTTPS.')
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
    throw new Error('Endereços privados ou locais não são permitidos.')
  }
  return url.toString().replace(/\/$/, '')
}

type Mapping = Record<string, unknown>

type TableStat = {
  table: string
  kind: 'products' | 'variants' | 'catalog_products' | 'catalog_variants'
  count: number
}

async function countTable(
  client: ReturnType<typeof createClient>,
  rawTable: unknown,
  kind: TableStat['kind'],
  mapping: Mapping,
  activeKey?: string,
  publishedKey?: string,
): Promise<TableStat | null> {
  if (typeof rawTable !== 'string' || !rawTable.trim()) return null
  const table = identifier(rawTable)
  let query = client.from(table).select('*', { count: 'exact', head: true })

  const activeColumn = activeKey && typeof mapping[activeKey] === 'string' && String(mapping[activeKey]).trim()
    ? identifier(mapping[activeKey])
    : null
  const publishedColumn = publishedKey && typeof mapping[publishedKey] === 'string' && String(mapping[publishedKey]).trim()
    ? identifier(mapping[publishedKey])
    : null

  if (activeColumn) query = query.eq(activeColumn, true)
  if (publishedColumn) query = query.eq(publishedColumn, true)

  const { count, error } = await query
  if (error) throw new Error(`${table}: ${error.message}`)
  return { table, kind, count: count ?? 0 }
}

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { data: sources, error } = await supabase
      .from('catalog_sources')
      .select('id, name, source_type, is_active, base_url, auth_secret_encrypted, field_mapping')
      .eq('account_id', accountId)
      .eq('source_type', 'external_supabase')
      .eq('is_active', true)

    if (error) throw error

    const stats = [] as Array<{
      sourceId: string
      sourceName: string
      ok: boolean
      productRecords: number
      variantRecords: number
      tables: TableStat[]
      error?: string
    }>

    for (const source of sources ?? []) {
      try {
        if (!source.base_url || !source.auth_secret_encrypted) throw new Error('Ligação incompleta.')
        const mapping = (source.field_mapping && typeof source.field_mapping === 'object' && !Array.isArray(source.field_mapping)
          ? source.field_mapping
          : {}) as Mapping
        const schema = identifier(mapping.schema, 'public')
        const key = decrypt(source.auth_secret_encrypted)
        const client = createClient(safeUrl(source.base_url), key, {
          auth: { persistSession: false, autoRefreshToken: false },
          db: { schema: schema as never },
        })

        const requested = await Promise.all([
          countTable(client, mapping.table, 'products', mapping, 'activeColumn', 'publishedColumn'),
          countTable(client, mapping.variantsTable, 'variants', mapping, 'variantActiveColumn'),
          countTable(client, mapping.catalogTable, 'catalog_products', mapping, 'catalogActiveColumn', 'catalogPublishedColumn'),
          countTable(client, mapping.catalogVariantsTable, 'catalog_variants', mapping, 'catalogVariantActiveColumn'),
        ])
        const tables = requested.filter((item): item is TableStat => item !== null)
        const productRecords = tables
          .filter((item) => item.kind === 'products' || item.kind === 'catalog_products')
          .reduce((sum, item) => sum + item.count, 0)
        const variantRecords = tables
          .filter((item) => item.kind === 'variants' || item.kind === 'catalog_variants')
          .reduce((sum, item) => sum + item.count, 0)

        stats.push({
          sourceId: source.id,
          sourceName: source.name,
          ok: true,
          productRecords,
          variantRecords,
          tables,
        })
      } catch (sourceError) {
        stats.push({
          sourceId: source.id,
          sourceName: source.name,
          ok: false,
          productRecords: 0,
          variantRecords: 0,
          tables: [],
          error: sourceError instanceof Error ? sourceError.message : 'Falha ao contar a fonte.',
        })
      }
    }

    return NextResponse.json({
      sources: stats,
      totalProductRecords: stats.reduce((sum, source) => sum + source.productRecords, 0),
      totalVariantRecords: stats.reduce((sum, source) => sum + source.variantRecords, 0),
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
