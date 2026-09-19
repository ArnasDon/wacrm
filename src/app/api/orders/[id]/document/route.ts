import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { parseId } from '@/lib/db/ids'
import { scopedCollection } from '@/lib/db/scoped'
import type { OrderDoc } from '@/lib/db/types'
import { NotFoundError } from '@/lib/http/errors'
import { oneOf } from '@/lib/http/validate'
import { renderOrderDocument } from '@/lib/sales/orders'

/** GET ?kind=invoice|receipt[&download=1] — branded PDF. Any member. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getCurrentAccount()
    const id = parseId((await params).id)
    const url = new URL(request.url)
    const kind = oneOf(url.searchParams.get('kind'), 'kind', ['invoice', 'receipt'] as const, 'invoice')
    const orders = await scopedCollection<OrderDoc>(ctx, 'orders')
    const order = await orders.findById(id)
    if (!order) throw new NotFoundError('Order not found')
    const { pdf, filename } = await renderOrderDocument(ctx, order, kind)
    const disposition = url.searchParams.get('download') ? 'attachment' : 'inline'
    return new Response(new Uint8Array(pdf), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `${disposition}; filename="${filename}"`,
        'cache-control': 'private, no-store',
      },
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
