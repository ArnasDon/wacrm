import { NextResponse } from 'next/server'
import { isId } from '@/lib/db/ids'
import { scopedCollection, systemContext } from '@/lib/db/scoped'
import type { ProductDoc, StorageConfigDoc } from '@/lib/db/types'
import { MediaError } from '@/lib/media/common'
import { s3GetObject } from '@/lib/media/s3'
import { s3Credentials } from '@/lib/media/storage'

/**
 * GET — public image proxy for product photos kept in a PRIVATE S3
 * bucket. WhatsApp needs a public HTTPS URL to fetch a photo, and the
 * merchant's bucket doesn't have to be public: we stream the object
 * with that merchant's credentials.
 *
 * Only serves an object that (a) is referenced as a photo on a product
 * of THIS account and (b) sits in this account's folder — the path
 * can't be used to read anything else in the bucket. Product photos
 * are catalogue images, so serving them without a session is intended.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ accountId: string; imageId: string }> }) {
  const { accountId, imageId } = await params
  if (!isId(accountId) || !isId(imageId)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  try {
    const ctx = systemContext(accountId, 'media-proxy')
    const products = await scopedCollection<ProductDoc>(ctx, 'products')
    const product = await products.findOne({ 'images.id': imageId }, { projection: { images: 1 } })
    const image = product?.images?.find((i) => i.id === imageId)
    if (!image || image.provider !== 's3') return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const configs = await scopedCollection<StorageConfigDoc>(ctx, 'storage_configs')
    const cfg = await configs.findOne({ provider: 's3' })
    if (!cfg) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const obj = await s3GetObject(s3Credentials(cfg), image.publicId)
    return new Response(obj.body, {
      headers: {
        'content-type': image.mime ?? obj.contentType ?? 'image/jpeg',
        ...(obj.length ? { 'content-length': String(obj.length) } : {}),
        // Photos are immutable (new upload = new id), so cache hard at the CDN.
        'cache-control': 'public, max-age=86400, s-maxage=604800, immutable',
        'x-content-type-options': 'nosniff',
        'content-disposition': 'inline',
      },
    })
  } catch (err) {
    if (!(err instanceof MediaError)) console.error('[media-proxy]', err)
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
}
