import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { extractGoogleSheetRef } from '@/lib/ai/tools/google-sheet'
import { slugifyToolName } from '@/lib/ai/tools/name'

/**
 * GET /api/ai/tools
 *
 * List the account's connected Sheets tools (any member).
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const { data, error } = await supabase
      .from('ai_tools')
      .select('id, name, description, sheet_url, is_active, updated_at')
      .eq('account_id', accountId)
      .order('updated_at', { ascending: false })
    if (error) {
      console.error('[ai/tools GET] error:', error)
      return NextResponse.json({ error: 'Failed to load tools' }, { status: 500 })
    }
    return NextResponse.json({ tools: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/ai/tools  (admin+)
 *
 * Connect a new Google Sheet as a tool the agent can call.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`ai-tools:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const rawName = typeof body?.name === 'string' ? body.name.trim() : ''
    const name = slugifyToolName(rawName)
    const description = typeof body?.description === 'string' ? body.description.trim() : ''
    const sheetUrl = typeof body?.sheet_url === 'string' ? body.sheet_url.trim() : ''

    if (!rawName || !description || !sheetUrl) {
      return NextResponse.json(
        { error: 'name, description and sheet_url are required' },
        { status: 400 },
      )
    }
    if (!name) {
      return NextResponse.json(
        { error: 'name must contain at least one letter or number' },
        { status: 400 },
      )
    }
    if (!extractGoogleSheetRef(sheetUrl)) {
      return NextResponse.json(
        { error: 'sheet_url no parece un link válido de Google Sheets' },
        { status: 400 },
      )
    }

    const { data: tool, error } = await supabase
      .from('ai_tools')
      .insert({
        account_id: accountId,
        created_by: userId,
        name,
        description,
        sheet_url: sheetUrl,
      })
      .select('id')
      .single()
    if (error) {
      // UNIQUE(account_id, name) — surface a clear message instead of
      // the raw Postgres constraint error.
      if (error.code === '23505') {
        return NextResponse.json(
          { error: `Ya existe una herramienta llamada "${name}" en esta cuenta` },
          { status: 409 },
        )
      }
      console.error('[ai/tools POST] insert error:', error)
      return NextResponse.json({ error: 'Failed to save tool' }, { status: 500 })
    }

    return NextResponse.json({ success: true, id: tool.id, name })
  } catch (err) {
    return toErrorResponse(err)
  }
}
