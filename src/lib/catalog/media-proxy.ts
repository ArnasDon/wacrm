import { createHmac, timingSafeEqual } from 'node:crypto'

const SIGNATURE_VERSION = 'v1'

function signingKey(): string {
  const key = process.env.ENCRYPTION_KEY
  if (!key) throw new Error('ENCRYPTION_KEY is required for catalogue media proxy.')
  return key
}

function signatureFor(url: string): string {
  return createHmac('sha256', signingKey())
    .update(`${SIGNATURE_VERSION}:${url}`)
    .digest('hex')
}

export function buildCatalogueMediaProxyUrl(remoteUrl: string): string | null {
  const origin = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, '')
  if (!origin) return null

  const target = new URL(remoteUrl)
  if (target.protocol !== 'https:') return null

  const proxy = new URL('/api/catalog/media-proxy', origin)
  proxy.searchParams.set('url', target.toString())
  proxy.searchParams.set('sig', signatureFor(target.toString()))
  return proxy.toString()
}

export function verifyCatalogueMediaProxySignature(
  remoteUrl: string,
  providedSignature: string,
): boolean {
  if (!providedSignature || !/^[a-f0-9]{64}$/i.test(providedSignature)) return false

  const expected = signatureFor(remoteUrl)
  const expectedBuffer = Buffer.from(expected, 'hex')
  const providedBuffer = Buffer.from(providedSignature, 'hex')
  if (expectedBuffer.length !== providedBuffer.length) return false
  return timingSafeEqual(expectedBuffer, providedBuffer)
}

export function assertPublicHttpsImageUrl(raw: string): URL {
  const url = new URL(raw)
  if (url.protocol !== 'https:') throw new Error('Only HTTPS catalogue media URLs are allowed.')

  const host = url.hostname.toLowerCase()
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.endsWith('.local') ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host)
  ) {
    throw new Error('Private catalogue media URLs are not allowed.')
  }

  return url
}
