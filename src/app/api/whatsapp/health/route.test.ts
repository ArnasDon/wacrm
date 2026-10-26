import { beforeEach, describe, expect, it, vi } from 'vitest'

let storedConfig: Record<string, unknown> | null = null
const getPhoneNumberHealth = vi.fn()

vi.mock('@/lib/auth/account', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/account')>('@/lib/auth/account')
  return {
    ...actual,
    getCurrentAccount: vi.fn(async () => ({
      userId: 'user-1',
      accountId: 'acct-1',
      role: 'viewer',
      account: { id: 'acct-1', name: 'Acme' },
      supabase: {
        from: () => {
          const b: Record<string, unknown> = {}
          b.select = () => b
          b.eq = () => b
          b.maybeSingle = async () => ({ data: storedConfig, error: null })
          return b
        },
      },
    })),
  }
})

vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (v: string) => `plain:${v}` }))
vi.mock('@/lib/whatsapp/meta-api', () => ({
  getPhoneNumberHealth: (args: unknown) => getPhoneNumberHealth(args),
}))

import { GET } from './route'

beforeEach(() => {
  storedConfig = null
  getPhoneNumberHealth.mockReset()
})

describe('GET /api/whatsapp/health', () => {
  it('reports disconnected without calling Meta when no number is connected', async () => {
    const res = await GET()
    expect(await res.json()).toMatchObject({ state: 'disconnected', quality: 'UNKNOWN', limit: null })
    expect(getPhoneNumberHealth).not.toHaveBeenCalled()
  })

  it('returns the quality rating and messaging limit from Meta', async () => {
    storedConfig = { phone_number_id: 'pn-1', access_token: 'enc', status: 'connected' }
    getPhoneNumberHealth.mockResolvedValue({
      id: 'pn-1',
      display_phone_number: '+44 7700 900123',
      quality_rating: 'GREEN',
      whatsapp_business_manager_messaging_limit: 'TIER_2K',
    })
    const res = await GET()
    expect(getPhoneNumberHealth).toHaveBeenCalledWith({ phoneNumberId: 'pn-1', accessToken: 'plain:enc' })
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=300')
    expect(await res.json()).toEqual({
      state: 'connected',
      displayPhoneNumber: '+44 7700 900123',
      quality: 'GREEN',
      limit: { kind: 'tier', perDay: 2000 },
    })
  })

  it('degrades to unavailable when Meta rejects the lookup', async () => {
    storedConfig = { phone_number_id: 'pn-1', access_token: 'enc', status: 'connected' }
    getPhoneNumberHealth.mockRejectedValue(new Error('expired token'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ state: 'unavailable' })
  })
})
