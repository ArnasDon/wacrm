import { describe, expect, it } from 'vitest'
import { mapContentType, normalizeInbound } from './route'

function payload(overrides: Record<string, unknown> = {}, chat: Record<string, unknown> = {}) {
  return {
    chat: { name: 'Some Contact', phone: '5511999999999', ...chat },
    message: {
      chatid: '5511999999999@s.whatsapp.net',
      sender_pn: '5511999999999',
      fromMe: false,
      type: 'text',
      text: 'hello',
      timestamp: 1700000000,
      ...overrides,
    },
  }
}

describe('normalizeInbound — externalId id-format priority', () => {
  // Regression: this exact mismatch broke the fromMe-echo dedupe in
  // processInbound (route.ts) — every outbound Uazapi message got
  // inserted twice because the webhook picked the short `messageid`
  // while the send path (uazapi.ts) persists the composite `id`. Both
  // MUST prefer the same field.
  it('prefers the composite `id` over the short `messageid`', () => {
    const inbound = normalizeInbound(
      payload({ id: '554796187355:3EB07EB7F6267D2CE0DD3D', messageid: '3EB07EB7F6267D2CE0DD3D' })
    )
    expect(inbound?.externalId).toBe('554796187355:3EB07EB7F6267D2CE0DD3D')
  })

  it('falls back to `messageid` when `id` is absent', () => {
    const inbound = normalizeInbound(payload({ messageid: 'short-id-only' }))
    expect(inbound?.externalId).toBe('short-id-only')
  })

  it('is empty when neither id field is present', () => {
    const inbound = normalizeInbound(payload({}))
    expect(inbound?.externalId).toBe('')
  })
})

describe('normalizeInbound — reaction detection', () => {
  // Regression: reactions were falling through the generic message path
  // (mapped to content_type 'text') and getting inserted as brand new
  // standalone messages instead of being recognized as reactions.
  it('sets reactionTargetId from `message.reaction` when present', () => {
    const inbound = normalizeInbound(
      payload({ reaction: '554796187355:TARGETMSGID', text: '❤️' })
    )
    expect(inbound?.reactionTargetId).toBe('554796187355:TARGETMSGID')
    expect(inbound?.text).toBe('❤️')
  })

  it('is null for a normal message with no reaction field', () => {
    const inbound = normalizeInbound(payload({ text: 'just chatting' }))
    expect(inbound?.reactionTargetId).toBeNull()
  })

  it('is null when `reaction` is an empty string', () => {
    const inbound = normalizeInbound(payload({ reaction: '' }))
    expect(inbound?.reactionTargetId).toBeNull()
  })
})

describe('normalizeInbound — basic field mapping', () => {
  it('returns null when there is no message on the payload', () => {
    expect(normalizeInbound({ chat: {} })).toBeNull()
  })

  it('returns null when no phone can be resolved', () => {
    expect(normalizeInbound(payload({ sender_pn: undefined, chatid: undefined }, { phone: undefined }))).toBeNull()
  })

  it('resolves the conversation phone from chatid on a fromMe echo, not the sender', () => {
    const inbound = normalizeInbound(
      payload(
        { fromMe: true, chatid: '5511888888888@s.whatsapp.net', sender_pn: '5511000000000' },
        { phone: '5511888888888' }
      )
    )
    expect(inbound?.fromPhone).toBe('5511888888888')
  })
})

describe('mapContentType', () => {
  it('passes through allowed content types', () => {
    expect(mapContentType('image')).toBe('image')
    expect(mapContentType('text')).toBe('text')
  })

  it('maps sticker to image', () => {
    expect(mapContentType('sticker')).toBe('image')
  })

  it('maps ptt and myaudio to audio', () => {
    expect(mapContentType('ptt')).toBe('audio')
    expect(mapContentType('myaudio')).toBe('audio')
  })

  it('falls back to text for anything unrecognized', () => {
    expect(mapContentType('reaction')).toBe('text')
    expect(mapContentType('whatever-uazapi-invents-next')).toBe('text')
  })
})
