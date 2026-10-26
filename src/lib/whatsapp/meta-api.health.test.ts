import { afterEach, describe, expect, it, vi } from 'vitest'
import { getPhoneNumberHealth } from './meta-api'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getPhoneNumberHealth', () => {
  it('asks for the messaging limit in its own request', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.includes('whatsapp_business_manager_messaging_limit')
        ? json({ id: 'pn', whatsapp_business_manager_messaging_limit: 'TIER_2K' })
        : json({ id: 'pn', display_phone_number: '+1 555', quality_rating: 'GREEN' }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const health = await getPhoneNumberHealth({ phoneNumberId: 'pn', accessToken: 'tok' })
    expect(health).toMatchObject({
      quality_rating: 'GREEN',
      whatsapp_business_manager_messaging_limit: 'TIER_2K',
    })
    const qualityUrl = fetchMock.mock.calls.map(([u]) => u).find((u) => u.includes('quality_rating'))
    expect(qualityUrl).not.toContain('whatsapp_business_manager_messaging_limit')
  })

  it('keeps the quality rating when Meta rejects the limit field', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('whatsapp_business_manager_messaging_limit')
          ? json({ error: { message: 'Tried accessing nonexisting field', code: 100 } }, 400)
          : json({ id: 'pn', quality_rating: 'YELLOW' }),
      ),
    )
    const health = await getPhoneNumberHealth({ phoneNumberId: 'pn', accessToken: 'tok' })
    expect(health.quality_rating).toBe('YELLOW')
    expect(health.whatsapp_business_manager_messaging_limit).toBeUndefined()
  })

  it('still throws when the main lookup fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: { message: 'bad token', code: 190 } }, 401)))
    await expect(getPhoneNumberHealth({ phoneNumberId: 'pn', accessToken: 'tok' })).rejects.toThrow()
  })
})
