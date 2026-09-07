import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { createQuote, CreateQuoteError, type QuoteItemInput } from '@/lib/quotes/create-quote'
import { parseQuoteReservations, upsertReservationRequest } from '@/lib/reservations/upsert'

// Quotes — combine the product catalog with a customer's billing info
// (NIT/email/phone/address) into a PDF-able quote, auto-linked to a
// deal. GET lists; POST creates (human path — allows free-form items
// alongside catalog products, unlike the AI's create_quote action).

export async function GET() {
  try {
    const { supabase } = await getCurrentAccount()
    // RLS (quotes_select) scopes to the caller's account.
    const { data, error } = await supabase
      .from('quotes')
      .select('*, contact:contacts(id, name, phone, email)')
      .order('created_at', { ascending: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ quotes: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  let ctx
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const contactId = typeof body.contact_id === 'string' ? body.contact_id : ''
  if (!contactId) return NextResponse.json({ error: 'contact_id is required' }, { status: 400 })

  const items: QuoteItemInput[] = Array.isArray(body.items)
    ? body.items.map((raw: Record<string, unknown>) => ({
        product_id: typeof raw.product_id === 'string' ? raw.product_id : undefined,
        quantity: Number(raw.quantity),
        description: typeof raw.description === 'string' ? raw.description : undefined,
        unit_price: raw.unit_price !== undefined ? Number(raw.unit_price) : undefined,
      }))
    : []

  const admin = supabaseAdmin()

  try {
    const { quote, items: createdItems } = await createQuote({
      db: admin,
      accountId: ctx.accountId,
      userId: ctx.userId,
      contactId,
      customerNit: typeof body.customer_nit === 'string' ? body.customer_nit : '',
      customerEmail: typeof body.customer_email === 'string' ? body.customer_email : '',
      customerPhone: typeof body.customer_phone === 'string' ? body.customer_phone : '',
      customerAddress: typeof body.customer_address === 'string' ? body.customer_address : '',
      items,
      allowFreeItems: true,
    })

    // Hotel vertical: the quote builder attaches a `reservations[]` for
    // each room/service line it captured stay details on — log each as a
    // `reservation_requests` row (→ its Google Sheet tab). Best-effort:
    // a Sheets/DB hiccup here must not fail the quote itself.
    const reservations = parseQuoteReservations(body.reservations)
    if (reservations.length > 0) {
      const { data: account } = await admin
        .from('accounts')
        .select('industry_vertical')
        .eq('id', ctx.accountId)
        .maybeSingle()
      if (account?.industry_vertical === 'hotel') {
        for (const r of reservations) {
          try {
            await upsertReservationRequest(admin, ctx.accountId, {
              ...r,
              contact_id: contactId,
              quote_id: quote.id,
              source: 'quote_builder',
            })
          } catch (err) {
            console.error('[quotes] reservation upsert failed:', err)
          }
        }
      }
    }

    return NextResponse.json({ quote: { ...quote, items: createdItems } }, { status: 201 })
  } catch (err) {
    if (err instanceof CreateQuoteError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return toErrorResponse(err)
  }
}
