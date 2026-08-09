import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WacrmSupabaseClient } from '@/lib/supabase/types'
import { createWhatsAppImageResolver, MAX_AI_IMAGE_BYTES } from './image-context'

const mocks = vi.hoisted(() => ({
  decrypt: vi.fn(() => 'plain-token'),
  getMediaUrl: vi.fn(),
  downloadMedia: vi.fn(),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: mocks.decrypt }))
vi.mock('@/lib/whatsapp/meta-api', () => ({
  getMediaUrl: mocks.getMediaUrl,
  downloadMedia: mocks.downloadMedia,
}))

function fakeDb(): WacrmSupabaseClient {
  const chain = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    maybeSingle: () =>
      Promise.resolve({
        data: { access_token: 'encrypted-token' },
        error: null,
      }),
  }
  return chain as unknown as WacrmSupabaseClient
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getMediaUrl.mockResolvedValue({
    url: 'https://lookaside.meta.test/image',
    mimeType: 'image/jpeg',
  })
  mocks.downloadMedia.mockResolvedValue({
    buffer: Buffer.from('pixels'),
    contentType: 'image/jpeg',
  })
})

describe('createWhatsAppImageResolver', () => {
  it('downloads private Meta media and returns a base64 data URL', async () => {
    const resolve = createWhatsAppImageResolver(fakeDb(), 'account-1')
    await expect(resolve('/api/whatsapp/media/media-1')).resolves.toEqual({
      type: 'image_url',
      url: `data:image/jpeg;base64,${Buffer.from('pixels').toString('base64')}`,
      mediaType: 'image/jpeg',
    })
    expect(mocks.getMediaUrl).toHaveBeenCalledWith({
      mediaId: 'media-1',
      accessToken: 'plain-token',
    })
  })

  it('loads and decrypts the account token only once for several images', async () => {
    const db = fakeDb()
    const resolve = createWhatsAppImageResolver(db, 'account-1')
    await resolve('/api/whatsapp/media/one')
    await resolve('/api/whatsapp/media/two')
    expect(mocks.decrypt).toHaveBeenCalledOnce()
  })

  it('ignores external URLs, unsupported formats and oversized images', async () => {
    const resolve = createWhatsAppImageResolver(fakeDb(), 'account-1')
    await expect(resolve('https://example.com/image.jpg')).resolves.toBeNull()
    expect(mocks.getMediaUrl).not.toHaveBeenCalled()

    mocks.downloadMedia.mockResolvedValueOnce({
      buffer: Buffer.from('heic'),
      contentType: 'image/heic',
    })
    await expect(resolve('/api/whatsapp/media/heic')).resolves.toBeNull()

    mocks.downloadMedia.mockResolvedValueOnce({
      buffer: Buffer.alloc(MAX_AI_IMAGE_BYTES + 1),
      contentType: 'image/png',
    })
    await expect(resolve('/api/whatsapp/media/large')).resolves.toBeNull()
  })

  it('degrades to null when Meta media retrieval fails', async () => {
    mocks.getMediaUrl.mockRejectedValueOnce(new Error('expired'))
    const resolve = createWhatsAppImageResolver(fakeDb(), 'account-1')
    await expect(resolve('/api/whatsapp/media/missing')).resolves.toBeNull()
  })
})
