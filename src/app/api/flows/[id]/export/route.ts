import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { buildFlowExport } from '@/lib/flows/import'
import { loadFlowExport } from '@/lib/flows/import-server'

/**
 * GET /api/flows/[id]/export
 *
 * Downloads the flow as a portable JSON file that POST /api/flows/import
 * (or POST /api/v1/flows) accepts. Any signed-in member of the account
 * can export — `viewer` is enough, it's read-only.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  let ctx
  try {
    ctx = await requireRole('viewer')
  } catch (err) {
    return toErrorResponse(err)
  }

  const loaded = await loadFlowExport(supabaseAdmin(), ctx.accountId, id)
  if (!loaded) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const doc = buildFlowExport(loaded.flow, loaded.nodes, loaded.tagNameById)
  const filename =
    (doc.name || 'flow').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') ||
    'flow'
  return new NextResponse(JSON.stringify(doc, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}.wacrm-flow.json"`,
    },
  })
}
