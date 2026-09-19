import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { scopedCollection } from '@/lib/db/scoped'
import type { OrderDoc, PaymentProofDoc } from '@/lib/db/types'

/** GET ?status=pending|approved|rejected — review queue with order info. */
export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount()
    const status = new URL(request.url).searchParams.get('status') ?? 'pending'
    const proofs = await scopedCollection<PaymentProofDoc>(ctx, 'payment_proofs')
    const rows = await proofs
      .find(['pending', 'approved', 'rejected'].includes(status) ? { status: status as PaymentProofDoc['status'] } : {})
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray()
    const orders = await scopedCollection<OrderDoc>(ctx, 'orders')
    const byId = new Map(
      (await orders.find({ _id: { $in: rows.map((r) => r.orderId) } }).toArray()).map((o) => [o._id, o]),
    )
    return NextResponse.json({
      proofs: rows.map((p) => ({ ...p, order: byId.get(p.orderId) ?? null })),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
