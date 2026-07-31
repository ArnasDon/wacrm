import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { extractGoogleSheetRef } from '@/lib/ai/tools/google-sheet'

const NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/

type Params = { params: Promise<{ id: string }> }

/**
 * PATCH /api/ai/tools/[id]  (admin+) — update any subset of
 * name/description/sheet_url/is_active.
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`ai-tools:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { id } = await params
    const body = await request.json().catch(() => null)
    const name = typeof body?.name === 'string' ? body.name.trim() : undefined
    const description = typeof body?.description === 'string' ? body.description.trim() : undefined
    const sheetUrl = typeof body?.sheet_url === 'string' ? body.sheet_url.trim() : undefined
    const isActive = typeof body?.is_active === 'boolean' ? body.is_active : undefined

    if (
      name === undefined &&
      description === undefined &&
      sheetUrl === undefined &&
      isActive === undefined
    ) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }
    if (name !== undefined && !NAME_PATTERN.test(name)) {
      return NextResponse.json(
        { error: 'name must be 1-64 characters, letters/numbers/underscore/hyphen only' },
        { status: 400 },
      )
    }
    if (description !== undefined && !description) {
      return NextResponse.json({ error: 'description cannot be empty' }, { status: 400 })
    }
    if (sheetUrl !== undefined && !extractGoogleSheetRef(sheetUrl)) {
      return NextResponse.json(
        { error: 'sheet_url no parece un link válido de Google Sheets' },
        { status: 400 },
      )
    }

    const update: Record<string, string | boolean> = {}
    if (name !== undefined) update.name = name
    if (description !== undefined) update.description = description
    if (sheetUrl !== undefined) update.sheet_url = sheetUrl
    if (isActive !== undefined) update.is_active = isActive

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

    return NextResponse.json({ success: true })
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
