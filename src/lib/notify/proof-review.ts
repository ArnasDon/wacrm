import 'server-only'
import { scopedCollection, type AuthContext } from '@/lib/db/scoped'
import type { OrderDoc, PaymentProofDoc } from '@/lib/db/types'
import { formatMoney } from '@/lib/money'
import { downloadMedia, getMediaUrl } from '@/lib/whatsapp/meta-api'
import { getWhatsAppCredentials } from '@/lib/whatsapp/store'
import { escapeHtml, sendMessage, sendPhoto, telegramTarget } from './telegram'

// ============================================================
// Transfer proofs, reviewed from Telegram.
//
// The customer's screenshot goes to the merchant's Telegram with the
// order beside it, so the decision can be made where the merchant
// already is — their bank app is on the same phone. Confirming there
// runs exactly the same code as the Confirm button in Orders.
//
// Best-effort throughout: Telegram being down must never stop a proof
// being recorded, it only means the merchant reviews it in the app.
// ============================================================

/** How long the merchant gets before we nudge them again. */
export const REMINDER_AFTER_MS = 5 * 60_000

function reviewCaption(order: OrderDoc, note: string | null, chasing = false): string {
  const who = escapeHtml(order.customer.name ?? (order.customer.phone ? `+${order.customer.phone}` : 'A customer'))
  const amount = escapeHtml(formatMoney(order.total, order.currency))
  return [
    chasing ? `⏰ <b>Still waiting on you</b>` : `🧾 <b>Transfer proof to review</b>`,
    `${who} sent proof for <b>${escapeHtml(order.number)}</b> — ${amount}`,
    note ? `<i>${escapeHtml(note.slice(0, 200))}</i>` : '',
    '',
    'Check your bank app, then tap a button below or reply <b>confirmed</b>.',
  ]
    .filter(Boolean)
    .join('\n')
}

function buttons(proofId: string) {
  return [
    [
      { text: '✅ Payment received', callback_data: `proof:${proofId}:approve` },
      { text: '❌ Not received', callback_data: `proof:${proofId}:reject` },
    ],
  ]
}

/** Fetch the screenshot the customer sent on WhatsApp. */
async function proofImage(
  ctx: AuthContext,
  proof: PaymentProofDoc,
): Promise<{ bytes: Uint8Array; filename: string; mime: string } | null> {
  const mediaId = proof.media?.id
  if (!mediaId || !/^\d{5,40}$/.test(mediaId)) return null
  const creds = await getWhatsAppCredentials(ctx)
  if (!creds) return null
  const info = await getMediaUrl({ mediaId, accessToken: creds.accessToken })
  const { buffer, contentType } = await downloadMedia({ downloadUrl: info.url, accessToken: creds.accessToken })
  const mime = contentType || info.mimeType || proof.media?.mime || 'image/jpeg'
  if (!mime.startsWith('image/')) return null
  return {
    bytes: new Uint8Array(buffer),
    filename: proof.media?.filename ?? 'transfer.jpg',
    mime,
  }
}

/**
 * Send a proof to the merchant's Telegram for a decision. Records
 * where it landed so a plain "confirmed" reply can be matched back to
 * this proof, and so the reminder knows what it is chasing.
 */
export async function sendProofForReview(ctx: AuthContext, order: OrderDoc, proof: PaymentProofDoc): Promise<void> {
  try {
    const target = await telegramTarget(ctx)
    if (!target) return
    const caption = reviewCaption(order, proof.note)
    const keyboard = target.controlEnabled ? buttons(proof._id) : undefined

    let image: Awaited<ReturnType<typeof proofImage>> = null
    try {
      image = await proofImage(ctx, proof)
    } catch (err) {
      console.warn('[telegram] could not fetch proof image', (err as Error).message)
    }

    let first: { chatId: string; messageId: number } | null = null
    for (const chat of target.chats) {
      try {
        const messageId = image
          ? await sendPhoto(target.token, chat.chatId, image, caption, keyboard)
          : await sendMessage(target.token, chat.chatId, `${caption}\n\n<i>(the screenshot is in the app)</i>`, keyboard)
        if (!first) first = { chatId: chat.chatId, messageId }
      } catch (err) {
        console.warn('[telegram] proof send failed', (err as Error).message)
      }
    }
    if (!first) return

    const proofs = await scopedCollection<PaymentProofDoc>(ctx, 'payment_proofs')
    await proofs.updateById(proof._id, {
      $set: { telegram: { chatId: first.chatId, messageId: first.messageId, sentAt: new Date(), remindedAt: null } },
    })
  } catch (err) {
    console.warn('[telegram] proof review failed', (err as Error).message)
  }
}

/**
 * Chase proofs nobody has answered. Runs from the background worker,
 * so it fires on the next request after the five minutes are up rather
 * than on a timer — close enough for a nudge, and it needs no cron.
 */
export async function remindStaleProofs(ctx: AuthContext): Promise<number> {
  const proofs = await scopedCollection<PaymentProofDoc>(ctx, 'payment_proofs')
  const stale = await proofs
    .find({
      status: 'pending',
      'telegram.remindedAt': null,
      'telegram.sentAt': { $lt: new Date(Date.now() - REMINDER_AFTER_MS) },
    })
    .limit(10)
    .toArray()
  if (stale.length === 0) return 0

  const target = await telegramTarget(ctx)
  if (!target) return 0
  const orders = await scopedCollection<OrderDoc>(ctx, 'orders')
  let sent = 0
  for (const proof of stale) {
    // Claim it first: two overlapping workers must not both nudge.
    const claimed = await proofs.findOneAndUpdate(
      { _id: proof._id, status: 'pending', 'telegram.remindedAt': null },
      { $set: { 'telegram.remindedAt': new Date() } },
    )
    if (!claimed) continue
    const order = await orders.findById(proof.orderId)
    if (!order || order.status !== 'awaiting_payment') continue
    const chatId = proof.telegram?.chatId
    if (!chatId) continue
    await sendMessage(
      target.token,
      chatId,
      reviewCaption(order, proof.note, true),
      target.controlEnabled ? buttons(proof._id) : undefined,
    ).catch((err) => console.warn('[telegram] reminder failed', (err as Error).message))
    sent++
  }
  return sent
}
