import 'server-only'
import { randomBytes } from 'node:crypto'
import { loadAccount } from '@/lib/auth/accounts'
import { isId } from '@/lib/db/ids'
import { scopedCollection, type AuthContext } from '@/lib/db/scoped'
import type {
  AccountAssetDoc,
  AccountDoc,
  ContactDoc,
  OrderDoc,
  OrderItem,
  PaymentConfigDoc,
  PaymentEventDoc,
  PaymentProvider,
  ProductDoc,
  StockMovementDoc,
} from '@/lib/db/types'
import { renderOrderPdf, type OrderDocumentKind } from '@/lib/documents/order-pdf'
import { escapeHtml, sendBusinessEmail } from '@/lib/email/send'
import { getAppBaseUrl } from '@/lib/http/base-url'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/http/errors'
import { formatMoney } from '@/lib/money'
import {
  initializePayment,
  PaymentProviderError,
  verifyTransaction,
} from '@/lib/payments/providers'
import { decrypt } from '@/lib/security/secrets'
import { sendPdf, sendText } from '@/lib/whatsapp/store'
import { notifyOrderCreated, notifyOrderPaid } from '@/lib/notify/telegram'
import { nextNumber } from './counters'

// ============================================================
// Orders: creation, payment links, payment settlement, stock and
// receipts.
//
// Invariants:
//   - prices ALWAYS come from the product catalogue at creation time
//     (never from the customer, the AI, or the request body);
//   - an order becomes 'paid' exactly once — the transition is a
//     single conditional update, so duplicate webhooks, the redirect
//     callback and a manual "mark paid" can race safely;
//   - stock is decremented once per (order, product), enforced by a
//     unique index on stock_movements.
// ============================================================

export interface OrderLineInput {
  productId: string
  quantity: number
}

export async function createOrder(
  ctx: AuthContext,
  input: {
    lines: OrderLineInput[]
    contactId?: string | null
    conversationId?: string | null
    customer?: { name?: string | null; phone?: string | null; email?: string | null }
    source: OrderDoc['source']
    notes?: string | null
    deliveryFee?: number
    discount?: number
    status?: 'draft' | 'awaiting_payment'
    allowBackorder?: boolean
  },
): Promise<OrderDoc> {
  if (input.lines.length === 0) throw new ValidationError('An order needs at least one item')
  if (input.lines.length > 50) throw new ValidationError('Too many items in one order')

  // Merge duplicate lines, validate ids + quantities.
  const qty = new Map<string, number>()
  for (const l of input.lines) {
    if (!isId(l.productId)) throw new ValidationError('Invalid product')
    if (!Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > 10_000) {
      throw new ValidationError('Quantity must be a whole number between 1 and 10,000')
    }
    qty.set(l.productId, (qty.get(l.productId) ?? 0) + l.quantity)
  }

  const products = await scopedCollection<ProductDoc>(ctx, 'products')
  const rows = await products.find({ _id: { $in: [...qty.keys()] }, isActive: true }).toArray()
  if (rows.length !== qty.size) throw new ValidationError('One or more products are unavailable')

  const shortages: string[] = []
  const items: OrderItem[] = rows.map((p) => {
    const quantity = qty.get(p._id)!
    if (p.stock !== null && p.stock < quantity) shortages.push(`${p.name} (only ${Math.max(p.stock, 0)} left)`)
    return {
      productId: p._id,
      name: p.name,
      sku: p.sku,
      unitPrice: p.price,
      quantity,
      lineTotal: p.price * quantity,
    }
  })
  if (shortages.length && !input.allowBackorder) {
    throw new ValidationError(`Not enough stock: ${shortages.join(', ')}`)
  }

  const account = await loadAccount(ctx.accountId)
  if (!account) throw new NotFoundError('Account not found')

  let customer = {
    name: input.customer?.name ?? null,
    phone: input.customer?.phone ?? null,
    email: input.customer?.email ?? null,
  }
  if (input.contactId) {
    const contacts = await scopedCollection<ContactDoc>(ctx, 'contacts')
    const contact = await contacts.findById(input.contactId)
    if (!contact) throw new ValidationError('Contact not found')
    customer = {
      name: customer.name ?? contact.name,
      phone: customer.phone ?? contact.phone,
      email: customer.email ?? contact.email,
    }
  }

  const subtotal = items.reduce((s, i) => s + i.lineTotal, 0)
  const deliveryFee = Math.max(0, Math.round(input.deliveryFee ?? 0))
  const discount = Math.min(Math.max(0, Math.round(input.discount ?? 0)), subtotal)
  const tax = Math.round(((subtotal - discount) * account.business.taxRateBps) / 10_000)
  const total = subtotal - discount + deliveryFee + tax

  const orders = await scopedCollection<OrderDoc>(ctx, 'orders')
  const seq = await nextNumber(ctx, 'order', 'ORD')
  const created = await orders.insertOne({
    number: seq,
    contactId: input.contactId ?? null,
    conversationId: input.conversationId ?? null,
    customer,
    items,
    subtotal,
    deliveryFee,
    discount,
    tax,
    total,
    currency: account.currency,
    status: input.status ?? 'awaiting_payment',
    source: input.source,
    notes: input.notes ?? null,
    stockCommitted: false,
    payment: {
      provider: null,
      reference: null,
      previousReferences: [],
      link: null,
      status: 'none',
      amountPaid: null,
      channel: null,
      providerTransactionId: null,
      paidAt: null,
    },
    invoiceNumber: seq.replace(/^ORD/, 'INV'),
    receiptNumber: null,
    receiptSentAt: null,
    createdByUserId: ctx.userId,
  })
  void notifyOrderCreated(ctx, created)
  return created
}

// ------------------------------------------------------------
// Payment links
// ------------------------------------------------------------

export async function getPaymentConfig(
  ctx: AuthContext,
  provider: PaymentProvider,
): Promise<PaymentConfigDoc | null> {
  const configs = await scopedCollection<PaymentConfigDoc>(ctx, 'payment_configs')
  return configs.findOne({ provider, enabled: true })
}

/** Reference embeds the order id so the webhook can find the order. */
function newReference(orderId: string): string {
  return `ORD-${orderId}-${randomBytes(4).toString('hex')}`
}

export function orderIdFromReference(reference: string): string | null {
  const m = /^ORD-([a-f0-9]{24})-[a-f0-9]{8}$/.exec(reference)
  return m ? m[1] : null
}

export async function createPaymentLink(
  ctx: AuthContext,
  orderId: string,
  provider: PaymentProvider,
  request?: Request,
): Promise<OrderDoc> {
  const orders = await scopedCollection<OrderDoc>(ctx, 'orders')
  const order = await orders.findById(orderId)
  if (!order) throw new NotFoundError('Order not found')
  if (order.status !== 'awaiting_payment' && order.status !== 'draft') {
    throw new ConflictError(`Order is ${order.status.replace('_', ' ')} — no payment link needed`)
  }
  if (order.total <= 0) throw new ValidationError('Order total must be greater than zero')

  const cfg = await getPaymentConfig(ctx, provider)
  if (!cfg) throw new ValidationError(`${provider === 'paystack' ? 'Paystack' : 'Flutterwave'} is not connected (Settings → Payments)`)
  const account = await loadAccount(ctx.accountId)
  if (!account) throw new NotFoundError('Account not found')

  const base = getAppBaseUrl(request)
  const reference = newReference(order._id)
  // Paystack requires an email. WhatsApp customers often have none —
  // fall back to a non-deliverable address on a reserved domain so
  // Paystack doesn't email a stranger.
  const email = order.customer.email || `wa${order.customer.phone ?? order._id}@example.com`

  let link: string
  try {
    link = await initializePayment(provider, {
      secretKey: decrypt(cfg.secretKeyEnc),
      reference,
      amountMinor: order.total,
      currency: order.currency,
      email,
      phone: order.customer.phone,
      name: order.customer.name,
      callbackUrl: `${base}/api/payments/${provider}/${ctx.accountId}/return`,
      title: account.business.displayName,
      description: `Order ${order.number}`,
      logoUrl: null,
    })
  } catch (err) {
    if (err instanceof PaymentProviderError) throw new ValidationError(err.message)
    throw err
  }

  const updated = await orders.findOneAndUpdate(
    { _id: order._id, status: { $in: ['draft', 'awaiting_payment'] } },
    {
      $set: {
        status: 'awaiting_payment',
        'payment.provider': provider,
        'payment.reference': reference,
        'payment.link': link,
        'payment.status': 'pending',
      },
      ...(order.payment.reference ? { $push: { 'payment.previousReferences': order.payment.reference } } : {}),
    },
  )
  if (!updated) throw new ConflictError('Order changed while creating the payment link')
  return updated
}

// ------------------------------------------------------------
// Settlement
// ------------------------------------------------------------

export interface PaymentDetails {
  provider: OrderDoc['payment']['provider']
  reference: string | null
  amountPaid: number
  channel: string | null
  providerTransactionId: string | null
}

/**
 * Transition an order to 'paid' exactly once. Returns the order and
 * whether THIS call performed the transition (callers only send the
 * receipt when it did).
 */
export async function markOrderPaid(
  ctx: AuthContext,
  orderId: string,
  details: PaymentDetails,
): Promise<{ order: OrderDoc; transitioned: boolean }> {
  const orders = await scopedCollection<OrderDoc>(ctx, 'orders')
  const paid = await orders.findOneAndUpdate(
    { _id: orderId, status: { $in: ['draft', 'awaiting_payment'] } },
    {
      $set: {
        status: 'paid',
        'payment.provider': details.provider,
        'payment.reference': details.reference,
        'payment.status': 'paid',
        'payment.amountPaid': details.amountPaid,
        'payment.channel': details.channel,
        'payment.providerTransactionId': details.providerTransactionId,
        'payment.paidAt': new Date(),
      },
    },
  )
  if (!paid) {
    const current = await orders.findById(orderId)
    if (!current) throw new NotFoundError('Order not found')
    return { order: current, transitioned: false }
  }
  // Numbered only after the transition won, so receipt numbers have no gaps.
  const receiptNumber = await nextNumber(ctx, 'receipt', 'RCT')
  await orders.updateById(paid._id, { $set: { receiptNumber } })
  await commitStock(ctx, paid)
  const settled = { ...paid, receiptNumber, stockCommitted: true }
  void notifyOrderPaid(ctx, settled)
  return { order: settled, transitioned: true }
}

async function commitStock(ctx: AuthContext, order: OrderDoc): Promise<void> {
  const movements = await scopedCollection<StockMovementDoc>(ctx, 'stock_movements')
  const products = await scopedCollection<ProductDoc>(ctx, 'products')
  for (const item of order.items) {
    const product = await products.findById(item.productId)
    if (!product || product.stock === null) continue
    try {
      await movements.insertOne({
        productId: item.productId,
        delta: -item.quantity,
        reason: 'order',
        orderId: order._id,
        note: `Order ${order.number}`,
        userId: ctx.userId,
      })
    } catch (err) {
      if ((err as { code?: number }).code === 11000) continue // already committed
      throw err
    }
    await products.updateOne({ _id: item.productId, stock: { $ne: null } }, { $inc: { stock: -item.quantity } })
  }
  const orders = await scopedCollection<OrderDoc>(ctx, 'orders')
  await orders.updateById(order._id, { $set: { stockCommitted: true } })
}

/**
 * Verify a transaction with the provider (never trust a webhook body
 * or a redirect query string) and settle the matching order.
 */
export async function settleFromProvider(
  ctx: AuthContext,
  provider: PaymentProvider,
  reference: string,
  request?: Request,
): Promise<{ outcome: string; order: OrderDoc | null }> {
  const orderId = orderIdFromReference(reference)
  if (!orderId) return { outcome: 'unknown_reference', order: null }
  const orders = await scopedCollection<OrderDoc>(ctx, 'orders')
  const order = await orders.findById(orderId)
  if (!order) return { outcome: 'order_not_found', order: null }
  const knownRefs = [order.payment.reference, ...(order.payment.previousReferences ?? [])]
  if (!knownRefs.includes(reference)) return { outcome: 'reference_mismatch', order }
  if (order.status === 'paid' || order.status === 'fulfilled') return { outcome: 'already_paid', order }

  const cfg = await getPaymentConfig(ctx, provider)
  if (!cfg) return { outcome: 'provider_not_configured', order }
  const tx = await verifyTransaction(provider, decrypt(cfg.secretKeyEnc), reference)

  const events = await scopedCollection<PaymentEventDoc>(ctx, 'payment_events')
  const log = async (outcome: string) => {
    await events
      .findOneAndUpdate(
        { provider, eventKey: reference },
        { $set: { provider, eventKey: reference, orderId: order._id, outcome } },
        { upsert: true },
      )
      .catch(() => {})
  }

  if (!tx.success) {
    await log('not_successful')
    return { outcome: 'not_successful', order }
  }
  if (tx.currency !== order.currency || tx.amountMinor < order.total) {
    // Underpayment or wrong currency: never auto-confirm. Staff see
    // the event and can settle manually.
    await log(`amount_mismatch:${tx.currency}:${tx.amountMinor}`)
    return { outcome: 'amount_mismatch', order }
  }

  const { order: paid, transitioned } = await markOrderPaid(ctx, order._id, {
    provider,
    reference,
    amountPaid: tx.amountMinor,
    channel: tx.channel,
    providerTransactionId: tx.providerTransactionId,
  })
  await log(transitioned ? 'paid' : 'already_paid')
  if (transitioned) await deliverReceipt(ctx, paid, request).catch((e) => console.error('[receipt] delivery failed', e))
  return { outcome: transitioned ? 'paid' : 'already_paid', order: paid }
}

// ------------------------------------------------------------
// Status changes
// ------------------------------------------------------------

export async function cancelOrder(ctx: AuthContext, orderId: string): Promise<OrderDoc> {
  const orders = await scopedCollection<OrderDoc>(ctx, 'orders')
  const updated = await orders.findOneAndUpdate(
    { _id: orderId, status: { $in: ['draft', 'awaiting_payment'] } },
    { $set: { status: 'cancelled', 'payment.link': null } },
  )
  if (!updated) throw new ConflictError('Only unpaid orders can be cancelled')
  return updated
}

export async function fulfillOrder(ctx: AuthContext, orderId: string): Promise<OrderDoc> {
  const orders = await scopedCollection<OrderDoc>(ctx, 'orders')
  const updated = await orders.findOneAndUpdate({ _id: orderId, status: 'paid' }, { $set: { status: 'fulfilled' } })
  if (!updated) throw new ConflictError('Only paid orders can be marked fulfilled')
  return updated
}

// ------------------------------------------------------------
// Documents + delivery
// ------------------------------------------------------------

export async function loadLogo(ctx: AuthContext): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const assets = await scopedCollection<AccountAssetDoc>(ctx, 'account_assets')
  const logo = await assets.findOne({ kind: 'logo' })
  return logo ? { bytes: new Uint8Array(logo.data.buffer), mime: logo.mime } : null
}

export async function renderOrderDocument(
  ctx: AuthContext,
  order: OrderDoc,
  kind: OrderDocumentKind,
): Promise<{ pdf: Uint8Array; filename: string; account: AccountDoc }> {
  if (kind === 'receipt' && order.status !== 'paid' && order.status !== 'fulfilled') {
    throw new ConflictError('A receipt is only available after payment')
  }
  const account = await loadAccount(ctx.accountId)
  if (!account) throw new NotFoundError('Account not found')
  const pdf = await renderOrderPdf({ kind, account, order, logo: await loadLogo(ctx) })
  const num = kind === 'invoice' ? order.invoiceNumber : order.receiptNumber
  return { pdf, filename: `${kind === 'invoice' ? 'Invoice' : 'Receipt'}-${num ?? order.number}.pdf`, account }
}

export function orderSummaryText(order: OrderDoc): string {
  const m = (v: number) => formatMoney(v, order.currency)
  const lines = [`*Order ${order.number}*`]
  for (const i of order.items) lines.push(`${i.quantity} × ${i.name} — ${m(i.lineTotal)}`)
  if (order.deliveryFee) lines.push(`Delivery — ${m(order.deliveryFee)}`)
  if (order.discount) lines.push(`Discount — -${m(order.discount)}`)
  if (order.tax) lines.push(`VAT — ${m(order.tax)}`)
  lines.push(`*Total: ${m(order.total)}*`)
  return lines.join('\n')
}

export function paymentInstructionsText(order: OrderDoc, account: AccountDoc): string {
  const parts: string[] = []
  if (order.payment.link) parts.push(`Pay securely here (card, transfer or USSD):\n${order.payment.link}`)
  const bank = account.business.bank
  if (bank.accountNumber) {
    parts.push(
      `${order.payment.link ? 'Or pay by' : 'Pay by'} bank transfer:\n${bank.bankName ?? ''} — ${bank.accountNumber}\n${bank.accountName ?? account.business.displayName}\nNarration: ${order.number}`,
    )
  }
  if (parts.length === 0) parts.push('A team member will share payment details shortly.')
  return parts.join('\n\n')
}

/** Send the invoice PDF + payment instructions on WhatsApp. */
export async function deliverInvoice(ctx: AuthContext, order: OrderDoc, sender: 'ai' | 'agent' | 'system'): Promise<void> {
  if (!order.conversationId) return
  const { pdf, filename, account } = await renderOrderDocument(ctx, order, 'invoice')
  await sendText(ctx, order.conversationId, `${orderSummaryText(order)}\n\n${paymentInstructionsText(order, account)}`, sender)
  await sendPdf(ctx, order.conversationId, pdf, filename, `Invoice ${order.invoiceNumber}`, `/api/orders/${order._id}/document?kind=invoice`, sender)
}

/**
 * Send the receipt on WhatsApp and by email. Guarded by a
 * conditional `receiptSentAt` claim so concurrent settlements never
 * double-send.
 */
export async function deliverReceipt(ctx: AuthContext, order: OrderDoc, _request?: Request, force = false): Promise<{ whatsapp: boolean; email: boolean }> {
  const orders = await scopedCollection<OrderDoc>(ctx, 'orders')
  if (!force) {
    const claimed = await orders.findOneAndUpdate(
      { _id: order._id, receiptSentAt: null },
      { $set: { receiptSentAt: new Date() } },
    )
    if (!claimed) return { whatsapp: false, email: false }
  }
  const { pdf, filename, account } = await renderOrderDocument(ctx, order, 'receipt')
  let whatsapp = false
  let email = false
  if (order.conversationId) {
    await sendText(
      ctx,
      order.conversationId,
      `✅ Payment received for order ${order.number} — ${formatMoney(order.payment.amountPaid ?? order.total, order.currency)}. Thank you! Your receipt is attached.`,
      'system',
    )
    await sendPdf(ctx, order.conversationId, pdf, filename, `Receipt ${order.receiptNumber}`, `/api/orders/${order._id}/document?kind=receipt`, 'system')
    whatsapp = true
  }
  if (order.customer.email) {
    const biz = escapeHtml(account.business.displayName)
    email = await sendBusinessEmail(ctx, {
      to: order.customer.email,
      subject: `Receipt ${order.receiptNumber} — ${account.business.displayName}`,
      text: `Thank you for your payment for order ${order.number}. Your receipt is attached.`,
      html: `<p>Hello${order.customer.name ? ' ' + escapeHtml(order.customer.name) : ''},</p><p>Thank you for your payment for order <b>${escapeHtml(order.number)}</b> (${escapeHtml(formatMoney(order.payment.amountPaid ?? order.total, order.currency))}).</p><p>Your receipt is attached.</p><p>— ${biz}</p>`,
      attachments: [{ filename, content: pdf, contentType: 'application/pdf' }],
    }).catch((e) => {
      console.error('[receipt] email failed', e)
      return false
    })
  }
  return { whatsapp, email }
}
