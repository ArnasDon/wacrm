import { NextRequest, NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { createPaymentLink } from '@/lib/razorpay/client'
import { engineSendText } from '@/lib/automations/meta-send'

/**
 * POST /api/orders/create
 *
 * Test/manual entry point: creates an order for a given contact +
 * product, generates a Razorpay Payment Link, and sends it to the
 * contact via WhatsApp.
 *
 * Body: { contact_id: string, product_id: string }
 *
 * NOTE: this route requires a logged-in dashboard session (agent+).
 * The future automation-triggered path (fired by a webhook, with no
 * user session) will need a separate service-role-authenticated
 * variant — not built yet.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole('agent')
    const { supabase, userId, accountId } = ctx

    const body = await req.json()
    const contactId = body.contact_id as string | undefined
    const productId = body.product_id as string | undefined

    if (!contactId || !productId) {
      return NextResponse.json(
        { error: 'contact_id and product_id are required' },
        { status: 400 },
      )
    }

    // 1. Load product (must belong to caller's account).
    const { data: product, error: productErr } = await supabase
      .from('products')
      .select('id, name, price, currency, status')
      .eq('id', productId)
      .eq('account_id', accountId)
      .maybeSingle()

    if (productErr || !product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

    // 2. Load contact (must belong to caller's account).
    const { data: contact, error: contactErr } = await supabase
      .from('contacts')
      .select('id, name, phone')
      .eq('id', contactId)
      .eq('account_id', accountId)
      .maybeSingle()

    if (contactErr || !contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
    }

    // 3. Resolve an existing conversation for this contact (needed to
    // send the WhatsApp message later). Mirrors the pattern used by
    // the automations engine.
    const { data: conversation, error: convErr } = await supabase
      .from('conversations')
      .select('id')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .maybeSingle()

    if (convErr || !conversation) {
      return NextResponse.json(
        { error: 'Contact has no existing conversation to send the payment link to' },
        { status: 400 },
      )
    }

    // 4. Create the order row (pending_payment).
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .insert({
        account_id: accountId,
        user_id: userId,
        contact_id: contactId,
        conversation_id: conversation.id,
        product_id: product.id,
        quantity: 1,
        unit_price: product.price,
        currency: product.currency,
        status: 'pending_payment',
        payment_provider: 'razorpay',
      })
      .select()
      .single()

    if (orderErr || !order) {
      return NextResponse.json({ error: 'Failed to create order' }, { status: 500 })
    }

    // 5. Create the Razorpay Payment Link, using the order's own id
    // as reference_id so we can always trace it back.
    let paymentLink
    try {
      paymentLink = await createPaymentLink({
        amountInRupees: product.price,
        currency: product.currency,
        description: product.name,
        referenceId: order.id,
        customerName: contact.name ?? undefined,
        customerContact: contact.phone ?? undefined,
      })
    } catch (err) {
      // Mark the order failed rather than leaving it stuck silently
      // pending with no way to pay.
      await supabase
        .from('orders')
        .update({ status: 'failed' })
        .eq('id', order.id)
      console.error('[orders/create] Razorpay error:', err)
      return NextResponse.json(
        { error: 'Failed to create payment link' },
        { status: 502 },
      )
    }

    // 6. Save the payment link details on the order.
    await supabase
      .from('orders')
      .update({
        payment_link_id: paymentLink.id,
        payment_link_url: paymentLink.short_url,
      })
      .eq('id', order.id)

    // 7. Send the payment link to the customer on WhatsApp.
    try {
      await engineSendText({
        accountId,
        userId,
        conversationId: conversation.id,
        contactId,
        text: `Thanks! Please complete your payment for ${product.name} (${product.currency} ${product.price}) using this link:\n${paymentLink.short_url}`,
      })
    } catch (err) {
      // The order + payment link exist even if the WhatsApp send
      // failed — don't fail the whole request, just report it.
      console.error('[orders/create] WhatsApp send error:', err)
      return NextResponse.json({
        order_id: order.id,
        payment_link_url: paymentLink.short_url,
        warning: 'Order created but WhatsApp message failed to send',
      })
    }

    return NextResponse.json({
      order_id: order.id,
      payment_link_url: paymentLink.short_url,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}