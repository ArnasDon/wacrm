import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { getDataSourcePreview } from '@/lib/ai/data-sources/service'

/**
 * GET /api/ai/data-sources/[id]/preview  (viewer+)
 *
 * "Ver datos" — everything the settings UI needs to show for one data
 * source without a second round trip: its full metadata (status,
 * currency, priority, row count, last sync, last error, detected
 * column mapping) plus a real sample of its persisted rows.
 *
 * Read-only, same role as GET /api/ai/data-sources (list) — viewing a
 * source's data doesn't need admin, only mutating one does.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId } = await requireRole('viewer')
    const { id } = await params

    const result = await getDataSourcePreview(supabase, accountId, id)
    if (!result) {
      return NextResponse.json({ error: 'Data source not found.' }, { status: 404 })
    }
    return NextResponse.json({ data_source: result.source, preview: result.preview })
  } catch (err) {
    return toErrorResponse(err)
  }
}
