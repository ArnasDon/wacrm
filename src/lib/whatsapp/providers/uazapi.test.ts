import { afterEach, describe, expect, it, vi } from 'vitest'
import { UazapiProvider } from './uazapi'

const CONFIG = {
  instanceToken: 'test-token',
  baseUrl: 'https://api.uazapi.com',
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response
}

describe('UazapiProvider.sendText', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts to /send/text with digits-only number and the instance token header', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 'owner:ABC123' }))
    vi.stubGlobal('fetch', fetchMock)

    const provider = new UazapiProvider(CONFIG)
    const result = await provider.sendText({ to: '5511999999999', text: 'hi' })

    expect(result.externalMessageId).toBe('owner:ABC123')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.uazapi.com/send/text')
    expect((init.headers as Record<string, string>).token).toBe('test-token')
    expect(JSON.parse(init.body as string)).toEqual({
      number: '5511999999999',
      text: 'hi',
    })
  })

  it('throws with the Uazapi error message on a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'invalid token' }, false, 401))
    )
    const provider = new UazapiProvider(CONFIG)
    await expect(provider.sendText({ to: '5511999999999', text: 'hi' })).rejects.toThrow(
      /invalid token/
    )
  })
})

describe('UazapiProvider.sendTemplate — fallback to plain text', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the template name + params as text via /send/text', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 'owner:XYZ' }))
    vi.stubGlobal('fetch', fetchMock)

    const provider = new UazapiProvider(CONFIG)
    await provider.sendTemplate({
      to: '5511999999999',
      templateName: 'welcome',
      params: ['John'],
    })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.uazapi.com/send/text')
    expect(JSON.parse(init.body as string).text).toBe('welcome\nJohn')
  })
})

describe('UazapiProvider.downloadMedia', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // Regression: Uazapi's real field is `base64Data`, not `base64` — this
  // exact mismatch had every single media download silently throwing in
  // production (see the `50f19e5` fix commit). This test previously
  // asserted against the WRONG field name itself, so it was failing on
  // `main` the whole time — CI on this fork isn't wired up to run `npm
  // test`, so nothing caught it. Keep the field name here honest.
  it('decodes the base64Data payload returned by /message/download', async () => {
    const base64Data = Buffer.from('hello').toString('base64')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ base64Data, mimetype: 'text/plain' }))
    )
    const provider = new UazapiProvider(CONFIG)
    const result = await provider.downloadMedia({ mediaRef: 'owner:ABC123' })

    expect(result.buffer.toString('utf8')).toBe('hello')
    expect(result.contentType).toBe('text/plain')
  })

  it('falls back to `mimeType` (capital T) when `mimetype` is absent', async () => {
    const base64Data = Buffer.from('hello').toString('base64')
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ base64Data, mimeType: 'audio/ogg' })))
    const provider = new UazapiProvider(CONFIG)
    const result = await provider.downloadMedia({ mediaRef: 'owner:ABC123' })
    expect(result.contentType).toBe('audio/ogg')
  })

  it('defaults to application/octet-stream when no mime field is present', async () => {
    const base64Data = Buffer.from('hello').toString('base64')
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ base64Data })))
    const provider = new UazapiProvider(CONFIG)
    const result = await provider.downloadMedia({ mediaRef: 'owner:ABC123' })
    expect(result.contentType).toBe('application/octet-stream')
  })

  it('throws a descriptive error when the response has no base64Data field', async () => {
    // e.g. Uazapi renames the field again, or the media has expired on
    // their side and the "success" response comes back empty.
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    const provider = new UazapiProvider(CONFIG)
    await expect(provider.downloadMedia({ mediaRef: 'owner:ABC123' })).rejects.toThrow(
      /no base64/
    )
  })

  it('surfaces the Uazapi error body on a non-2xx response instead of a generic message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'media expired' }, false, 404)))
    const provider = new UazapiProvider(CONFIG)
    await expect(provider.downloadMedia({ mediaRef: 'owner:ABC123' })).rejects.toThrow(
      /media expired/
    )
  })

  it('sends the mediaRef verbatim as `id` — Uazapi requires the full owner:messageid composite', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ base64Data: Buffer.from('x').toString('base64') }))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new UazapiProvider(CONFIG)
    await provider.downloadMedia({ mediaRef: '554796187355:3EB07EB7F6267D2CE0DD3D' })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string).id).toBe('554796187355:3EB07EB7F6267D2CE0DD3D')
  })
})

describe('UazapiProvider — externalMessageId id-format priority', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // Regression: the webhook's fromMe-echo dedupe (src/app/api/uazapi/webhook/
  // route.ts) compares `messages.message_id` — persisted from this return
  // value — against the id it parses back out of the echoed webhook payload.
  // Both sides MUST prefer the same field (the composite `owner:messageid`),
  // or the dedupe silently breaks and every outbound message gets inserted
  // twice.
  it('sendText prefers the composite `id` over the short `messageid`', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ id: '554796187355:3EB07EB7F6267D2CE0DD3D', messageid: '3EB07EB7F6267D2CE0DD3D' })
      )
    )
    const provider = new UazapiProvider(CONFIG)
    const result = await provider.sendText({ to: '5511999999999', text: 'hi' })
    expect(result.externalMessageId).toBe('554796187355:3EB07EB7F6267D2CE0DD3D')
  })

  it('sendMedia applies the same id priority', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ id: '554796187355:ABCDEF', messageid: 'ABCDEF' }))
    )
    const provider = new UazapiProvider(CONFIG)
    const result = await provider.sendMedia({ to: '5511999999999', kind: 'image', link: 'https://x/1.jpg' })
    expect(result.externalMessageId).toBe('554796187355:ABCDEF')
  })

  it('falls back to `messageid` when `id` is absent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ messageid: 'short-id-only' })))
    const provider = new UazapiProvider(CONFIG)
    const result = await provider.sendText({ to: '5511999999999', text: 'hi' })
    expect(result.externalMessageId).toBe('short-id-only')
  })
})

describe('UazapiProvider.reactToMessage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends the target id verbatim and the emoji as `text`', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new UazapiProvider(CONFIG)
    await provider.reactToMessage({
      to: '5511999999999',
      targetExternalId: '554796187355:3EB07EB7F6267D2CE0DD3D',
      emoji: '❤️',
    })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toMatchObject({
      number: '5511999999999',
      id: '554796187355:3EB07EB7F6267D2CE0DD3D',
      text: '❤️',
    })
  })

  it('allows an empty emoji to remove a reaction', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new UazapiProvider(CONFIG)
    await provider.reactToMessage({
      to: '5511999999999',
      targetExternalId: '554796187355:3EB07EB7F6267D2CE0DD3D',
      emoji: '',
    })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string).text).toBe('')
  })
})
