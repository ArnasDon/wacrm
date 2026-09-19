import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { parseId } from '@/lib/db/ids'
import { scopedCollection } from '@/lib/db/scoped'
import type { ProductDoc } from '@/lib/db/types'
import { NotFoundError } from '@/lib/http/errors'
import { getStoreFor } from '@/lib/media/storage'

type Params = { params: Promise<{ id: string; imageId: string }> }

async function load(ctx: Awaited<ReturnType<typeof requireRole>>, params: Params['params']) {
  const p = await params
  const id = parseId(p.id)
  const imageId = parseId(p.imageId, 'imageId')
  const products = await scopedCollection<ProductDoc>(ctx, 'products')
  const product = await products.findById(id)
  const image = product?.images?.find((i) => i.id === imageId)
  if (!product || !image) throw new NotFoundError('Photo not found')
  return { products, product, image }
}

/** PATCH — make this photo the cover (first). Admin+. */
export async function PATCH(_request: Request, { params }: Params) {
  try {
    const ctx = await requireRole('admin')
    const { products, product, image } = await load(ctx, params)
    const images = [image, ...(product.images ?? []).filter((i) => i.id !== image.id)]
    const updated = await products.findOneAndUpdate({ _id: product._id }, { $set: { images } })
    return NextResponse.json({ product: updated })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** DELETE — remove the photo from the product and from its storage (Cloudinary / S3). Admin+. */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const ctx = await requireRole('admin')
    const { products, product, image } = await load(ctx, params)
    const updated = await products.findOneAndUpdate({ _id: product._id }, { $pull: { images: { id: image.id } } })
    // The publicId came from THIS tenant's product and is re-checked
    // against the tenant folder inside store.remove().
    const store = await getStoreFor(ctx, image.provider ?? 'cloudinary')
    if (store) await store.remove(ctx.accountId, image.publicId).catch((e) => console.warn('[media] delete failed', e.message))
    return NextResponse.json({ product: updated })
  } catch (err) {
    return toErrorResponse(err)
  }
}
