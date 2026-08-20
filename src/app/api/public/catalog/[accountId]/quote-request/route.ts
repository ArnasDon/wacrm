// ============================================================
// POST /api/public/catalog/[accountId]/quote-request
//
// Public — no auth required. A visitor on the public catalog page
// (src/app/catalog/[accountId]/page.tsx) selects products + quantities
// and taps "Me lo llevo". We resolve their contact and create an
// exact-selection quote (never AI-parsed, never a caller-supplied
// price), then try to deliver it two ways:
//
//   1. Instant push — if this contact already has a conversation whose
//      messaging window is open (they were just chatting with us, e.g.
//      the AI shared this very link mid-conversation), we send the
//      quote PDF straight into that conversation right now. Every agent
//      who opens the chat sees it immediately; the visitor doesn't have
//      to leave the page.
//   2. wa.me fallback — no open window and no known conversation (a
//      cold link, first-ever contact). Meta requires the CUSTOMER to
//      message first before we can send anything free-form, so we hand
//      back a wa.me link with their order pre-filled, and flag the
//      quote `auto_send_pending`. The WhatsApp webhook auto-sends the
//      PDF the moment their message (re)opens the window — see
//      src/app/api/whatsapp/webhook/route.ts. Never offered to a
//      contact we know is chatting on Instagram/Facebook instead.
//
// Contact resolution: when the visitor's link carries `?c=<conversationId>`
// (every channel's catalog link does — see sendCatalogToConversation),
// that conversation's own contact is used directly instead of
// find-or-creating one by the phone number typed into the form. This
// matters most for Instagram/Facebook visitors, who have no phone
// identity — resolving by phone would silently create an unrelated
// contact and the quote would never reach their actual chat.
// ============================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { checkSharedRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { findOrCreateContact, resolveAuditUserId, ContactError } from '@/lib/api/v1/contacts'
import { createQuote, CreateQuoteError, type QuoteItemInput } from '@/lib/quotes/create-quote'
import {
  findRecentConversation,
  isWithinMessagingWindow,
  sendQuoteToConversation,
} from '@/lib/quotes/send-quote'
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
  items?: { product_id?: string; quantity?: number; price_option_id?: string }[]
  /** The conversation this visitor's catalog link was sent from (see
   *  sendCatalogToConversation's `?c=` param) — when present and valid,
   *  delivers the quote there directly instead of guessing via
   *  findRecentConversation's "most recently updated, any channel"
   *  fallback, which could pick the wrong channel for a contact with
   *  conversations on more than one. */
  conversation_id?: string
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  const ip = getClientIp(request)
  const limit = await checkSharedRateLimit(`public-catalog-quote:${ip}`, RATE_LIMITS.publicCatalogQuote)
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
    .map((i) => ({
      product_id: i.product_id,
      price_option_id: typeof i.price_option_id === 'string' && i.price_option_id ? i.price_option_id : undefined,
      quantity: Number(i.quantity) || 0,
    }))
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

    // If this visitor's link carries `?c=<conversationId>` (see
    // sendCatalogToConversation), that conversation already has the
    // real contact — an Instagram/Facebook visitor has no phone
    // identity, so blindly find-or-creating a contact BY the phone
    // they just typed into this form would resolve to a completely
    // different (likely brand-new) contact than the one actually
    // chatting, and the "does this conversation belong to this
    // contact" check further down would then always fail — silently
    // routing every non-WhatsApp visitor to the wa.me fallback below,
    // which makes no sense for a channel that isn't WhatsApp. Resolve
    // the conversation's own contact first and skip the phone lookup
    // entirely whenever we have one.
    const requestedConversationId = body?.conversation_id?.trim()
    const requestedConv = requestedConversationId
      ? (
          await db
            .from('conversations')
            .select('id, contact_id, channel')
            .eq('id', requestedConversationId)
            .eq('account_id', accountId)
            .maybeSingle()
        ).data
      : null

    let contactId: string
    let conversationChannel: string | null = null
    const conversationContactVerified = !!requestedConv?.contact_id
    if (requestedConv?.contact_id) {
      contactId = requestedConv.contact_id as string
      conversationChannel = (requestedConv.channel as string | null) ?? 'whatsapp'
    } else {
      const created = await findOrCreateContact(db, accountId, auditUserId, { phone, name })
      contactId = created.id
    }

    // The visitor typed a phone into the form but we resolved their
    // existing (Instagram/Facebook-originated) contact instead of
    // creating one from it — save it onto that contact if it doesn't
    // have one yet, so it shows up in the contact sidebar and the
    // KPIs Excel export instead of being silently dropped. Best-effort:
    // a bad format or a collision with another contact's number must
    // not block the quote itself.
    if (conversationContactVerified) {
      const { data: existingContact } = await db
        .from('contacts')
        .select('phone')
        .eq('id', contactId)
        .maybeSingle()
      if (!existingContact?.phone) {
        await db.from('contacts').update({ phone }).eq('id', contactId).then(
          () => {},
          () => {},
        )
      }
    }

    const { quote, items: quoteItems } = await createQuote({
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

    // Try the instant path first: does this contact already have a
    // conversation whose messaging window is currently open? Prefer the
    // conversation the visitor's catalog link actually came from —
    // already verified above (contactId was resolved FROM that row, so
    // it's guaranteed to belong to both this account and this contact).
    // Only fall back to "most recently updated, any channel" when there
    // wasn't one (a cold/organic visitor who never came from a tracked
    // conversation).
    let delivered = false
    const conversation: { id: string } | null = conversationContactVerified
      ? { id: requestedConversationId! }
      : await findRecentConversation(db, accountId, contactId)
    if (conversation && (await isWithinMessagingWindow(db, conversation.id))) {
      try {
        await sendQuoteToConversation(db, accountId, quote.id, conversation.id)
        delivered = true
      } catch (err) {
        // Falls through to the wa.me path below — a failed instant
        // send (e.g. a transient Meta error) must not strand the
        // visitor with neither delivery method.
        console.error('[public/catalog/quote-request] instant send failed, falling back to wa.me:', err)
      }
    }

    let whatsappUrl: string | null = null
    // A wa.me link only makes sense when this visitor either has no
    // known conversation yet (organic/cold — WhatsApp is the product's
    // default entry point) or is already chatting on WhatsApp. Offering
    // it to a verified Instagram/Facebook conversation whose window
    // happened to close would send them to the wrong channel entirely;
    // their quote stays `auto_send_pending` and reaches them the normal
    // way (an agent replies, or they message again and reopen the
    // window) instead.
    const whatsappFallbackEligible = !conversationContactVerified || conversationChannel === 'whatsapp'
    if (!delivered) {
      await db.from('quotes').update({ auto_send_pending: true }).eq('id', quote.id)

      const { data: whatsapp } = whatsappFallbackEligible
        ? await db
            .from('whatsapp_config')
            .select('public_phone_number')
            .eq('account_id', accountId)
            .eq('is_default', true)
            .maybeSingle()
        : { data: null }

      const configuredNumber = whatsapp?.public_phone_number
        ? sanitizePhoneForMeta(whatsapp.public_phone_number)
        : ''
      if (configuredNumber) {
        // Spell out exactly what was selected so the message that lands
        // in the inbox already tells the agent/AI what to quote — the
        // visitor shouldn't have to retype their order once they're in
        // the chat. Once they send this, the webhook auto-sends the PDF.
        const itemsSummary = quoteItems
          .map((item) => `${item.quantity}x ${item.description}`)
          .join(', ')
        const message = `Hola, soy ${name}. Quiero cotizar: ${itemsSummary}.`
        whatsappUrl = `https://wa.me/${configuredNumber}?text=${encodeURIComponent(message)}`
      }
    }

    return NextResponse.json({ ok: true, quote_id: quote.id, delivered, whatsapp_url: whatsappUrl })
  } catch (err) {
    if (err instanceof ContactError || err instanceof CreateQuoteError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[public/catalog/quote-request] error:', err)
    return NextResponse.json({ error: 'No se pudo crear la cotización' }, { status: 500 })
  }
}
