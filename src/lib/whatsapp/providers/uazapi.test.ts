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

  it('decodes the base64 payload returned by /message/download', async () => {
    const base64 = Buffer.from('hello').toString('base64')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ base64, mimetype: 'text/plain' }))
    )
    const provider = new UazapiProvider(CONFIG)
    const result = await provider.downloadMedia({ mediaRef: 'owner:ABC123' })

    expect(result.buffer.toString('utf8')).toBe('hello')
    expect(result.contentType).toBe('text/plain')
  })

  it('throws when the response has no base64 payload', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    const provider = new UazapiProvider(CONFIG)
    await expect(provider.downloadMedia({ mediaRef: 'owner:ABC123' })).rejects.toThrow(
      /no base64/
    )
  })
})
