// ============================================================
// POST /api/public/catalog/[accountId]/quote-request
//
// Public — no auth required. A visitor on the public catalog page
// (src/app/catalog/[accountId]/page.tsx) selects products + quantities
// and submits name + phone (nit/email/address optional) here. We
// find-or-create their contact, create an exact-selection quote (never
// AI-parsed, never a caller-supplied price), and hand back a
// wa.me/<number>?text=... link so the VISITOR initiates the WhatsApp
// conversation — sidesteps Meta's 24h outbound-messaging window
// entirely, and the quote is already sitting in the pipeline by the
// time that chat lands in the inbox.
// ============================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { findOrCreateContact, resolveAuditUserId, ContactError } from '@/lib/api/v1/contacts'
import { createQuote, CreateQuoteError, type QuoteItemInput } from '@/lib/quotes/create-quote'
import { sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils'

function getClientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  const xri = request.headers.get('x-real-ip')
  if (xri) return xri.trim()
  return 'unknown'
}

interface RequestBody {
  name?: string
  phone?: string
  nit?: string
  email?: string
  address?: string
  items?: { product_id?: string; quantity?: number }[]
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  const ip = getClientIp(request)
  const limit = checkRateLimit(`public-catalog-quote:${ip}`, RATE_LIMITS.publicCatalogQuote)
  if (!limit.success) return rateLimitResponse(limit)

  const { accountId } = await params
  if (!accountId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const body = (await request.json().catch(() => null)) as RequestBody | null
  const name = body?.name?.trim() ?? ''
  const phone = body?.phone?.trim() ?? ''
  const rawItems = Array.isArray(body?.items) ? body.items : []

  if (!name) {
    return NextResponse.json({ error: 'Tu nombre es requerido' }, { status: 400 })
  }
  if (!phone) {
    return NextResponse.json({ error: 'Tu teléfono es requerido' }, { status: 400 })
  }
  if (rawItems.length === 0) {
    return NextResponse.json({ error: 'Selecciona al menos un producto' }, { status: 400 })
  }

  const items: QuoteItemInput[] = rawItems
    .filter((i) => typeof i.product_id === 'string' && i.product_id)
    .map((i) => ({ product_id: i.product_id, quantity: Number(i.quantity) || 0 }))
  if (items.length === 0) {
    return NextResponse.json({ error: 'Selecciona al menos un producto' }, { status: 400 })
  }

  const db = supabaseAdmin()

  const { data: account } = await db
    .from('accounts')
    .select('id')
    .eq('id', accountId)
    .maybeSingle()
  if (!account) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  try {
    const auditUserId = await resolveAuditUserId(db, accountId)

    const { id: contactId } = await findOrCreateContact(db, accountId, auditUserId, {
      phone,
      name,
    })

    const { quote } = await createQuote({
      db,
      accountId,
      userId: auditUserId,
      contactId,
      // Public form only requires name + phone (per product decision —
      // minimize friction for an anonymous visitor). Guatemalan
      // convention for "no tax ID given" is "C/F" (Consumidor Final);
      // email/address stay blank rather than fabricated.
      customerNit: body?.nit?.trim() || 'C/F',
      customerEmail: body?.email?.trim() || 'No proporcionado',
      customerPhone: phone,
      customerAddress: body?.address?.trim() || 'No proporcionada',
      items,
      allowFreeItems: false,
    })

    const { data: whatsapp } = await db
      .from('whatsapp_config')
      .select('public_phone_number')
      .eq('account_id', accountId)
      .eq('is_default', true)
      .maybeSingle()

    let whatsappUrl: string | null = null
    const configuredNumber = whatsapp?.public_phone_number
      ? sanitizePhoneForMeta(whatsapp.public_phone_number)
      : ''
    if (configuredNumber) {
      const message = `Hola, acabo de solicitar una cotización en su catálogo (${name}).`
      whatsappUrl = `https://wa.me/${configuredNumber}?text=${encodeURIComponent(message)}`
    }

    return NextResponse.json({ ok: true, quote_id: quote.id, whatsapp_url: whatsappUrl })
  } catch (err) {
    if (err instanceof ContactError || err instanceof CreateQuoteError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[public/catalog/quote-request] error:', err)
    return NextResponse.json({ error: 'No se pudo crear la cotización' }, { status: 500 })
  }
}
