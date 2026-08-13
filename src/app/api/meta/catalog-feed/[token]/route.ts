import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { buildMetaCatalogFeedCsv, metaCatalogFeedSlug } from '@/lib/catalog/meta-feed'
import type { CatalogSourceRow } from '@/lib/catalog/types'

export const dynamic = 'force-dynamic'

// 256-bit token, two gen_random_uuid() calls concatenated (see migration
// 20260813091000_catalog_source_feed_token.sql) — 64 lowercase hex chars.
const TOKEN_PATTERN = /^[a-f0-9]{64}$/

/**
 * Public product-feed endpoint for external catalogue pullers (Meta
 * Commerce Manager, Google Shopping, ...). Deliberately has no notion of
 * "which business" — the opaque token in the URL is the only thing that
 * resolves a catalogue source, and it is never accepted as an
 * account_id or looked up by name. A source only appears here if its
 * exact token is known and it is currently active.
 */
export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params
    if (!TOKEN_PATTERN.test(token)) {
      return NextResponse.json({ error: 'Catalogue feed not found.' }, { status: 404 })
    }

    const db = supabaseAdmin()
    const { data: source, error } = await db
      .from('catalog_sources')
      .select(
        'id, account_id, name, source_type, is_active, base_url, search_path, auth_type, auth_header, auth_secret_encrypted, field_mapping',
      )
      .eq('meta_feed_token', token)
      .eq('is_active', true)
      .maybeSingle()

    if (error) throw error
    if (!source) {
      return NextResponse.json({ error: 'Catalogue feed not found.' }, { status: 404 })
    }

    const row = source as CatalogSourceRow
    const csv = await buildMetaCatalogFeedCsv(row)

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `inline; filename="${metaCatalogFeedSlug(row)}-catalog.csv"`,
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
