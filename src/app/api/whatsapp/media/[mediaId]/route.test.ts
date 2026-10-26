import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  accountId: 'acc-1' as string | null,
  downloadContentType: 'image/jpeg',
  metaMimeType: 'image/jpeg',
  rateLimitOk: true,
}))

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) =>
      new Response(JSON.stringify(body), {
        status: init?.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  },
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: h.user }, error: null }),
    },
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({
          data: table === 'profiles' && h.accountId ? { account_id: h.accountId } : null,
        }),
        single: async () => ({
          data: table === 'whatsapp_config' ? { access_token: 'enc-token' } : null,
          error: null,
        }),
      }
      return chain
    },
  }),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (value: string) => `plain-${value}`,
}))

vi.mock('@/lib/rate-limit', () => ({
  RATE_LIMITS: { whatsappMedia: { limit: 240, windowMs: 60_000 } },
  checkRateLimit: () => ({ success: h.rateLimitOk }),
  rateLimitResponse: () => new Response(null, { status: 429 }),
}))

vi.mock('@/lib/whatsapp/meta-api', () => ({
  getMediaUrl: async () => ({
    url: 'https://lookaside.example/media',
    mimeType: h.metaMimeType,
    fileSize: 3,
  }),
  downloadMedia: async () => ({
    buffer: Buffer.from('abc'),
    contentType: h.downloadContentType,
  }),
}))

import { GET } from './route'

function call(mediaId = '1234567890') {
  return GET(new Request(`http://localhost/api/whatsapp/media/${mediaId}`), {
    params: Promise.resolve({ mediaId }),
  })
}

beforeEach(() => {
  h.user = { id: 'user-1' }
  h.accountId = 'acc-1'
  h.downloadContentType = 'image/jpeg'
  h.metaMimeType = 'image/jpeg'
  h.rateLimitOk = true
})

describe('GET /api/whatsapp/media/[mediaId]', () => {
  it('serves an image inline with the hardening headers', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/jpeg')
    expect(res.headers.get('content-disposition')).toBe('inline')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox")
    expect(await res.text()).toBe('abc')
  })

  it('forces a customer-sent HTML document to download', async () => {
    h.downloadContentType = 'text/html; charset=utf-8'
    h.metaMimeType = 'text/html'
    const res = await call()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toBe('attachment')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox")
  })

  it('forces an SVG image to download', async () => {
    h.downloadContentType = 'image/svg+xml'
    const res = await call()
    expect(res.headers.get('content-disposition')).toBe('attachment')
  })

  it('names a PDF download after the media id', async () => {
    h.downloadContentType = 'application/pdf'
    const res = await call('42')
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="42.pdf"')
  })

  it('never lets a shared cache store the response', async () => {
    const res = await call()
    const cacheControl = res.headers.get('cache-control') ?? ''
    expect(cacheControl).toBe('private, max-age=86400')
    expect(cacheControl).not.toContain('public')
  })

  it('rejects an unauthenticated caller before touching Meta', async () => {
    h.user = null
    const res = await call()
    expect(res.status).toBe(401)
  })

  it('rejects a caller with no linked account', async () => {
    h.accountId = null
    const res = await call()
    expect(res.status).toBe(403)
  })
})
