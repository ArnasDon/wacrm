import 'server-only'
import { after } from 'next/server'
import { getDb } from '@/lib/db/mongo'
import { scopedCollection, systemContext } from '@/lib/db/scoped'
import type { OrderDoc } from '@/lib/db/types'
import { formatMoney } from '@/lib/money'
import { cancelOrder, settleFromProvider } from '@/lib/sales/orders'
import { sendText } from '@/lib/whatsapp/store'

// ============================================================
// Background work WITHOUT cron.
//
// Hosting plans cap scheduled jobs (Vercel free: a handful of daily
// crons), so nothing here is scheduled. Instead it piggybacks on
// traffic that already exists:
//   - every inbound WhatsApp webhook for an account, and
//   - the app's own 20-second badge poll while any team member has
//     the dashboard open.
// `kickBackgroundWork(accountId)` schedules a run with `after()`
// (after the response is sent, so it never slows a request), and a
// per-account lease in MongoDB means it executes at most once per
// LEASE_MS no matter how many requests arrive. Accounts with no
// traffic do no work — which is exactly when there's nothing to do.
//
// Every task is idempotent, so an overlapping or repeated run is
// harmless.
// ============================================================

const LEASE_MS = 60_000
const RECONCILE_AFTER_MS = 3 * 60_000 // a gateway link unpaid-but-pending this long gets re-verified
const REMINDER_AFTER_MS = 20 * 60 * 60_000 // 20h: still inside WhatsApp's 24h service window
const EXPIRE_AFTER_MS = 7 * 24 * 60 * 60_000 // unpaid orders auto-cancel after 7 days

async function acquireLease(accountId: string): Promise<boolean> {
  const db = await getDb()
  const now = new Date()
  try {
    // Matches only an EXPIRED lease (→ renew) or no lease (→ upsert).
    // A live lease doesn't match, so the upsert collides on _id.
    await db.collection<{ _id: string; until: Date }>('job_leases').updateOne(
      { _id: `bg:${accountId}`, until: { $lt: now } },
      { $set: { until: new Date(now.getTime() + LEASE_MS) } },
      { upsert: true },
    )
    return true
  } catch (err) {
    // Duplicate key = the lease exists and hasn't expired → someone else has it.
    if ((err as { code?: number }).code === 11000) return false
    throw err
  }
}

/** Fire-and-forget: schedule background work for this account after the current response. */
export function kickBackgroundWork(accountId: string): void {
  try {
    after(() =>
      runBackgroundWork(accountId).catch((err) => console.error('[background] run failed', accountId, err)),
    )
  } catch {
    // Called outside a request scope (tests/scripts) — just run it.
    void runBackgroundWork(accountId).catch(() => {})
  }
}

export async function runBackgroundWork(accountId: string): Promise<{ ran: boolean; actions: string[] }> {
  if (!(await acquireLease(accountId))) return { ran: false, actions: [] }
  const ctx = systemContext(accountId, 'background')
  const orders = await scopedCollection<OrderDoc>(ctx, 'orders')
  const now = Date.now()
  const actions: string[] = []

  // 1. Reconcile gateway payments whose webhook never arrived (local
  //    installs, misconfigured webhook URL, gateway outage). Verified
  //    against the provider API — same path as the webhook.
  const pending = await orders
    .find({
      status: 'awaiting_payment',
      'payment.provider': { $in: ['paystack', 'flutterwave'] },
      'payment.status': 'pending',
      'payment.reference': { $type: 'string' },
      updatedAt: { $lt: new Date(now - RECONCILE_AFTER_MS), $gt: new Date(now - 2 * 24 * 60 * 60_000) },
    })
    .sort({ updatedAt: 1 })
    .limit(5)
    .toArray()
  for (const o of pending) {
    try {
      const { outcome } = await settleFromProvider(ctx, o.payment.provider as 'paystack' | 'flutterwave', o.payment.reference!)
      actions.push(`reconcile:${o.number}:${outcome}`)
      // Touch updatedAt so the same order isn't re-checked every minute.
      if (outcome !== 'paid' && outcome !== 'already_paid') await orders.updateById(o._id, { $set: {} })
    } catch (err) {
      actions.push(`reconcile:${o.number}:error`)
      console.warn('[background] reconcile failed', o.number, (err as Error).message)
    }
  }

  // 2. One friendly payment reminder, ~20h after the order (still
  //    inside WhatsApp's 24-hour customer-service window).
  const due = await orders
    .find({
      status: 'awaiting_payment',
      conversationId: { $type: 'string' },
      reminderSentAt: { $in: [null] },
      'payment.status': { $ne: 'proof_submitted' },
      createdAt: { $lt: new Date(now - REMINDER_AFTER_MS), $gt: new Date(now - 23 * 60 * 60_000) },
    })
    .limit(10)
    .toArray()
  for (const o of due) {
    const claimed = await orders.findOneAndUpdate(
      { _id: o._id, reminderSentAt: { $in: [null] } },
      { $set: { reminderSentAt: new Date() } },
    )
    if (!claimed || !o.conversationId) continue
    await sendText(
      ctx,
      o.conversationId,
      `Hi${o.customer.name ? ' ' + o.customer.name.split(' ')[0] : ''}! Just a reminder that order ${o.number} (${formatMoney(o.total, o.currency)}) is still waiting for payment.` +
        (o.payment.link ? `\nYou can pay here: ${o.payment.link}` : '') +
        `\nReply here if you need any help. 🙏`,
      'system',
    )
    actions.push(`reminder:${o.number}`)
  }

  // 3. Expire unpaid orders after 7 days so the Orders list stays
  //    clean (stock is only committed on payment, so nothing to release).
  const stale = await orders
    .find({ status: { $in: ['draft', 'awaiting_payment'] }, createdAt: { $lt: new Date(now - EXPIRE_AFTER_MS) } })
    .limit(20)
    .toArray()
  for (const o of stale) {
    await cancelOrder(ctx, o._id).catch(() => {})
    await orders.updateById(o._id, { $set: { notes: [o.notes, 'Auto-cancelled: unpaid after 7 days'].filter(Boolean).join('\n') } })
    actions.push(`expired:${o.number}`)
  }

  if (actions.length) console.info('[background]', accountId, actions.join(', '))
  return { ran: true, actions }
}
