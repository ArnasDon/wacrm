import sharp from 'sharp'
import {
  assertPublicHttpsImageUrl,
  verifyCatalogueMediaProxySignature,
} from '@/lib/catalog/media-proxy'

const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const FETCH_TIMEOUT_MS = 8_000
const PASSTHROUGH_TYPES = new Set(['image/jpeg', 'image/png'])
const CONVERTIBLE_TYPES = new Set(['image/webp', 'image/gif', 'image/avif'])

export const runtime = 'nodejs'

export async function GET(request: Request) {
  try {
    const requestUrl = new URL(request.url)
    const rawUrl = requestUrl.searchParams.get('url') ?? ''
    const signature = requestUrl.searchParams.get('sig') ?? ''
    if (!rawUrl || !verifyCatalogueMediaProxySignature(rawUrl, signature)) {
      return new Response('Invalid catalogue media signature.', { status: 403 })
    }

    const remoteUrl = assertPublicHttpsImageUrl(rawUrl)
    const response = await fetch(remoteUrl, {
      headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8' },
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'follow',
    })
    if (!response.ok) {
      return new Response(`Catalogue image returned HTTP ${response.status}.`, { status: 502 })
    }

    const contentType = (response.headers.get('content-type') ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase()
    if (!PASSTHROUGH_TYPES.has(contentType) && !CONVERTIBLE_TYPES.has(contentType)) {
      return new Response(`Unsupported catalogue image type: ${contentType || 'unknown'}.`, {
        status: 415,
      })
    }

    const declaredLength = Number(response.headers.get('content-length') ?? 0)
    if (declaredLength > MAX_IMAGE_BYTES) {
      return new Response('Catalogue image is too large.', { status: 413 })
    }

    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.byteLength <= 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
      return new Response('Catalogue image is empty or too large.', { status: 413 })
    }

    if (PASSTHROUGH_TYPES.has(contentType)) {
      return new Response(new Uint8Array(bytes), {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=3600, s-maxage=3600',
          'Content-Length': String(bytes.byteLength),
        },
      })
    }

    const converted = await sharp(bytes, { animated: false })
      .rotate()
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer()

    if (converted.byteLength <= 0 || converted.byteLength > MAX_IMAGE_BYTES) {
      return new Response('Converted catalogue image is empty or too large.', { status: 502 })
    }

    console.info('[catalog media proxy] converted image:', {
      sourceType: contentType,
      sourceBytes: bytes.byteLength,
      outputType: 'image/png',
      outputBytes: converted.byteLength,
      host: remoteUrl.hostname,
    })

    return new Response(new Uint8Array(converted), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
        'Content-Length': String(converted.byteLength),
      },
    })
  } catch (error) {
    console.error('[catalog media proxy] failed:', error)
    return new Response('Unable to prepare catalogue image.', { status: 502 })
  }
}
