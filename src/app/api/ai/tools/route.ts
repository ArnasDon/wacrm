import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { extractGoogleSheetRef } from '@/lib/ai/tools/google-sheet'
import { isValidApiUrl, parseApiHeaders, parseApiParams } from '@/lib/ai/tools/validate'
import { slugifyToolName } from '@/lib/ai/tools/name'
import { encrypt } from '@/lib/whatsapp/encryption'

/**
 * GET /api/ai/tools
 *
 * List the account's connected tools — Google Sheets and generic APIs
 * (any member). `api_key_encrypted` is never selected; `has_api_key`
 * tells the UI whether one is stored without exposing it.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const { data, error } = await supabase
      .from('ai_tools')
      .select(
        'id, name, description, type, sheet_url, api_url, api_method, api_params, api_headers, api_body, api_key_encrypted, is_active, updated_at',
      )
      .eq('account_id', accountId)
      .order('updated_at', { ascending: false })
    if (error) {
      console.error('[ai/tools GET] error:', error)
      return NextResponse.json({ error: 'Failed to load tools' }, { status: 500 })
    }
    const tools = (data ?? []).map(({ api_key_encrypted, ...rest }) => ({
      ...rest,
      has_api_key: !!api_key_encrypted,
    }))
    return NextResponse.json({ tools })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/ai/tools  (admin+)
 *
 * Connect a new tool the agent can call — a Google Sheet, or a
 * generic HTTP API (migration 044, e.g. OpenWeatherMap or any other
 * API the account wants the agent to query).
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
    const type = body?.type === 'api' ? 'api' : 'google_sheet'

    if (!rawName || !description) {
      return NextResponse.json({ error: 'name and description are required' }, { status: 400 })
    }
    if (!name) {
      return NextResponse.json(
        { error: 'name must contain at least one letter or number' },
        { status: 400 },
      )
    }

    const insert: Record<string, unknown> = {
      account_id: accountId,
      created_by: userId,
      name,
      description,
      type,
    }

    if (type === 'google_sheet') {
      const sheetUrl = typeof body?.sheet_url === 'string' ? body.sheet_url.trim() : ''
      if (!sheetUrl || !extractGoogleSheetRef(sheetUrl)) {
        return NextResponse.json(
          { error: 'sheet_url no parece un link válido de Google Sheets' },
          { status: 400 },
        )
      }
      insert.sheet_url = sheetUrl
    } else {
      const apiUrl = typeof body?.api_url === 'string' ? body.api_url.trim() : ''
      if (!apiUrl || !isValidApiUrl(apiUrl)) {
        return NextResponse.json(
          { error: 'api_url debe ser una URL http(s) válida' },
          { status: 400 },
        )
      }
      const apiParams = parseApiParams(body?.api_params)
      if (!apiParams.ok) return NextResponse.json({ error: apiParams.error }, { status: 400 })
      const apiHeaders = parseApiHeaders(body?.api_headers)
      if (!apiHeaders.ok) return NextResponse.json({ error: apiHeaders.error }, { status: 400 })

      insert.api_url = apiUrl
      insert.api_method = body?.api_method === 'POST' ? 'POST' : 'GET'
      insert.api_params = apiParams.value
      insert.api_headers = apiHeaders.value
      insert.api_body = typeof body?.api_body === 'string' ? body.api_body.trim() || null : null
      const apiKey = typeof body?.api_key === 'string' ? body.api_key.trim() : ''
      insert.api_key_encrypted = apiKey ? encrypt(apiKey) : null
    }

    const { data: tool, error } = await supabase
      .from('ai_tools')
      .insert(insert)
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
