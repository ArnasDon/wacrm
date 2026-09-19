import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { newId, parseId } from '@/lib/db/ids'
import { scopedCollection } from '@/lib/db/scoped'
import type { ProductDoc } from '@/lib/db/types'
import { NotFoundError, ValidationError } from '@/lib/http/errors'
import { MediaError, sniffImage } from '@/lib/media/common'
import { getActiveStore } from '@/lib/media/storage'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

const MAX_BYTES = 4 * 1024 * 1024 // under Vercel's 4.5 MB request body limit
const MAX_IMAGES = 8

/** POST multipart (field "file") — add a photo to a product. Admin+. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('admin')
    const limit = checkRateLimit(`upload:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)
    const id = parseId((await params).id)

    const products = await scopedCollection<ProductDoc>(ctx, 'products')
    const product = await products.findById(id)
    if (!product) throw new NotFoundError('Product not found')
    if ((product.images?.length ?? 0) >= MAX_IMAGES) throw new ValidationError(`A product can have up to ${MAX_IMAGES} photos`)

    const form = await request.formData().catch(() => null)
    const file = form?.get('file')
    if (!file || typeof file === 'string') throw new ValidationError('Upload an image in the "file" field')
    if (file.size > MAX_BYTES) throw new ValidationError('Photo must be 4 MB or smaller')
    const bytes = new Uint8Array(await file.arrayBuffer())
    const mime = sniffImage(bytes)
    if (!mime) throw new ValidationError('Photo must be a JPEG, PNG or WebP image')

    const store = await getActiveStore(ctx)
    if (!store) throw new ValidationError('Set up photo storage first (Settings → Storage)')
    if (mime === 'image/webp' && !store.acceptsWebp) {
      throw new ValidationError('WhatsApp can’t show WebP photos from this storage — upload a JPEG or PNG')
    }

    const imageId = newId()
    let uploaded
    try {
      uploaded = await store.upload({ accountId: ctx.accountId, bytes, mime, imageId })
    } catch (err) {
      if (err instanceof MediaError) throw new ValidationError(err.message)
      throw err
    }
    const ref = { id: imageId, provider: store.provider, mime, ...uploaded }
    const updated = await products.findOneAndUpdate({ _id: id }, { $push: { images: ref } })
    return NextResponse.json({ product: updated, image: ref }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
