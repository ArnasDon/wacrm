import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { parseId } from '@/lib/db/ids'
import { scopedCollection } from '@/lib/db/scoped'
import type { ProductDoc, StockMovementDoc } from '@/lib/db/types'
import { NotFoundError, readJson, ValidationError } from '@/lib/http/errors'
import { num, oneOf, optStr } from '@/lib/http/validate'

/**
 * POST { delta, reason: restock|adjustment, note? } — agent+.
 * Every stock change is a movement row (the audit trail) plus an
 * atomic $inc on the product.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('agent')
    const id = parseId((await params).id)
    const body = await readJson(request)
    const delta = num(body.delta, 'delta', { integer: true, min: -1_000_000, max: 1_000_000 })
    if (delta === 0) throw new ValidationError('delta cannot be zero')
    const reason = oneOf(body.reason, 'reason', ['restock', 'adjustment'] as const, delta > 0 ? 'restock' : 'adjustment')
    const note = optStr(body.note, 'note', 300)

    const products = await scopedCollection<ProductDoc>(ctx, 'products')
    const product = await products.findById(id)
    if (!product) throw new NotFoundError('Product not found')
    if (product.stock === null) throw new ValidationError('Stock tracking is off for this product')

    // Refuse to go below zero on a manual adjustment.
    const updated = await products.findOneAndUpdate(
      { _id: id, stock: { $gte: Math.max(0, -delta) } },
      { $inc: { stock: delta } },
    )
    if (!updated) throw new ValidationError(`Only ${product.stock} in stock`)
    const movements = await scopedCollection<StockMovementDoc>(ctx, 'stock_movements')
    await movements.insertOne({ productId: id, delta, reason, note, userId: ctx.userId })
    return NextResponse.json({ product: updated })
  } catch (err) {
    return toErrorResponse(err)
  }
}
