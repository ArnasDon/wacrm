import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import {
  upsertReservationRequest,
  RESERVATION_CATEGORIES,
  type ReservationInput,
} from '@/lib/reservations/upsert'

// Hotel "solicitudes" (reservation / service requests). RLS-scoped read
// via the user client; service-role write after an explicit agent+
// check. Same shape as /api/product-categories.

export async function GET(request: Request) {
  try {
    const { supabase } = await getCurrentAccount()
    const { searchParams } = new URL(request.url)
    let q = supabase
      .from('reservation_requests')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500)
    const category = searchParams.get('category')
    if (category) q = q.eq('category', category)
    const status = searchParams.get('status')
    if (status) q = q.eq('status', status)
    const { data, error } = await q
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ reservations: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

const STRING_FIELDS = [
  'contact_id', 'conversation_id', 'product_id', 'quote_id', 'service_name',
  'check_in', 'check_out', 'use_date', 'hall', 'decoration', 'notes',
] as const
const INT_FIELDS = ['guests', 'duration_minutes'] as const

function parseBody(raw: unknown): ReservationInput | { error: string } {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const category = b.category
  if (
    typeof category !== 'string' ||
    !RESERVATION_CATEGORIES.includes(category as ReservationInput['category'])
  ) {
    return { error: `category must be one of ${RESERVATION_CATEGORIES.join(', ')}` }
  }

  const out: Record<string, unknown> = { category }

  for (const k of STRING_FIELDS) {
    if (b[k] === undefined) continue
    out[k] = b[k] === null ? null : String(b[k])
  }
  for (const k of INT_FIELDS) {
    if (b[k] === undefined) continue
    if (b[k] === null || b[k] === '') {
      out[k] = null
      continue
    }
    const n = Number(b[k])
    if (Number.isFinite(n) && n >= 0) out[k] = Math.round(n)
  }
  if (b.estimated_price !== undefined) {
    if (b.estimated_price === null || b.estimated_price === '') {
      out.estimated_price = null
    } else {
      const n = Number(b.estimated_price)
      if (Number.isFinite(n) && n >= 0) out.estimated_price = n
    }
  }
  if (b.status === 'pending' || b.status === 'approved' || b.status === 'denied') {
    out.status = b.status
  }

  return out as unknown as ReservationInput
}

export async function POST(request: Request) {
  let ctx
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const parsed = parseBody(await request.json().catch(() => null))
  if ('error' in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }

  const admin = supabaseAdmin()
  const id = await upsertReservationRequest(admin, ctx.accountId, {
    ...parsed,
    source: parsed.source ?? 'manual',
  })
  if (!id) {
    return NextResponse.json({ error: 'Could not save the request' }, { status: 500 })
  }
  const { data } = await admin
    .from('reservation_requests')
    .select('*')
    .eq('id', id)
    .single()
  return NextResponse.json({ reservation: data }, { status: 201 })
}
