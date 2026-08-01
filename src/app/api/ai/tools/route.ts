import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { isValidGoogleDriveUrl } from '@/lib/ai/tools/google-drive'
import { isOneDriveUrl } from '@/lib/ai/tools/onedrive'
import { isValidApiUrl, parseApiHeaders, parseApiParams } from '@/lib/ai/tools/validate'
import { slugifyToolName } from '@/lib/ai/tools/name'
import { encrypt } from '@/lib/whatsapp/encryption'

type ToolType = 'google_drive' | 'onedrive' | 'api'

function parseToolType(raw: unknown): ToolType {
  if (raw === 'api') return 'api'
  if (raw === 'onedrive') return 'onedrive'
  return 'google_drive'
}

/**
 * GET /api/ai/tools
 *
 * List the account's connected tools — Google Drive, OneDrive and
 * generic APIs (any member). `api_key_encrypted` is never selected;
 * `has_api_key` tells the UI whether one is stored without exposing it.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const { data, error } = await supabase
      .from('ai_tools')
      .select(
        'id, name, description, type, drive_url, api_url, api_method, api_params, api_headers, api_body, api_key_encrypted, is_active, updated_at',
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
 * Connect a new tool the agent can call — Google Drive (Sheets, Docs,
 * Slides or a Drive file), a public OneDrive/SharePoint file, or a
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
    const type = parseToolType(body?.type)

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

    if (type === 'google_drive' || type === 'onedrive') {
      const driveUrl = typeof body?.drive_url === 'string' ? body.drive_url.trim() : ''
      const valid = type === 'google_drive' ? isValidGoogleDriveUrl(driveUrl) : isOneDriveUrl(driveUrl)
      if (!driveUrl || !valid) {
        return NextResponse.json(
          {
            error:
              type === 'google_drive'
                ? 'drive_url debe ser un link de Google Sheets, Docs, Slides o de un archivo de Drive'
                : 'drive_url debe ser un link de OneDrive o SharePoint',
          },
          { status: 400 },
        )
      }
      insert.drive_url = driveUrl
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
