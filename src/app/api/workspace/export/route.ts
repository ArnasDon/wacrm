import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { BUNDLE_SECTIONS, type BundleSection } from '@/lib/bundle/schema'
import { exportBundle } from '@/lib/bundle/export-server'

/**
 * GET /api/workspace/export?sections=flows,automations,quick_replies,templates,ai  (admin+)
 *
 * Downloads the workspace as one JSON bundle that POST /api/workspace/import
 * accepts. Secrets (AI/WhatsApp/API keys) are never included.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const raw = new URL(request.url).searchParams.get('sections')
    const sections = (raw ? raw.split(',') : [...BUNDLE_SECTIONS]).filter(
      (s): s is BundleSection => (BUNDLE_SECTIONS as readonly string[]).includes(s),
    )
    const doc = await exportBundle(
      { supabase: ctx.supabase, accountId: ctx.accountId, userId: ctx.userId },
      sections,
    )
    return new NextResponse(JSON.stringify(doc, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="workspace.wacrm-bundle.json"',
      },
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
