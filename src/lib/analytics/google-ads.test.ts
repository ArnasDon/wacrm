import { describe, expect, it } from 'vitest'

import {
  buildGoogleUserData,
  loadGoogleAdsCreds,
  normalizeEmail,
  normalizePhone,
  pickClickId,
  sendOfflineConversion,
  sha256Hex,
} from './google-ads'

describe('google-ads — Data Manager API adapter', () => {
  it('normaliza email a minúsculas sin espacios', () => {
    expect(normalizeEmail('  John@Example.COM ')).toBe('john@example.com')
  })

  it('normaliza teléfono a E.164 (añade + si falta)', () => {
    expect(normalizePhone('52 1 55 1234 5678')).toBe('+5215512345678')
    expect(normalizePhone('+34 600 123 456')).toBe('+34600123456')
  })

  it('sha256Hex devuelve 64 hex en MAYÚSCULAS (encoding HEX de Google)', async () => {
    const hash = await sha256Hex('john@example.com')
    expect(hash).toMatch(/^[0-9A-F]{64}$/)
  })

  it('buildGoogleUserData hashea email y phone; undefined sin datos', async () => {
    const withBoth = await buildGoogleUserData({
      email: 'John@Example.COM',
      phone: '52 1 55 1234 5678',
    })
    expect(withBoth?.userIdentifiers).toHaveLength(2)
    expect(withBoth!.userIdentifiers[0].emailAddress).toBe(await sha256Hex('john@example.com'))
    expect(withBoth!.userIdentifiers[1].phoneNumber).toBe(await sha256Hex('+5215512345678'))

    expect(await buildGoogleUserData()).toBeUndefined()
    expect(await buildGoogleUserData({})).toBeUndefined()
  })

  it('pickClickId elige UN clic: gclid > gbraid > wbraid (nunca dos)', () => {
    expect(pickClickId({ gclid: 'G1', gbraid: 'GB1', wbraid: 'WB1' })).toEqual({ gclid: 'G1' })
    expect(pickClickId({ gbraid: 'GB1', wbraid: 'WB1' })).toEqual({ gbraid: 'GB1' })
    expect(pickClickId({ wbraid: 'WB1' })).toEqual({ wbraid: 'WB1' })
    expect(pickClickId({})).toEqual({})
  })

  it('sin credenciales loadGoogleAdsCreds devuelve null (fail-open)', () => {
    expect(loadGoogleAdsCreds()).toBeNull()
  })

  it('sendOfflineConversion usa el endpoint Data Manager y mapea el event', async () => {
    let captured: { url: string; headers: Record<string, string>; body: Record<string, unknown> } | undefined
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (url: unknown, init?: { headers?: Record<string, string>; body?: string }) => {
      captured = { url: String(url), headers: init?.headers ?? {}, body: JSON.parse(init?.body ?? '{}') }
      return new Response(JSON.stringify({ requestId: 'req-1' }), { status: 200 })
    }) as typeof fetch

    try {
      const res = await sendOfflineConversion(
        {
          event_name: 'deal_won',
          event_id: 'deal_won_x',
          event_time: Date.parse('2026-08-14T10:00:00Z'),
          value: 2500,
          currency: 'MXN',
          click_ids: { gclid: 'Cj0KCQ' },
          user_data: { email: 'a@b.com' },
        },
        { customerId: '1234567890', conversionActionId: '987654321', oauthToken: 'tok' }
      )

      expect(res.ok).toBe(true)
      expect(captured!.url).toBe('https://datamanager.googleapis.com/v1/events:ingest')
      expect(captured!.headers.Authorization).toBe('Bearer tok')

      const dest = (captured!.body.destinations as Array<{ operatingAccount: unknown; productDestinationId: string }>)[0]
      expect(dest.operatingAccount).toEqual({ accountType: 'GOOGLE_ADS', accountId: '1234567890' })
      expect(dest.productDestinationId).toBe('987654321')

      const events = captured!.body.events as Array<{
        eventSource: string
        transactionId: string
        conversionValue: number
        currency: string
        adIdentifiers: Record<string, string>
        userData: { userIdentifiers: Array<{ emailAddress: string }> }
      }>
      const ev = events[0]
      expect(ev.eventSource).toBe('WEB')
      expect(ev.transactionId).toBe('deal_won_x')
      expect(ev.conversionValue).toBe(2500)
      expect(ev.currency).toBe('MXN')
      expect(ev.adIdentifiers).toEqual({ gclid: 'Cj0KCQ' })
      expect(captured!.body.encoding).toBe('HEX')
      expect(ev.userData.userIdentifiers[0].emailAddress).toBe(await sha256Hex('a@b.com'))
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('sendOfflineConversion devuelve reason con el cuerpo de error', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response('{"error":"bad_request"}', { status: 400 })) as typeof fetch
    try {
      const res = await sendOfflineConversion(
        { event_name: 'lead', event_id: 'lead_x', event_time: Date.now(), click_ids: {} },
        { customerId: '1', conversionActionId: '2', oauthToken: 't' }
      )
      expect(res.ok).toBe(false)
      expect(res.reason).toContain('400')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})