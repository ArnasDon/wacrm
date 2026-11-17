import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  captureReferralSource,
  parseReferral,
  referralReceivedAt,
  safeReferralUrl,
} from './referral-source'

const metaReferral = {
  source_url: 'https://fb.me/3cr4Wqqkv',
  source_id: '120200000000000',
  source_type: 'ad',
  headline: 'Spring sale',
  body: 'Message us for 20% off',
  media_type: 'image',
  image_url: 'https://scontent.xx.fbcdn.net/image.jpg',
  ctwa_clid: 'ARAkLkA8rmlFeiCktEJQ',
  welcome_message: { text: 'Hi there' },
}

describe('parseReferral', () => {
  it('keeps the known Meta referral fields and drops the rest', () => {
    expect(parseReferral(metaReferral)).toEqual({
      source_url: 'https://fb.me/3cr4Wqqkv',
      source_id: '120200000000000',
      source_type: 'ad',
      headline: 'Spring sale',
      body: 'Message us for 20% off',
      media_type: 'image',
      image_url: 'https://scontent.xx.fbcdn.net/image.jpg',
      ctwa_clid: 'ARAkLkA8rmlFeiCktEJQ',
    })
  })

  it.each([null, undefined, 'ad', 42, [], ['ad']])(
    'returns null for a non-object referral (%j)',
    (raw) => {
      expect(parseReferral(raw)).toBeNull()
    }
  )

  it('returns null when no usable field is present', () => {
    expect(parseReferral({ headline: '   ', source_id: 7, source_url: 'javascript:alert(1)' })).toBeNull()
  })

  it('ignores fields of the wrong type', () => {
    expect(parseReferral({ source_type: 'post', headline: { text: 'x' }, ctwa_clid: 123 })).toEqual({
      source_type: 'post',
    })
  })

  it('caps text fields at their length limit', () => {
    const parsed = parseReferral({ headline: 'h'.repeat(5000), body: 'b'.repeat(5000), source_type: 'x'.repeat(100) })
    expect(parsed?.headline).toHaveLength(500)
    expect(parsed?.body).toHaveLength(2000)
    expect(parsed?.source_type).toHaveLength(32)
  })

  it('normalises source_type and media_type to lower case', () => {
    expect(parseReferral({ source_type: 'AD', media_type: 'VIDEO' })).toEqual({
      source_type: 'ad',
      media_type: 'video',
    })
  })

  it('drops non-http(s) and oversized URLs', () => {
    expect(
      parseReferral({
        source_type: 'ad',
        source_url: 'javascript:alert(1)',
        image_url: 'data:image/png;base64,AAAA',
        video_url: `https://example.com/${'v'.repeat(3000)}`,
        thumbnail_url: 'not a url',
      })
    ).toEqual({ source_type: 'ad' })
  })
})

describe('safeReferralUrl', () => {
  it('accepts http and https URLs', () => {
    expect(safeReferralUrl('https://fb.me/x')).toBe('https://fb.me/x')
    expect(safeReferralUrl(' http://example.com/a ')).toBe('http://example.com/a')
  })

  it.each(['javascript:alert(1)', 'mailto:a@b.c', 'ftp://example.com', '//example.com', '', 42, null])(
    'rejects %j',
    (value) => {
      expect(safeReferralUrl(value)).toBeNull()
    }
  )
})

describe('referralReceivedAt', () => {
  const now = new Date('2026-11-17T12:00:00.000Z')

  it('converts Meta epoch seconds to ISO', () => {
    expect(referralReceivedAt('1700000000', now)).toBe('2023-11-14T22:13:20.000Z')
  })

  it.each([undefined, '', 'abc', '-5', '1e20'])('falls back to now for %j', (value) => {
    expect(referralReceivedAt(value, now)).toBe(now.toISOString())
  })
})

interface RecordedUpdate {
  table: string
  payload: Record<string, unknown> | null
  eq: [string, unknown][]
  is: [string, unknown][]
}

function stubClient(result: { data: unknown; error: { message: string } | null }) {
  const calls: RecordedUpdate[] = []
  const client = {
    from(table: string) {
      const rec: RecordedUpdate = { table, payload: null, eq: [], is: [] }
      calls.push(rec)
      const builder = {
        update(payload: Record<string, unknown>) {
          rec.payload = payload
          return builder
        },
        eq(column: string, value: unknown) {
          rec.eq.push([column, value])
          return builder
        },
        is(column: string, value: unknown) {
          rec.is.push([column, value])
          return builder
        },
        select() {
          return Promise.resolve(result)
        },
      }
      return builder
    },
  }
  return { client: client as unknown as SupabaseClient, calls }
}

describe('captureReferralSource', () => {
  it('writes the parsed referral only while the contact has none', async () => {
    const { client, calls } = stubClient({ data: [{ id: 'c1' }], error: null })

    const stored = await captureReferralSource(client, 'c1', metaReferral, '1700000000')

    expect(stored).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0].table).toBe('contacts')
    expect(calls[0].payload).toEqual({
      referral_source: parseReferral(metaReferral),
      referral_received_at: '2023-11-14T22:13:20.000Z',
    })
    expect(calls[0].eq).toEqual([['id', 'c1']])
    expect(calls[0].is).toEqual([['referral_source', null]])
  })

  it('reports false when a first-touch source already exists', async () => {
    const { client } = stubClient({ data: [], error: null })
    expect(await captureReferralSource(client, 'c1', metaReferral, '1700000000')).toBe(false)
  })

  it('issues no query for an unusable referral', async () => {
    const { client, calls } = stubClient({ data: [], error: null })
    expect(await captureReferralSource(client, 'c1', { source_url: 'javascript:x' }, '1700000000')).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('swallows a database error', async () => {
    const { client } = stubClient({ data: null, error: { message: 'boom' } })
    expect(await captureReferralSource(client, 'c1', metaReferral, '1700000000')).toBe(false)
  })
})
