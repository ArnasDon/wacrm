import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (v: string) => `dec:${v}` }))
vi.mock('@/lib/whatsapp/meta-api', () => ({
  getMediaUrl: vi.fn(),
  downloadMedia: vi.fn(),
}))
vi.mock('@/lib/zernio/api', () => ({ downloadZernioWhatsAppMedia: vi.fn() }))

import { getMediaUrl, downloadMedia } from '@/lib/whatsapp/meta-api'
import { downloadZernioWhatsAppMedia } from '@/lib/zernio/api'
import {
  isSupportedInboundImage,
  providerSupportsVision,
  makeInboundImageResolver,
  MAX_INBOUND_IMAGE_BYTES,
} from './inbound-image'

const h = vi.mocked({ getMediaUrl, downloadMedia, downloadZernioWhatsAppMedia })

describe('isSupportedInboundImage', () => {
  it('accepts the vision-safe formats within the size cap', () => {
    expect(isSupportedInboundImage('image/jpeg', 1000)).toBe(true)
    expect(isSupportedInboundImage('image/png', 1000)).toBe(true)
    expect(isSupportedInboundImage('image/webp', 1000)).toBe(true)
    expect(isSupportedInboundImage('image/gif', 1000)).toBe(true)
    expect(isSupportedInboundImage('image/jpeg; charset=binary', 1000)).toBe(true)
  })
  it('rejects other types, zero bytes, and oversize', () => {
    expect(isSupportedInboundImage('image/heic', 1000)).toBe(false)
    expect(isSupportedInboundImage('application/pdf', 1000)).toBe(false)
    expect(isSupportedInboundImage('video/mp4', 1000)).toBe(false)
    expect(isSupportedInboundImage(null, 1000)).toBe(false)
    expect(isSupportedInboundImage('image/jpeg', 0)).toBe(false)
    expect(isSupportedInboundImage('image/jpeg', MAX_INBOUND_IMAGE_BYTES + 1)).toBe(false)
  })
})

describe('providerSupportsVision', () => {
  it('is always true for Anthropic', () => {
    expect(providerSupportsVision('anthropic', 'claude-sonnet-5')).toBe(true)
    expect(providerSupportsVision('anthropic', 'anything')).toBe(true)
  })
  it('for OpenAI, only the modern vision lines', () => {
    expect(providerSupportsVision('openai', 'gpt-4o')).toBe(true)
    expect(providerSupportsVision('openai', 'gpt-4o-mini')).toBe(true)
    expect(providerSupportsVision('openai', 'gpt-4.1')).toBe(true)
    expect(providerSupportsVision('openai', 'gpt-5')).toBe(true)
    expect(providerSupportsVision('openai', 'gpt-4-turbo')).toBe(true)
    expect(providerSupportsVision('openai', 'o3')).toBe(true)
    expect(providerSupportsVision('openai', 'gpt-3.5-turbo')).toBe(false)
    expect(providerSupportsVision('openai', 'gpt-4-0613')).toBe(false)
    expect(providerSupportsVision('openai', 'gpt-3.5-turbo-instruct')).toBe(false)
  })
})

function fakeDb(config: Record<string, unknown> | null): SupabaseClient {
  const chain = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve({ data: config, error: null }),
  }
  return chain as unknown as SupabaseClient
}

describe('makeInboundImageResolver', () => {
  beforeEach(() => {
    h.getMediaUrl.mockReset()
    h.downloadMedia.mockReset()
    h.downloadZernioWhatsAppMedia.mockReset()
  })

  it('downloads a Meta image and returns a base64 ChatImage', async () => {
    h.getMediaUrl.mockResolvedValue({ url: 'https://lookaside/x', mimeType: 'image/jpeg' })
    h.downloadMedia.mockResolvedValue({ buffer: Buffer.from('JPEGBYTES'), contentType: 'image/jpeg' })
    const resolve = makeInboundImageResolver(fakeDb({ provider: 'meta', access_token: 'enc' }), 'acct-1')

    const img = await resolve('/api/whatsapp/media/abc123', 'image/jpeg')
    expect(img).toEqual({ mimeType: 'image/jpeg', dataBase64: Buffer.from('JPEGBYTES').toString('base64') })
  })

  it('downloads a Zernio image', async () => {
    h.downloadZernioWhatsAppMedia.mockResolvedValue({
      buffer: new TextEncoder().encode('PNGBYTES').buffer,
      contentType: 'image/png',
    })
    const resolve = makeInboundImageResolver(
      fakeDb({ provider: 'zernio', zernio_api_key: 'enc', zernio_account_id: 'z1' }),
      'acct-1',
    )
    const img = await resolve('/api/whatsapp/media/z', null)
    expect(img?.mimeType).toBe('image/png')
    expect(h.downloadZernioWhatsAppMedia).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'dec:enc', accountId: 'z1', mediaId: 'z' }),
    )
  })

  it('returns null for a non-image mime the webhook already recorded (no download)', async () => {
    const resolve = makeInboundImageResolver(fakeDb({ provider: 'meta', access_token: 'e' }), 'acct-1')
    expect(await resolve('/api/whatsapp/media/x', 'audio/ogg')).toBeNull()
    expect(h.getMediaUrl).not.toHaveBeenCalled()
  })

  it('returns null when the downloaded bytes are actually a PDF', async () => {
    h.getMediaUrl.mockResolvedValue({ url: 'u', mimeType: 'image/jpeg' })
    h.downloadMedia.mockResolvedValue({ buffer: Buffer.from('%PDF'), contentType: 'application/pdf' })
    const resolve = makeInboundImageResolver(fakeDb({ provider: 'meta', access_token: 'e' }), 'acct-1')
    expect(await resolve('/api/whatsapp/media/x', null)).toBeNull()
  })

  it('returns null (never throws) when the download errors', async () => {
    h.getMediaUrl.mockRejectedValue(new Error('meta 500'))
    const resolve = makeInboundImageResolver(fakeDb({ provider: 'meta', access_token: 'e' }), 'acct-1')
    expect(await resolve('/api/whatsapp/media/x', 'image/jpeg')).toBeNull()
  })

  it('returns null for a URL that is not the media proxy shape', async () => {
    const resolve = makeInboundImageResolver(fakeDb({ provider: 'meta', access_token: 'e' }), 'acct-1')
    expect(await resolve('https://evil.example/x.jpg', 'image/jpeg')).toBeNull()
  })

  it('returns null when the account has no whatsapp_config', async () => {
    h.getMediaUrl.mockResolvedValue({ url: 'u', mimeType: 'image/jpeg' })
    const resolve = makeInboundImageResolver(fakeDb(null), 'acct-1')
    expect(await resolve('/api/whatsapp/media/x', 'image/jpeg')).toBeNull()
  })
})
