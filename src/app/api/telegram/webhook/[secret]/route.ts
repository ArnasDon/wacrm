import { after, NextResponse } from 'next/server'
import { scopedCollection, systemContext } from '@/lib/db/scoped'
import { findTelegramConfigBySecret } from '@/lib/db/unscoped'
import type { OrderDoc, PaymentProofDoc, TelegramConfigDoc } from '@/lib/db/types'
import { kickBackgroundWork } from '@/lib/jobs/background'
import { formatMoney } from '@/lib/money'
import { answerCallback, escapeHtml, sendMessage } from '@/lib/notify/telegram'
import { approveProof, rejectProof } from '@/lib/sales/payment-proofs'
import { decrypt } from '@/lib/security/secrets'

// ============================================================
// Telegram → CRM. The merchant confirms a transfer from the chat
// their bank alerts already land in.
//
// Authentication is two locks that both belong to one account: the
// secret in the URL picks the account, and Telegram echoes the same
// secret in X-Telegram-Bot-Api-Secret-Token. An update is then only
// acted on if it came from a chat that completed the link flow — so
// a stranger who guesses the URL still cannot approve a payment.
//
// Telegram retries anything that isn't answered quickly, so the work
// happens after the 200.
// ============================================================

interface TgChat {
  id: number
  type: string
}
interface TgMessage {
  message_id: number
  chat: TgChat
  text?: string
  reply_to_message?: { message_id: number }
}
interface TgUpdate {
  message?: TgMessage
  callback_query?: {
    id: string
    data?: string
    message?: TgMessage
    from?: { id: number }
  }
}

const HELP = [
  '<b>What I can do</b>',
  '',
  '• <b>confirmed</b> — mark the newest transfer proof as paid; the customer gets their receipt straight away.',
  '• <b>reject &lt;reason&gt;</b> — turn a proof down and tell the customer why.',
  '• <b>pending</b> — list proofs still waiting on you.',
  '• <b>help</b> — this message.',
  '',
  'You can also reply directly to a proof, or use the buttons under it.',
].join('\n')

export async function POST(request: Request, { params }: { params: Promise<{ secret: string }> }) {
  const { secret } = await params
  const route = await findTelegramConfigBySecret(secret)
  if (!route) return NextResponse.json({ ok: true })
  if (request.headers.get('x-telegram-bot-api-secret-token') !== secret) {
    return NextResponse.json({ error: 'Invalid secret' }, { status: 401 })
  }

  let update: TgUpdate
  try {
    update = (await request.json()) as TgUpdate
  } catch {
    return NextResponse.json({ ok: true })
  }

  after(() => handle(route.accountId, update).catch((err) => console.error('[telegram] update failed:', err)))
  return NextResponse.json({ ok: true })
}

async function handle(accountId: string, update: TgUpdate) {
  const ctx = systemContext(accountId, 'telegram-webhook')
  const configs = await scopedCollection<TelegramConfigDoc>(ctx, 'telegram_configs')
  const cfg = await configs.findOne({})
  if (!cfg) return

  const message = update.callback_query?.message ?? update.message
  const chatId = message ? String(message.chat.id) : null
  // Only chats that went through the link flow may act on this account.
  if (!chatId || !cfg.chats.some((c) => c.chatId === chatId)) return

  const token = decrypt(cfg.botTokenEnc)
  const control = cfg.controlEnabled !== false
  kickBackgroundWork(accountId)

  if (update.callback_query) {
    const [kind, proofId, action] = (update.callback_query.data ?? '').split(':')
    await answerCallback(token, update.callback_query.id, control ? 'Working on it…' : 'Control is switched off')
    if (!control || kind !== 'proof' || !proofId) return
    await decide(ctx, token, chatId, proofId, action === 'approve' ? 'approve' : 'reject', null)
    return
  }

  const text = (update.message?.text ?? '').trim()
  if (!text) return
  const lower = text.toLowerCase()

  if (/^\/?(help|start)\b/.test(lower)) {
    await sendMessage(token, chatId, HELP)
    return
  }
  if (/^\/?pending\b/.test(lower)) {
    await listPending(ctx, token, chatId)
    return
  }

  const approving = /^\/?(confirmed?|paid|yes|ok)\b/.test(lower)
  const rejecting = /^\/?(reject|no|not received|decline)\b/.test(lower)
  if (!approving && !rejecting) return
  if (!control) {
    await sendMessage(token, chatId, 'Confirming payments from Telegram is switched off in Settings → Telegram.')
    return
  }

  const proofId = await targetProof(ctx, update.message?.reply_to_message?.message_id ?? null)
  if (!proofId) {
    await sendMessage(token, chatId, 'Nothing is waiting for review right now.')
    return
  }
  const reason = rejecting ? text.replace(/^\/?(reject|no|not received|decline)\b[:,\s-]*/i, '').trim() : null
  await decide(ctx, token, chatId, proofId, approving ? 'approve' : 'reject', reason || null)
}

/** The proof being answered: the one replied to, else the newest pending. */
async function targetProof(
  ctx: ReturnType<typeof systemContext>,
  replyToMessageId: number | null,
): Promise<string | null> {
  const proofs = await scopedCollection<PaymentProofDoc>(ctx, 'payment_proofs')
  if (replyToMessageId) {
    const byReply = await proofs.findOne({ status: 'pending', 'telegram.messageId': replyToMessageId })
    if (byReply) return byReply._id
  }
  const newest = await proofs.findOne({ status: 'pending' }, { sort: { createdAt: -1 } })
  return newest?._id ?? null
}

async function decide(
  ctx: ReturnType<typeof systemContext>,
  token: string,
  chatId: string,
  proofId: string,
  action: 'approve' | 'reject',
  reason: string | null,
) {
  try {
    if (action === 'approve') {
      const { order } = await approveProof(ctx, proofId, null)
      await sendMessage(
        token,
        chatId,
        `✅ <b>${escapeHtml(order.number)} marked paid</b> — ${escapeHtml(formatMoney(order.payment.amountPaid ?? order.total, order.currency))}.\nThe receipt is on its way to the customer.`,
      )
    } else {
      await rejectProof(ctx, proofId, reason)
      await sendMessage(
        token,
        chatId,
        `❌ Proof turned down${reason ? ` — <i>${escapeHtml(reason.slice(0, 200))}</i>` : ''}. The customer has been asked to check the transfer.`,
      )
    }
  } catch (err) {
    await sendMessage(token, chatId, `⚠️ ${escapeHtml((err as Error).message.slice(0, 200))}`).catch(() => {})
  }
}

async function listPending(ctx: ReturnType<typeof systemContext>, token: string, chatId: string) {
  const proofs = await scopedCollection<PaymentProofDoc>(ctx, 'payment_proofs')
  const orders = await scopedCollection<OrderDoc>(ctx, 'orders')
  const rows = await proofs.find({ status: 'pending' }).sort({ createdAt: -1 }).limit(10).toArray()
  if (rows.length === 0) {
    await sendMessage(token, chatId, 'Nothing waiting — every proof has been reviewed.')
    return
  }
  const lines: string[] = [`<b>${rows.length} proof${rows.length === 1 ? '' : 's'} waiting</b>`, '']
  for (const proof of rows) {
    const order = await orders.findById(proof.orderId)
    if (!order) continue
    const who = order.customer.name ?? (order.customer.phone ? `+${order.customer.phone}` : 'Customer')
    lines.push(`• ${escapeHtml(order.number)} — ${escapeHtml(who)} — ${escapeHtml(formatMoney(order.total, order.currency))}`)
  }
  lines.push('', 'Reply <b>confirmed</b> to approve the newest one.')
  await sendMessage(token, chatId, lines.join('\n'))
}
