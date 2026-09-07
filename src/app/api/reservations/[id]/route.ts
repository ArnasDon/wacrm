import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'

// PATCH /api/reservations/[id] — extend a reservation request (any
// subset of fields, incl. the hotel-set `status`). Re-fires
// `reservation.updated` so its Google Sheets row is rewritten in place.
// DELETE removes it.

const STRING_FIELDS = [
  'contact_id', 'conversation_id', 'product_id', 'quote_id', 'service_name',
  'check_in', 'check_out', 'use_date', 'hall', 'decoration', 'notes',
] as const
const INT_FIELDS = ['guests', 'duration_minutes'] as const

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let ctx
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }
  const { id } = await params
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!b) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const patch: Record<string, unknown> = {}
  for (const k of STRING_FIELDS) {
    if (b[k] === undefined) continue
    patch[k] = b[k] === null ? null : String(b[k])
  }
  for (const k of INT_FIELDS) {
    if (b[k] === undefined) continue
    if (b[k] === null || b[k] === '') {
      patch[k] = null
      continue
    }
    const n = Number(b[k])
    if (Number.isFinite(n) && n >= 0) patch[k] = Math.round(n)
  }
  if (b.estimated_price !== undefined) {
    if (b.estimated_price === null || b.estimated_price === '') {
      patch.estimated_price = null
    } else {
      const n = Number(b.estimated_price)
      if (Number.isFinite(n) && n >= 0) patch.estimated_price = n
    }
  }
  if (b.status === 'pending' || b.status === 'approved' || b.status === 'denied') {
    patch.status = b.status
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const admin = supabaseAdmin()
  const { data, error } = await admin
    .from('reservation_requests')
    .update(patch)
    .eq('id', id)
    .eq('account_id', ctx.accountId)
    .select('*')
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await dispatchWebhookEvent(admin, ctx.accountId, 'reservation.updated', {
    reservation_id: id,
    source: 'manual',
  })
  return NextResponse.json({ reservation: data })
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let ctx
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }
  const { id } = await params
  const admin = supabaseAdmin()
  const { error } = await admin
    .from('reservation_requests')
    .delete()
    .eq('id', id)
    .eq('account_id', ctx.accountId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
