import 'server-only'
import { scopedCollection, type AuthContext } from '@/lib/db/scoped'
import type { ConversationDoc, MessageDoc, OrderDoc, PaymentProofDoc } from '@/lib/db/types'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/http/errors'
import { formatMoney } from '@/lib/money'
import { sendText } from '@/lib/whatsapp/store'
import { sendProofForReview } from '@/lib/notify/proof-review'
import { deliverReceipt, markOrderPaid } from './orders'

// ============================================================
// Manual bank-transfer confirmation.
//
//  1. Customer pays by transfer and sends the screenshot / PDF on
//     WhatsApp.
//  2. The inbound pipeline attaches it to their newest unpaid order
//     as a PENDING proof and acknowledges receipt.
//  3. A staff member (agent+) compares it with the bank account and
//     taps Confirm → order paid → stock committed → receipt sent.
//
// Proofs are never auto-approved: doctored transfer screenshots are
// a common scam, and the only source of truth is the bank itself.
// ============================================================

/** Called for inbound image/document messages. Returns the proof if one was created. */
export async function attachProofFromMessage(
  ctx: AuthContext,
  conversation: ConversationDoc,
  message: MessageDoc,
): Promise<PaymentProofDoc | null> {
  if (message.type !== 'image' && message.type !== 'document') return null
  const orders = await scopedCollection<OrderDoc>(ctx, 'orders')
  const order = await orders.findOne(
    { contactId: conversation.contactId, status: 'awaiting_payment' },
    { sort: { createdAt: -1 } },
  )
  if (!order) return null

  const proofs = await scopedCollection<PaymentProofDoc>(ctx, 'payment_proofs')
  const proof = await proofs.insertOne({
    orderId: order._id,
    conversationId: conversation._id,
    contactId: conversation.contactId,
    messageId: message._id,
    media: message.media,
    note: message.text,
    status: 'pending',
    reviewedByUserId: null,
    reviewedAt: null,
    reviewNote: null,
    amountConfirmed: null,
  })
  await orders.updateById(order._id, {
    $set: { 'payment.status': 'proof_submitted', 'payment.provider': order.payment.provider ?? 'bank_transfer' },
  })
  // Sends the screenshot itself with Confirm / Reject buttons, so the
  // merchant can settle it from Telegram without opening the app.
  void sendProofForReview(ctx, order, proof)
  await sendText(
    ctx,
    conversation._id,
    `Thank you! We've received your proof of payment for order ${order.number} (${formatMoney(order.total, order.currency)}). ` +
      `We'll confirm it with our bank and send your receipt shortly.`,
    'system',
  )
  return proof
}

export async function approveProof(
  ctx: AuthContext,
  proofId: string,
  amountConfirmed: number | null,
): Promise<{ order: OrderDoc; proof: PaymentProofDoc }> {
  const proofs = await scopedCollection<PaymentProofDoc>(ctx, 'payment_proofs')
  const existing = await proofs.findById(proofId)
  if (!existing) throw new NotFoundError('Payment proof not found')

  const orders = await scopedCollection<OrderDoc>(ctx, 'orders')
  const order = await orders.findById(existing.orderId)
  if (!order) throw new NotFoundError('Order not found')
  if (order.status !== 'awaiting_payment' && order.status !== 'draft') {
    throw new ConflictError(`Order ${order.number} is already ${order.status.replace('_', ' ')}`)
  }
  const amount = amountConfirmed ?? order.total
  if (!Number.isInteger(amount) || amount <= 0) throw new ValidationError('Invalid amount')
  if (amount < order.total) {
    throw new ValidationError(
      `Confirmed amount ${formatMoney(amount, order.currency)} is less than the order total ${formatMoney(order.total, order.currency)}`,
    )
  }

  // Claim the proof first (pending → approved) so two staff clicking
  // at once can't both settle it.
  const proof = await proofs.findOneAndUpdate(
    { _id: proofId, status: 'pending' },
    { $set: { status: 'approved', reviewedByUserId: ctx.userId, reviewedAt: new Date(), amountConfirmed: amount } },
  )
  if (!proof) throw new ConflictError('This proof was already reviewed')

  const { order: paid, transitioned } = await markOrderPaid(ctx, order._id, {
    provider: 'bank_transfer',
    reference: `PROOF-${proof._id}`,
    amountPaid: amount,
    channel: 'bank_transfer',
    providerTransactionId: null,
  })
  if (transitioned) await deliverReceipt(ctx, paid).catch((e) => console.error('[receipt] delivery failed', e))
  // Any other pending proofs for the same order are now moot.
  await proofs.updateMany(
    { orderId: order._id, status: 'pending', _id: { $ne: proof._id } },
    { $set: { status: 'rejected', reviewNote: 'Order already confirmed', reviewedAt: new Date() } },
  )
  return { order: paid, proof }
}

export async function rejectProof(ctx: AuthContext, proofId: string, reason: string | null): Promise<PaymentProofDoc> {
  const proofs = await scopedCollection<PaymentProofDoc>(ctx, 'payment_proofs')
  const proof = await proofs.findOneAndUpdate(
    { _id: proofId, status: 'pending' },
    { $set: { status: 'rejected', reviewedByUserId: ctx.userId, reviewedAt: new Date(), reviewNote: reason } },
  )
  if (!proof) throw new ConflictError('This proof was already reviewed')
  const orders = await scopedCollection<OrderDoc>(ctx, 'orders')
  const order = await orders.findOneAndUpdate(
    { _id: proof.orderId, status: 'awaiting_payment' },
    { $set: { 'payment.status': 'pending' } },
  )
  if (order && proof.conversationId) {
    await sendText(
      ctx,
      proof.conversationId,
      `We couldn't confirm the payment for order ${order.number} yet${reason ? `: ${reason}` : ''}. ` +
        `Please check the transfer and send a clear receipt, or reply here and we'll help.`,
      'agent',
      ctx.kind === 'user' ? ctx.userId : null,
    )
  }
  return proof
}

/** Staff marks an order paid without a gateway (cash, POS, verified transfer). */
export async function markPaidManually(
  ctx: AuthContext,
  orderId: string,
  method: 'bank_transfer' | 'manual',
  amount: number | null,
  note: string | null,
): Promise<OrderDoc> {
  const orders = await scopedCollection<OrderDoc>(ctx, 'orders')
  const order = await orders.findById(orderId)
  if (!order) throw new NotFoundError('Order not found')
  const amountPaid = amount ?? order.total
  if (amountPaid < order.total) throw new ValidationError('Amount is less than the order total')
  const { order: paid, transitioned } = await markOrderPaid(ctx, orderId, {
    provider: method,
    // Unique per order (payment.reference has a unique index).
    reference: `MANUAL-${orderId}`,
    amountPaid,
    channel: method,
    providerTransactionId: null,
  })
  if (!transitioned) throw new ConflictError(`Order is already ${paid.status}`)
  if (note) {
    await orders.updateById(orderId, {
      $set: { notes: [paid.notes, `Payment note: ${note.slice(0, 300)}`].filter(Boolean).join('\n') },
    })
  }
  const proofs = await scopedCollection<PaymentProofDoc>(ctx, 'payment_proofs')
  await proofs.updateMany(
    { orderId, status: 'pending' },
    { $set: { status: 'approved', reviewedByUserId: ctx.userId, reviewedAt: new Date(), amountConfirmed: amountPaid } },
  )
  await deliverReceipt(ctx, paid).catch((e) => console.error('[receipt] delivery failed', e))
  return paid
}
