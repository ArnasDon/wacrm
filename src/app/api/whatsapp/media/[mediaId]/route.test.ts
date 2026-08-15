import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  configQueried: false,
  downloadCalled: false,
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'user-a' } }, error: null }),
    },
    from(table: string) {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { account_id: 'account-a' }, error: null }),
            }),
          }),
        }
      }

      if (table === 'messages') {
        return {
          select: () => ({
            eq: () => ({
              eq: (column: string, accountId: string) => {
                expect(column).toBe('conversations.account_id')
                expect(accountId).toBe('account-a')
                return {
                  limit: () => ({
                    maybeSingle: async () => ({ data: null, error: null }),
                  }),
                }
              },
            }),
          }),
        }
      }

      if (table === 'whatsapp_config') {
        h.configQueried = true
        throw new Error('Config must not be queried for unowned media')
      }

      throw new Error(`Unexpected table: ${table}`)
    },
  }),
}))

vi.mock('@/lib/whatsapp/meta-api', () => ({
  getMediaUrl: vi.fn(() => {
    h.downloadCalled = true
  }),
  downloadMedia: vi.fn(),
}))
vi.mock('@/lib/zernio/api', () => ({
  downloadZernioWhatsAppMedia: vi.fn(() => {
    h.downloadCalled = true
  }),
}))
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: vi.fn() }))

import { GET } from './route'

describe('WhatsApp media tenant isolation', () => {
  it('returns 404 before reading provider credentials for unowned media', async () => {
    h.configQueried = false
    h.downloadCalled = false

    const response = await GET(new Request('https://crm.test/api/whatsapp/media/media-foreign'), {
      params: Promise.resolve({ mediaId: 'media-foreign' }),
    })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Media not found' })
    expect(h.configQueried).toBe(false)
    expect(h.downloadCalled).toBe(false)
  })
})
