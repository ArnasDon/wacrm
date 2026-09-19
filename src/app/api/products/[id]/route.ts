import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { parseId } from '@/lib/db/ids'
import { scopedCollection } from '@/lib/db/scoped'
import type { ProductDoc, StockMovementDoc } from '@/lib/db/types'
import { NotFoundError, readJson } from '@/lib/http/errors'
import { parseProductInput } from '@/lib/sales/product-input'

type Params = { params: Promise<{ id: string }> }

/** GET — product + its last 50 stock movements. */
export async function GET(_request: Request, { params }: Params) {
  try {
    const ctx = await getCurrentAccount()
    const id = parseId((await params).id)
    const products = await scopedCollection<ProductDoc>(ctx, 'products')
    const product = await products.findById(id)
    if (!product) throw new NotFoundError('Product not found')
    const movements = await scopedCollection<StockMovementDoc>(ctx, 'stock_movements')
    const history = await movements.find({ productId: id }).sort({ createdAt: -1 }).limit(50).toArray()
    return NextResponse.json({ product, movements: history })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * PATCH — edit catalogue fields. Admin+. Stock is NOT editable here
 * (use POST /stock so every change leaves an audit trail) — except
 * switching tracking on/off.
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const ctx = await requireRole('admin')
    const id = parseId((await params).id)
    const body = await readJson(request)
    const input = parseProductInput(body, true)
    const products = await scopedCollection<ProductDoc>(ctx, 'products')
    const existing = await products.findById(id)
    if (!existing) throw new NotFoundError('Product not found')
    if ('stock' in input) {
      // Only allow toggling tracking; quantity changes go through /stock.
      if (input.stock === null) input.stock = null
      else if (existing.stock !== null) delete input.stock
    }
    const updated = await products.findOneAndUpdate({ _id: id }, { $set: input })
    return NextResponse.json({ product: updated })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** DELETE — archive (orders keep referencing it). Admin+. */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const ctx = await requireRole('admin')
    const id = parseId((await params).id)
    const products = await scopedCollection<ProductDoc>(ctx, 'products')
    const updated = await products.findOneAndUpdate({ _id: id }, { $set: { isActive: false } })
    if (!updated) throw new NotFoundError('Product not found')
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
