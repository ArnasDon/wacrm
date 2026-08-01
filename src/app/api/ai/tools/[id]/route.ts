import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { isValidGoogleDriveUrl } from '@/lib/ai/tools/google-drive'
import { isOneDriveUrl } from '@/lib/ai/tools/onedrive'
import { isValidApiUrl, parseApiHeaders, parseApiParams } from '@/lib/ai/tools/validate'
import { slugifyToolName } from '@/lib/ai/tools/name'
import { encrypt } from '@/lib/whatsapp/encryption'

type Params = { params: Promise<{ id: string }> }

/**
 * PATCH /api/ai/tools/[id]  (admin+)
 *
 * `is_active` can be toggled on its own. Sending `type` means a full
 * save from the edit form — the matching required fields for that
 * type must be present, and the other type's fields are cleared (so
 * switching a tool from API back to Google Drive doesn't leave a
 * stale, unreachable API config lingering in the row).
 *
 * `api_key`: a non-empty string (re)encrypts and stores it, an
 * explicit `null` clears it, and leaving it out of the body keeps
 * whatever is already stored — same "don't overwrite a secret you
 * didn't touch" convention as the account's embeddings key
 * (`/api/ai/config`).
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`ai-tools:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { id } = await params
    const body = await request.json().catch(() => null)
    const rawName = typeof body?.name === 'string' ? body.name.trim() : undefined
    const name = rawName !== undefined ? slugifyToolName(rawName) : undefined
    const description = typeof body?.description === 'string' ? body.description.trim() : undefined
    const isActive = typeof body?.is_active === 'boolean' ? body.is_active : undefined
    const type =
      body?.type === 'api' || body?.type === 'google_drive' || body?.type === 'onedrive'
        ? body.type
        : undefined

    if (name !== undefined && !name) {
      return NextResponse.json(
        { error: 'name must contain at least one letter or number' },
        { status: 400 },
      )
    }
    if (description !== undefined && !description) {
      return NextResponse.json({ error: 'description cannot be empty' }, { status: 400 })
    }

    const update: Record<string, unknown> = {}
    if (name !== undefined) update.name = name
    if (description !== undefined) update.description = description
    if (isActive !== undefined) update.is_active = isActive

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
      update.type = type
      update.drive_url = driveUrl
      update.api_url = null
      update.api_params = []
      update.api_headers = {}
      update.api_body = null
      update.api_key_encrypted = null
    } else if (type === 'api') {
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

      update.type = 'api'
      update.drive_url = null
      update.api_url = apiUrl
      update.api_method = body?.api_method === 'POST' ? 'POST' : 'GET'
      update.api_params = apiParams.value
      update.api_headers = apiHeaders.value
      update.api_body = typeof body?.api_body === 'string' ? body.api_body.trim() || null : null

      if (body?.api_key === null) {
        update.api_key_encrypted = null
      } else if (typeof body?.api_key === 'string' && body.api_key.trim()) {
        update.api_key_encrypted = encrypt(body.api_key.trim())
      }
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }

    const { data: updated, error } = await supabase
      .from('ai_tools')
      .update(update)
      .eq('account_id', accountId)
      .eq('id', id)
      .select('id')
      .maybeSingle()
    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: `Ya existe una herramienta llamada "${name}" en esta cuenta` },
          { status: 409 },
        )
      }
      console.error('[ai/tools/[id] PATCH] error:', error)
      return NextResponse.json({ error: 'Failed to update tool' }, { status: 500 })
    }
    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    return NextResponse.json({ success: true, name })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/ai/tools/[id]  (admin+)
 */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { id } = await params
    const { error } = await supabase
      .from('ai_tools')
      .delete()
      .eq('account_id', accountId)
      .eq('id', id)
    if (error) {
      console.error('[ai/tools/[id] DELETE] error:', error)
      return NextResponse.json({ error: 'Failed to delete tool' }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
