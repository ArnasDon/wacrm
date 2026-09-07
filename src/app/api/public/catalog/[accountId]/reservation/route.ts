// ============================================================
// POST /api/public/catalog/[accountId]/reservation
//
// Public — no auth. A visitor on the public catalog page fills the
// "Cotiza tu estadía / servicio" panel for a hotel product (a room,
// spa service, activity, package or event) with the fields that
// category needs, and we log it as a `reservation_requests` row
// (migration 112) → the per-category Google Sheet tab.
//
// Contact resolution mirrors the quote-request route: an HMAC-signed
// `?c=<conversationId>` on the link uses that conversation's own
// contact (so a catalog request and the AI chat in the same
// conversation converge on ONE reservation row); otherwise
// find-or-create by the phone typed into the form.
// ============================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { checkSharedRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { findOrCreateContact, resolveAuditUserId, ContactError } from '@/lib/api/v1/contacts'
import { verifyCatalogConversation } from '@/lib/products/catalog-link-token'
import {
  upsertReservationRequest,
  categorySlugFromName,
  type ReservationInput,
} from '@/lib/reservations/upsert'
import { quoteStay, occupancyForGuests, type ProductRate } from '@/lib/products/rates'
import { formatCurrency } from '@/lib/currency'

function getClientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  const xri = request.headers.get('x-real-ip')
  if (xri) return xri.trim()
  return 'unknown'
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

interface Body {
  product_id?: string
  name?: string
  phone?: string
  email?: string
  guests?: number | string
  check_in?: string
  check_out?: string
  use_date?: string
  duration_minutes?: number | string
  conversation_id?: string
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  const ip = getClientIp(request)
  const limit = await checkSharedRateLimit(
    `public-catalog-reservation:${ip}`,
    RATE_LIMITS.publicCatalogQuote,
  )
  if (!limit.success) return rateLimitResponse(limit)

  const { accountId } = await params
  if (!accountId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = (await request.json().catch(() => null)) as Body | null
  const name = body?.name?.trim() ?? ''
  const phone = body?.phone?.trim() ?? ''
  const productId = typeof body?.product_id === 'string' ? body.product_id : ''

  if (!name) return NextResponse.json({ error: 'Tu nombre es requerido' }, { status: 400 })
  if (!phone) return NextResponse.json({ error: 'Tu teléfono es requerido' }, { status: 400 })
  if (!productId) return NextResponse.json({ error: 'Selecciona un servicio' }, { status: 400 })

  const db = supabaseAdmin()

  const { data: account } = await db
    .from('accounts')
    .select('id, default_currency, industry_vertical')
    .eq('id', accountId)
    .maybeSingle()
  if (!account) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (account.industry_vertical !== 'hotel') {
    return NextResponse.json({ error: 'Not available' }, { status: 404 })
  }

  const { data: product } = await db
    .from('products')
    .select('id, name, price, category_id, is_active')
    .eq('account_id', accountId)
    .eq('id', productId)
    .maybeSingle()
  if (!product || !product.is_active) {
    return NextResponse.json({ error: 'Servicio no disponible' }, { status: 404 })
  }

  let categoryName: string | null = null
  if (product.category_id) {
    const { data: cat } = await db
      .from('product_categories')
      .select('name')
      .eq('id', product.category_id as string)
      .maybeSingle()
    categoryName = (cat?.name as string) ?? null
  }
  const category = categorySlugFromName(categoryName)
  if (!category) {
    return NextResponse.json(
      { error: 'Este producto no admite solicitudes en línea' },
      { status: 400 },
    )
  }

  const currency = (account.default_currency as string) || 'USD'
  const guests = toInt(body?.guests)
  const checkIn = toDate(body?.check_in)
  const checkOut = toDate(body?.check_out)
  const useDate = toDate(body?.use_date)
  const durationMinutes = toInt(body?.duration_minutes)

  // Estimated price: a room/package with per-day rates and both dates
  // → price the stay night by night; otherwise the product's base price.
  let estimatedPrice: number | null =
    typeof product.price === 'number' && product.price > 0 ? product.price : null
  let stayTotal: number | null = null
  let stayNights: number | null = null
  if ((category === 'habitaciones' || category === 'paquetes') && checkIn && checkOut) {
    const { data: rates } = await db
      .from('product_rates')
      .select('day_of_week, occupancy, price, date_from, date_to')
      .eq('product_id', product.id as string)
    const stay = quoteStay(
      (rates ?? []) as ProductRate[],
      checkIn,
      checkOut,
      occupancyForGuests(guests ?? 1),
    )
    if (stay.nights.length > 0) {
      stayNights = stay.nights.length
      if (stay.missing.length === 0 && stay.total > 0) {
        stayTotal = stay.total
        estimatedPrice = stay.total
      }
    }
  }

  try {
    const auditUserId = await resolveAuditUserId(db, accountId)

    const requestedConversationId = verifyCatalogConversation(body?.conversation_id)
    const requestedConv = requestedConversationId
      ? (
          await db
            .from('conversations')
            .select('id, contact_id')
            .eq('id', requestedConversationId)
            .eq('account_id', accountId)
            .maybeSingle()
        ).data
      : null

    let contactId: string
    let conversationId: string | null = null
    if (requestedConv?.contact_id) {
      contactId = requestedConv.contact_id as string
      conversationId = requestedConv.id as string
    } else {
      const created = await findOrCreateContact(db, accountId, auditUserId, { phone, name })
      contactId = created.id
    }

    const input: ReservationInput = {
      category,
      contact_id: contactId,
      conversation_id: conversationId ?? undefined,
      product_id: product.id as string,
      service_name: product.name as string,
      source: 'catalog',
    }
    if (guests !== undefined) input.guests = guests
    if (checkIn) input.check_in = checkIn
    if (checkOut) input.check_out = checkOut
    if (useDate) input.use_date = useDate
    if (durationMinutes !== undefined) input.duration_minutes = durationMinutes
    if (estimatedPrice != null) input.estimated_price = estimatedPrice

    const id = await upsertReservationRequest(db, accountId, input)
    if (!id) {
      return NextResponse.json({ error: 'No se pudo registrar la solicitud' }, { status: 500 })
    }

    // Human-readable recap for the on-page confirmation.
    const bits: string[] = [product.name as string]
    if (checkIn && checkOut) bits.push(`${checkIn} → ${checkOut}`)
    else if (useDate) bits.push(useDate)
    if (guests !== undefined) bits.push(`${guests} ${guests === 1 ? 'persona' : 'personas'}`)
    if (durationMinutes !== undefined) bits.push(`${durationMinutes} min`)
    if (stayTotal != null) {
      bits.push(`total estimado ${formatCurrency(stayTotal, currency)}${stayNights ? ` (${stayNights} ${stayNights === 1 ? 'noche' : 'noches'})` : ''}`)
    } else if (estimatedPrice != null) {
      bits.push(`desde ${formatCurrency(estimatedPrice, currency)}`)
    }

    return NextResponse.json({
      ok: true,
      reservation_id: id,
      summary: `Registramos tu solicitud: ${bits.join(' · ')}. Te contactamos para confirmar la disponibilidad.`,
    })
  } catch (err) {
    if (err instanceof ContactError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[public/catalog/reservation] error:', err)
    return NextResponse.json({ error: 'No se pudo registrar la solicitud' }, { status: 500 })
  }
}

function toInt(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined
}
function toDate(v: unknown): string | undefined {
  return typeof v === 'string' && ISO_DATE.test(v) ? v : undefined
}
