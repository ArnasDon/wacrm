import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { parseId } from '@/lib/db/ids'
import { scopedCollection } from '@/lib/db/scoped'
import type { OrderDoc, PaymentEventDoc, PaymentProofDoc } from '@/lib/db/types'
import { NotFoundError, readJson, ValidationError } from '@/lib/http/errors'
import { num, oneOf, optStr } from '@/lib/http/validate'
import { sendBusinessEmail, escapeHtml } from '@/lib/email/send'
import { formatMoney } from '@/lib/money'
import {
  cancelOrder,
  createPaymentLink,
  deliverInvoice,
  deliverReceipt,
  fulfillOrder,
  renderOrderDocument,
} from '@/lib/sales/orders'
import { markPaidManually } from '@/lib/sales/payment-proofs'

type Params = { params: Promise<{ id: string }> }

/** GET — order with its payment proofs and payment events. */
export async function GET(_request: Request, { params }: Params) {
  try {
    const ctx = await getCurrentAccount()
    const id = parseId((await params).id)
    const orders = await scopedCollection<OrderDoc>(ctx, 'orders')
    const order = await orders.findById(id)
    if (!order) throw new NotFoundError('Order not found')
    const [proofs, events] = await Promise.all([
      scopedCollection<PaymentProofDoc>(ctx, 'payment_proofs').then((c) =>
        c.find({ orderId: id }).sort({ createdAt: -1 }).toArray(),
      ),
      scopedCollection<PaymentEventDoc>(ctx, 'payment_events').then((c) =>
        c.find({ orderId: id }).sort({ createdAt: -1 }).limit(20).toArray(),
      ),
    ])
    return NextResponse.json({ order, proofs, events })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST { action, ... } — order workflow. Agent+.
 *   payment_link   { provider: paystack|flutterwave }
 *   mark_paid      { method: bank_transfer|manual, amount? (major), note? }
 *   cancel | fulfill
 *   send_invoice   (WhatsApp: summary + payment details + PDF)
 *   send_receipt   (WhatsApp + email, re-send)
 *   email_invoice  { to? }
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const ctx = await requireRole('agent')
    const id = parseId((await params).id)
    const body = await readJson(request)
    const action = oneOf(body.action, 'action', [
      'payment_link',
      'mark_paid',
      'cancel',
      'fulfill',
      'send_invoice',
      'send_receipt',
      'email_invoice',
    ] as const)
    const orders = await scopedCollection<OrderDoc>(ctx, 'orders')
    const order = await orders.findById(id)
    if (!order) throw new NotFoundError('Order not found')

    switch (action) {
      case 'payment_link': {
        const provider = oneOf(body.provider, 'provider', ['paystack', 'flutterwave'] as const)
        return NextResponse.json({ order: await createPaymentLink(ctx, id, provider, request) })
      }
      case 'mark_paid': {
        const method = oneOf(body.method, 'method', ['bank_transfer', 'manual'] as const, 'bank_transfer')
        const amount = body.amount ? Math.round(num(body.amount, 'amount', { min: 0 }) * 100) : null
        return NextResponse.json({ order: await markPaidManually(ctx, id, method, amount, optStr(body.note, 'note', 300)) })
      }
      case 'cancel':
        return NextResponse.json({ order: await cancelOrder(ctx, id) })
      case 'fulfill':
        return NextResponse.json({ order: await fulfillOrder(ctx, id) })
      case 'send_invoice':
        if (!order.conversationId) throw new ValidationError('This order has no WhatsApp conversation')
        await deliverInvoice(ctx, order, 'agent')
        return NextResponse.json({ ok: true })
      case 'send_receipt': {
        const sent = await deliverReceipt(ctx, order, request, true)
        return NextResponse.json({ ok: true, ...sent })
      }
      case 'email_invoice': {
        const to = optStr(body.to, 'to', 254) ?? order.customer.email
        if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new ValidationError('A valid email address is required')
        const { pdf, filename, account } = await renderOrderDocument(ctx, order, 'invoice')
        const biz = escapeHtml(account.business.displayName)
        const sent = await sendBusinessEmail(ctx, {
          to,
          subject: `Invoice ${order.invoiceNumber} — ${account.business.displayName}`,
          text: `Please find attached invoice ${order.invoiceNumber} for ${formatMoney(order.total, order.currency)}.${order.payment.link ? ` Pay online: ${order.payment.link}` : ''}`,
          html: `<p>Hello${order.customer.name ? ' ' + escapeHtml(order.customer.name) : ''},</p><p>Please find attached invoice <b>${escapeHtml(order.invoiceNumber ?? order.number)}</b> for <b>${escapeHtml(formatMoney(order.total, order.currency))}</b>.</p>${order.payment.link ? `<p><a href="${escapeHtml(order.payment.link)}">Pay online</a></p>` : ''}<p>— ${biz}</p>`,
          attachments: [{ filename, content: pdf, contentType: 'application/pdf' }],
        })
        if (!sent) throw new ValidationError('No email account is connected (Settings → Email)')
        return NextResponse.json({ ok: true })
      }
    }
  } catch (err) {
    return toErrorResponse(err)
  }
}
