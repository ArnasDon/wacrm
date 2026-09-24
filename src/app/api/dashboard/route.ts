import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { loadAccount } from '@/lib/auth/accounts'
import { scopedCollection } from '@/lib/db/scoped'
import type { AIRunDoc, ConversationDoc, OrderDoc, PaymentProofDoc, ProductDoc } from '@/lib/db/types'

/** GET — sales KPIs for the dashboard (Africa/Lagos days). */
export async function GET() {
  try {
    const ctx = await getCurrentAccount()
    const account = await loadAccount(ctx.accountId)
    const orders = await scopedCollection<OrderDoc>(ctx, 'orders')
    const products = await scopedCollection<ProductDoc>(ctx, 'products')
    const proofs = await scopedCollection<PaymentProofDoc>(ctx, 'payment_proofs')
    const conversations = await scopedCollection<ConversationDoc>(ctx, 'conversations')

    const now = new Date()
    const days = 14
    const since = new Date(now.getTime() - days * 86_400_000)
    const paidStatuses = ['paid', 'fulfilled']

    const runs = await scopedCollection<AIRunDoc>(ctx, 'ai_runs')
    const [daily, awaiting, pendingProofs, lowStock, recent, unread, aiHandoffs, lastRun] = await Promise.all([
      orders
        .aggregate<{ _id: string; revenue: number; count: number }>([
          { $match: { status: { $in: paidStatuses }, 'payment.paidAt': { $gte: since } } },
          {
            $group: {
              _id: { $dateToString: { format: '%Y-%m-%d', date: '$payment.paidAt', timezone: 'Africa/Lagos' } },
              revenue: { $sum: { $ifNull: ['$payment.amountPaid', '$total'] } },
              count: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ])
        .toArray(),
      orders.countDocuments({ status: 'awaiting_payment' }),
      proofs.countDocuments({ status: 'pending' }),
      products
        .find({ isActive: true, stock: { $ne: null } })
        .sort({ stock: 1 })
        .limit(100)
        .toArray()
        .then((rows) => rows.filter((p) => p.stock !== null && p.stock <= p.lowStockThreshold).slice(0, 10)),
      orders.find({}).sort({ createdAt: -1 }).limit(8).toArray(),
      conversations.countDocuments({ unreadCount: { $gt: 0 } }),
      conversations.countDocuments({ aiPaused: true, status: 'open' }),
      runs.findOne({}, { sort: { createdAt: -1 } }),
    ])

    // If the most recent attempt to answer a customer failed, the rep is
    // silently not replying — say so, and say whether a person needs to
    // step in until a quota resets.
    const aiAlert =
      account?.salesAgent.enabled && account.salesAgent.mode === 'ai' && lastRun && !lastRun.ok
        ? {
            kind: lastRun.errorKind ?? 'other',
            message: lastRun.error ?? 'The AI sales rep could not answer',
            at: lastRun.createdAt,
            failures: await runs.countDocuments({ ok: false, createdAt: { $gte: new Date(now.getTime() - 86_400_000) } }),
          }
        : null

    // Fill empty days so the chart has a continuous axis.
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' })
    const byDay = new Map(daily.map((d) => [d._id, d]))
    const series = Array.from({ length: days }, (_, i) => {
      const key = fmt.format(new Date(now.getTime() - (days - 1 - i) * 86_400_000))
      return { date: key, revenue: byDay.get(key)?.revenue ?? 0, orders: byDay.get(key)?.count ?? 0 }
    })
    const today = series[series.length - 1]
    const last7 = series.slice(-7)

    return NextResponse.json({
      currency: account?.currency ?? 'NGN',
      salesAgentEnabled: account?.salesAgent.enabled ?? false,
      salesAgentMode: account?.salesAgent.mode ?? 'rules',
      aiAlert,
      kpis: {
        revenueToday: today.revenue,
        revenue7d: last7.reduce((s, d) => s + d.revenue, 0),
        paidOrders7d: last7.reduce((s, d) => s + d.orders, 0),
        awaitingPayment: awaiting,
        pendingProofs,
        unreadConversations: unread,
        needsHuman: aiHandoffs,
      },
      series,
      lowStock,
      recentOrders: recent,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
