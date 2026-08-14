import { describe, expect, it } from 'vitest'

import {
  buildMetaUserData,
  dispatchWebsiteConversion,
  normalizeEmail,
  normalizePhone,
  sha256Hex,
} from './meta-capi'

describe('meta-capi — dispatchWebsiteConversion (action_source website)', () => {
  it('normaliza email/phone para hashing', () => {
    expect(normalizeEmail('  X@Y.COM ')).toBe('x@y.com')
    expect(normalizePhone('52-1-55-1234-5678')).toBe('+5215512345678')
  })

  it('sha256Hex devuelve 64 hex en minúsculas (CAPI)', async () => {
    expect(await sha256Hex('a@b.com')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('buildMetaUserData hashea em y ph; undefined sin datos', async () => {
    const out = await buildMetaUserData({ email: 'A@B.com', phone: '5215512345678' })
    expect(out).toEqual({
      em: await sha256Hex('a@b.com'),
      ph: await sha256Hex('+5215512345678'),
    })
    expect(await buildMetaUserData()).toBeUndefined()
  })

  it('envía event_id, action_source website y combina em/ph/fbc/fbp en UN user_data', async () => {
    let body: { data: Array<Record<string, unknown>> }
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
      body = JSON.parse(init?.body ?? '{}')
      return new Response('{"events_received":1}', { status: 200 })
    }) as typeof fetch

    try {
      const res = await dispatchWebsiteConversion(
        {
          event_name: 'Purchase',
          event_id: 'deal_won_x',
          event_time: Date.parse('2026-08-14T10:00:00Z'),
          value: 2500,
          currency: 'MXN',
          fbc: 'fb.1.1700000000.abcd',
          fbp: 'fb.1.1700000000.1234',
          user_data: { email: 'a@b.com' },
        },
        { datasetId: '12345', accessToken: 'tok' }
      )

      expect(res.ok).toBe(true)
      const ev = body.data[0]
      expect(ev.event_name).toBe('Purchase')
      expect(ev.event_id).toBe('deal_won_x')
      expect(ev.action_source).toBe('website')
      expect(ev.event_time).toBe(1786701600) // epoch segundos
      expect(ev.user_data).toEqual({
        em: await sha256Hex('a@b.com'),
        fbc: 'fb.1.1700000000.abcd',
        fbp: 'fb.1.1700000000.1234',
      })
      expect(ev.custom_data).toEqual({ currency: 'MXN', value: 2500 })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('omite custom_data cuando no hay valor (lead sin monetización)', async () => {
    let body: { data: Array<Record<string, unknown>> }
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
      body = JSON.parse(init?.body ?? '{}')
      return new Response('{}', { status: 200 })
    }) as typeof fetch

    try {
      await dispatchWebsiteConversion(
        {
          event_name: 'Lead',
          event_id: 'lead_x',
          event_time: Date.now(),
          fbp: 'fb.1.1.1',
        },
        { datasetId: '1', accessToken: 't' }
      )
      expect(body.data[0].custom_data).toBeUndefined()
      expect(body.data[0].user_data).toEqual({ fbp: 'fb.1.1.1' })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('devuelve reason con el cuerpo de error HTTP', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response('{"error":{"message":"no data"}}', { status: 400 })) as typeof fetch
    try {
      const res = await dispatchWebsiteConversion(
        { event_name: 'Lead', event_id: 'x', event_time: Date.now() },
        { datasetId: '1', accessToken: 't' }
      )
      expect(res.ok).toBe(false)
      expect(res.reason).toContain('400')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})