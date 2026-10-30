import { describe, expect, it } from 'vitest'
import { buildPushPayload, parseSubscription } from './payload'

describe('buildPushPayload', () => {
  it('uses the contact name, message text and a deep link', () => {
    const p = buildPushPayload({
      message: { conversation_id: 'c-1', content_type: 'text', content_text: 'Your car insurance quotation please.' },
      contact: { name: 'Example Customer', phone: '+919999900000' },
      now: 1700000000000,
    })
    expect(p).toEqual({
      v: 1,
      conversationId: 'c-1',
      title: 'Example Customer',
      body: 'Your car insurance quotation please.',
      url: '/inbox?c=c-1',
      tag: 'c-1',
      ts: 1700000000000,
    })
  })

  it('falls back to the phone, then a generic title, and labels media', () => {
    const a = buildPushPayload({
      message: { conversation_id: 'c', content_type: 'image', content_text: null },
      contact: { phone: '+1555' },
    })
    expect(a.title).toBe('+1555')
    expect(a.body).toContain('Photo')
    const b = buildPushPayload({
      message: { conversation_id: 'c', content_type: 'text', content_text: 'hi' },
      contact: null,
    })
    expect(b.title).toBe('New message')
  })

  it('never contains credentials-like fields', () => {
    const p = buildPushPayload({
      message: { conversation_id: 'c', content_type: 'text', content_text: 'x' },
    })
    expect(Object.keys(p).sort()).toEqual(['body', 'conversationId', 'tag', 'title', 'ts', 'url', 'v'])
  })
})

describe('parseSubscription', () => {
  const good = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
    keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) },
  }
  it('accepts a normal browser subscription', () => {
    expect(parseSubscription(good)).toEqual({
      endpoint: good.endpoint,
      p256dh: good.keys.p256dh,
      auth: good.keys.auth,
    })
  })
  it('rejects non-https endpoints, junk and missing keys', () => {
    expect(parseSubscription({ ...good, endpoint: 'http://169.254.169.254/x' })).toBeNull()
    expect(parseSubscription({ ...good, endpoint: 'not a url' })).toBeNull()
    expect(parseSubscription({ endpoint: good.endpoint })).toBeNull()
    expect(parseSubscription({ ...good, keys: { p256dh: 'x', auth: 'y' } })).toBeNull()
    expect(parseSubscription(null)).toBeNull()
    expect(parseSubscription('str')).toBeNull()
  })
})
