import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { scopedCollection } from '@/lib/db/scoped'
import type { ProductDoc, StockMovementDoc } from '@/lib/db/types'
import { readJson } from '@/lib/http/errors'
import { hasActiveStore } from '@/lib/media/storage'
import { parseProductInput } from '@/lib/sales/product-input'

/** GET ?q=&active= — the catalogue / inventory. Any member. */
export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount()
    const url = new URL(request.url)
    const q = (url.searchParams.get('q') ?? '').trim().slice(0, 60)
    const filter: Record<string, unknown> = {}
    if (url.searchParams.get('active') === 'true') filter.isActive = true
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
      filter.$or = [{ name: rx }, { sku: rx }, { category: rx }, { aliases: rx }]
    }
    const products = await scopedCollection<ProductDoc>(ctx, 'products')
    const rows = await products.find(filter).sort({ isActive: -1, name: 1 }).limit(1000).toArray()
    return NextResponse.json({ products: rows, imageStorage: await hasActiveStore(ctx) })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** POST — add a product. Admin+ (the catalogue sets prices). */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const input = parseProductInput(await readJson(request), false)
    const products = await scopedCollection<ProductDoc>(ctx, 'products')
    const product = await products.insertOne({
      name: input.name!,
      sku: input.sku ?? null,
      description: input.description ?? null,
      category: input.category ?? null,
      unit: input.unit ?? 'pcs',
      price: input.price ?? 0,
      stock: input.stock ?? null,
      lowStockThreshold: input.lowStockThreshold ?? 5,
      aliases: input.aliases ?? [],
      isActive: input.isActive ?? true,
    })
    if (product.stock) {
      const movements = await scopedCollection<StockMovementDoc>(ctx, 'stock_movements')
      await movements.insertOne({
        productId: product._id,
        delta: product.stock,
        reason: 'restock',
        note: 'Opening stock',
        userId: ctx.userId,
      })
    }
    return NextResponse.json({ product }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
