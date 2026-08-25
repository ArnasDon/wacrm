import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'

const STATUSES = new Set(['draft', 'sent', 'accepted', 'rejected', 'expired'])

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase } = await getCurrentAccount()
    const { id } = await params
    const { data: quote, error } = await supabase
      .from('quotes')
      .select('*, contact:contacts(id, name, phone, email)')
      .eq('id', id)
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!quote) return NextResponse.json({ error: 'Quote not found' }, { status: 404 })

    const { data: items, error: itemsError } = await supabase
      .from('quote_items')
      .select('*')
      .eq('quote_id', id)
      .order('position')
    if (itemsError) return NextResponse.json({ error: itemsError.message }, { status: 500 })

    return NextResponse.json({ quote: { ...quote, items: items ?? [] } })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * PATCH — status and customer-field edits only. Line items are fixed
 * once a quote is created (re-pricing would need to recompute the
 * linked deal's value too) — a wrong quote is cheaper to delete and
 * recreate than to reconcile in place.
 */
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
  if ('status' in body) {
    if (typeof body.status !== 'string' || !STATUSES.has(body.status)) {
      return NextResponse.json({ error: `status must be one of ${[...STATUSES].join(', ')}` }, { status: 400 })
    }
    update.status = body.status
  }
  // NIT/email are optional (migration 082) — an empty value clears them
  // to null rather than being rejected. Phone/address stay required.
  for (const field of ['customer_nit', 'customer_email'] as const) {
    if (field in body) {
      const value = typeof body[field] === 'string' ? body[field].trim() : ''
      update[field] = value || null
    }
  }
  for (const field of ['customer_phone', 'customer_address'] as const) {
    if (field in body) {
      const value = typeof body[field] === 'string' ? body[field].trim() : ''
      if (!value) return NextResponse.json({ error: `${field} cannot be empty` }, { status: 400 })
      update[field] = value
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: true })
  }

  const { error } = await supabaseAdmin()
    .from('quotes')
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
    .from('quotes')
    .delete()
    .eq('id', id)
    .eq('account_id', ctx.accountId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
