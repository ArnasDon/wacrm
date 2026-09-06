import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'

// Rename / reorder / delete one catalog category (migration 106).
// Deleting a category leaves its products in place — `products.category_id`
// is `ON DELETE SET NULL`.

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  let ctx
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const update: Record<string, unknown> = {}
  if ('name' in body) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 })
    update.name = name
  }
  if ('position' in body) {
    const position = Number(body.position)
    if (!Number.isInteger(position) || position < 0) {
      return NextResponse.json({ error: 'position must be a non-negative integer' }, { status: 400 })
    }
    update.position = position
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
  }

  const { error } = await supabaseAdmin()
    .from('product_categories')
    .update(update)
    .eq('id', id)
    .eq('account_id', ctx.accountId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  let ctx
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const { error } = await supabaseAdmin()
    .from('product_categories')
    .delete()
    .eq('id', id)
    .eq('account_id', ctx.accountId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
