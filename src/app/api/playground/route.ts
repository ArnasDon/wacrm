import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { scopedCollection } from '@/lib/db/scoped'
import type { ContactDoc, ConversationDoc, MessageDoc, OrderDoc, PaymentProofDoc } from '@/lib/db/types'
import { readJson, ValidationError } from '@/lib/http/errors'
import { bool, str } from '@/lib/http/validate'
import { handleInboundMessage } from '@/lib/sales/agent'
import { getOrCreateConversation, recordInbound, upsertContactByPhone } from '@/lib/whatsapp/store'

// ============================================================
// Sales-rep playground: chat with your own AI sales rep as a test
// customer. Uses a sandbox contact (never messaged via Meta) per
// signed-in user, and runs the exact same pipeline as the webhook —
// order detection, payment links, invoices, proof uploads, receipts.
// ============================================================

/** Deterministic fake number per user: 23470000 + 7 digits from the user id. */
function sandboxPhone(userId: string): string {
  const digits = parseInt(userId.slice(-8), 16).toString().padStart(7, '0').slice(-7)
  return `23470000${digits}`
}

async function sandbox(ctx: Awaited<ReturnType<typeof requireRole>>) {
  const contact = await upsertContactByPhone(ctx, sandboxPhone(ctx.userId), 'Test customer (you)', { isSandbox: true })
  const conversation = await getOrCreateConversation(ctx, contact._id)
  return { contact, conversation }
}

async function snapshot(ctx: Awaited<ReturnType<typeof requireRole>>, conversation: ConversationDoc) {
  const messages = await scopedCollection<MessageDoc>(ctx, 'messages')
  const orders = await scopedCollection<OrderDoc>(ctx, 'orders')
  const conversations = await scopedCollection<ConversationDoc>(ctx, 'conversations')
  return {
    conversation: await conversations.findById(conversation._id),
    messages: await messages.find({ conversationId: conversation._id }).sort({ createdAt: 1 }).limit(300).toArray(),
    orders: await orders.find({ contactId: conversation.contactId }).sort({ createdAt: -1 }).limit(10).toArray(),
  }
}

export async function GET() {
  try {
    const ctx = await requireRole('admin')
    const { conversation } = await sandbox(ctx)
    return NextResponse.json(await snapshot(ctx, conversation))
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST { text } — send a message as the test customer.
 * POST { sendProof: true } — simulate the customer sending a transfer
 * screenshot (attaches a proof to their unpaid order).
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const body = await readJson(request)
    const { conversation } = await sandbox(ctx)
    const sendProof = bool(body.sendProof, 'sendProof', false)
    const text = sendProof ? null : str(body.text, 'text', { max: 1000 })
    if (!sendProof && !text) throw new ValidationError('text is required')
    const msg = await recordInbound(ctx, {
      conversation,
      waMessageId: null,
      type: sendProof ? 'image' : 'text',
      text: sendProof ? 'Here is my transfer receipt' : text,
      media: sendProof ? { id: null, mime: 'image/png', filename: 'transfer-receipt.png' } : null,
    })
    // Same pipeline as the webhook. If a handoff paused the AI, the
    // playground shows that too — "Reset" clears it.
    if (msg) await handleInboundMessage(ctx, conversation, msg)
    return NextResponse.json(await snapshot(ctx, conversation))
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** DELETE — wipe the test conversation, its orders and proofs. */
export async function DELETE() {
  try {
    const ctx = await requireRole('admin')
    const { contact, conversation } = await sandbox(ctx)
    const messages = await scopedCollection<MessageDoc>(ctx, 'messages')
    const orders = await scopedCollection<OrderDoc>(ctx, 'orders')
    const proofs = await scopedCollection<PaymentProofDoc>(ctx, 'payment_proofs')
    const conversations = await scopedCollection<ConversationDoc>(ctx, 'conversations')
    const contacts = await scopedCollection<ContactDoc>(ctx, 'contacts')
    await messages.deleteMany({ conversationId: conversation._id })
    await proofs.deleteMany({ contactId: contact._id })
    // Unpaid test orders are removed; paid ones are kept (they moved stock).
    await orders.deleteMany({ contactId: contact._id, status: { $in: ['draft', 'awaiting_payment', 'cancelled'] } })
    await conversations.updateById(conversation._id, {
      $set: { aiPaused: false, aiPausedReason: null, unreadCount: 0, lastMessagePreview: null, aiLockUntil: null, aiPending: false },
    })
    await contacts.updateById(contact._id, { $set: { name: 'Test customer (you)', email: null } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
