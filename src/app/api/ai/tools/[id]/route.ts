import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { encrypt } from '@/lib/whatsapp/encryption'
import { validateToolConfig } from '@/lib/ai/tools/validate'

const RETURN_COLUMNS =
  'id, name, description, method, url, headers, auth_type, auth_header_name, auth_secret, parameters, timeout_ms, is_active, created_at, updated_at'

/**
 * PATCH /api/ai/tools/[id]  (admin+)
 *
 * Partial update. `auth_secret` is write-only: omit it to keep the
 * stored credential (the form only sends it when re-entered, same
 * convention as `/api/ai/config`'s `api_key`); send an empty string to
 * clear it explicitly.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`ai-tools:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { data: existing, error: fetchErr } = await supabase
      .from('ai_tools')
      .select('auth_type, auth_secret')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (fetchErr) {
      console.error('[ai/tools PATCH] fetch error:', fetchErr)
      return NextResponse.json({ error: 'Failed to load tool' }, { status: 500 })
    }
    if (!existing) return NextResponse.json({ error: 'Tool not found' }, { status: 404 })

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    // Merge onto the existing config so validation sees the full picture
    // even on a partial save (e.g. just flipping `is_active`).
    const merged = {
      name: body.name,
      description: body.description,
      method: body.method,
      url: body.url,
      auth_type: 'auth_type' in body ? body.auth_type : existing.auth_type,
      auth_header_name: body.auth_header_name,
      auth_secret: 'auth_secret' in body ? body.auth_secret : undefined,
      parameters: body.parameters,
    }
    const authType = merged.auth_type ?? 'none'
    const hadSecret = !!existing.auth_secret
    const clearingSecret = body.auth_secret === ''
    const newSecretProvided = typeof body.auth_secret === 'string' && body.auth_secret !== ''
    const requireSecret = authType !== 'none' && !newSecretProvided && (clearingSecret || !hadSecret)

    const issues = validateToolConfig(
      { ...merged, auth_secret: newSecretProvided ? body.auth_secret : hadSecret ? 'x' : '' },
      { requireSecret },
    )
    if (issues.length > 0) {
      return NextResponse.json({ error: issues[0].message, issues }, { status: 400 })
    }

    const update: Record<string, unknown> = {}
    for (const field of ['name', 'description', 'method', 'url', 'parameters', 'timeout_ms'] as const) {
      if (field in body) update[field] = body[field]
    }
    if ('headers' in body) update.headers = body.headers ?? {}
    if ('is_active' in body) update.is_active = body.is_active !== false
    if ('auth_type' in body) update.auth_type = body.auth_type
    if ('auth_header_name' in body) update.auth_header_name = body.auth_header_name || null
    if (newSecretProvided) update.auth_secret = encrypt(String(body.auth_secret))
    else if (clearingSecret) update.auth_secret = null
    // authType flipped to 'none' — drop any stored credential so it
    // isn't silently reused if the account later flips back.
    if ('auth_type' in body && body.auth_type === 'none') update.auth_secret = null

    if (Object.keys(update).length === 0) return NextResponse.json({ ok: true })

    const { data, error } = await supabase
      .from('ai_tools')
      .update(update)
      .eq('id', id)
      .eq('account_id', accountId)
      .select(RETURN_COLUMNS)
      .single()

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'A tool with this name already exists.' },
          { status: 400 },
        )
      }
      console.error('[ai/tools PATCH] update error:', error)
      return NextResponse.json({ error: 'Failed to update tool' }, { status: 500 })
    }

    const { auth_secret, ...rest } = data
    return NextResponse.json({ tool: { ...rest, has_secret: !!auth_secret } })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { error } = await supabase
      .from('ai_tools')
      .delete()
      .eq('id', id)
      .eq('account_id', accountId)
    if (error) {
      console.error('[ai/tools DELETE] error:', error)
      return NextResponse.json({ error: 'Failed to delete tool' }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
