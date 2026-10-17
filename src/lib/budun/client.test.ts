import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// SSRF guard (IC-A1) — mocked to `true` by default so every EXISTING
// test below (which uses plain `https://erp.example.com`-style
// fixtures, never resolved by real DNS in this suite) keeps exercising
// the same request-shape/error-handling behavior it always did. The
// dedicated "SSRF guard" describe block below overrides this per-test
// to prove the guard is actually wired in.
const budunUrlSafetyMocks = vi.hoisted(() => ({
  isSafeBudunUrl: vi.fn(async (url: string) => {
    void url
    return true
  }),
}))
vi.mock('./url-safety', () => ({ isSafeBudunUrl: budunUrlSafetyMocks.isSafeBudunUrl }))

import { BudunApiError, BudunClient } from './client'

function okResponse(json: unknown): Response {
  return { ok: true, status: 200, json: async () => json } as unknown as Response
}
function errResponse(status: number, json: unknown): Response {
  return { ok: false, status, json: async () => json } as unknown as Response
}
function redirectResponse(location: string): Response {
  return {
    ok: false,
    status: 302,
    headers: { get: (name: string) => (name.toLowerCase() === 'location' ? location : null) },
    json: async () => ({}),
  } as unknown as Response
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  budunUrlSafetyMocks.isSafeBudunUrl.mockReset()
  budunUrlSafetyMocks.isSafeBudunUrl.mockResolvedValue(true)
})
afterEach(() => vi.unstubAllGlobals())

describe('BudunClient — request shape', () => {
  it('sends the Bearer secret, never the app_key, as the auth credential', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ products: [] }))
    vi.stubGlobal('fetch', fetchMock)

    const client = new BudunClient({ baseUrl: 'https://erp.example.com', secret: 'top-secret', appKey: 'app-123' })
    await client.search('S25')

    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('/api/v1/catalog/search/')
    expect(opts.headers.Authorization).toBe('Bearer top-secret')
    expect(opts.headers['X-App-Key']).toBe('app-123')
    expect(url).not.toContain('top-secret') // secret must never land in the URL/query string
  })

  it('hits the commercial Catalog API path, not the administrative Inventory API root', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ id: 'p1' }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new BudunClient({ baseUrl: 'https://erp.example.com/', secret: 's' })
    await client.getProduct('p1')
    const [url] = fetchMock.mock.calls[0]
    expect(url).toBe('https://erp.example.com/api/v1/catalog/products/p1/')
  })

  it('search accepts either a bare array or a {products: []} envelope', async () => {
    const fetchArray = vi.fn().mockResolvedValue(okResponse([{ id: 'a' }]))
    vi.stubGlobal('fetch', fetchArray)
    const client = new BudunClient({ baseUrl: 'https://erp.example.com', secret: 's' })
    expect(await client.search('x')).toEqual([{ id: 'a' }])

    const fetchEnvelope = vi.fn().mockResolvedValue(okResponse({ products: [{ id: 'b' }] }))
    vi.stubGlobal('fetch', fetchEnvelope)
    expect(await client.search('x')).toEqual([{ id: 'b' }])
  })
})

describe('BudunClient — error handling', () => {
  it('maps 401/403 to invalid_credentials', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errResponse(401, { error: 'bad token' })))
    const client = new BudunClient({ baseUrl: 'https://erp.example.com', secret: 's' })
    await expect(client.search('x')).rejects.toMatchObject({ code: 'invalid_credentials' })
  })

  it('maps 404 on getProduct to null instead of throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errResponse(404, {})))
    const client = new BudunClient({ baseUrl: 'https://erp.example.com', secret: 's' })
    expect(await client.getProduct('missing')).toBeNull()
  })

  it('maps a network failure to a BudunApiError, not an unhandled rejection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fetch failed')))
    const client = new BudunClient({ baseUrl: 'https://erp.example.com', secret: 's' })
    await expect(client.search('x')).rejects.toBeInstanceOf(BudunApiError)
  })

  it('never includes the secret in a thrown error message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errResponse(500, { error: 'boom' })))
    const client = new BudunClient({ baseUrl: 'https://erp.example.com', secret: 'super-secret-value' })
    try {
      await client.search('x')
      expect.unreachable()
    } catch (err) {
      expect(String(err instanceof Error ? err.message : err)).not.toContain('super-secret-value')
    }
  })
})

describe('BudunClient.testConnection', () => {
  it('never throws — returns a structured {ok, message} even on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errResponse(401, { error: 'invalid' })))
    const client = new BudunClient({ baseUrl: 'https://erp.example.com', secret: 'bad' })
    const result = await client.testConnection()
    expect(result.ok).toBe(false)
    expect(result.message).not.toContain('bad')
  })

  it('reports ok:true with a latency on a successful call', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({ products: [] })))
    const client = new BudunClient({ baseUrl: 'https://erp.example.com', secret: 's' })
    const result = await client.testConnection()
    expect(result.ok).toBe(true)
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
  })
})

describe('BudunClient — SSRF guard (IC-A1)', () => {
  it('validates the URL BEFORE fetching — an unsafe base_url never reaches fetch()', async () => {
    budunUrlSafetyMocks.isSafeBudunUrl.mockResolvedValue(false)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const client = new BudunClient({ baseUrl: 'https://169.254.169.254', secret: 'top-secret' })
    await expect(client.search('x')).rejects.toBeInstanceOf(BudunApiError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('never sends the Bearer secret to a URL rejected by the guard', async () => {
    budunUrlSafetyMocks.isSafeBudunUrl.mockResolvedValue(false)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const client = new BudunClient({ baseUrl: 'https://127.0.0.1', secret: 'super-secret-value' })
    await expect(client.search('x')).rejects.toBeInstanceOf(BudunApiError)
    // The clearest possible proof the secret never left the process:
    // fetch (the only place the Authorization header is attached) was
    // never invoked at all.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('the rejection message is generic — never echoes the rejected URL/IP', async () => {
    budunUrlSafetyMocks.isSafeBudunUrl.mockResolvedValue(false)
    vi.stubGlobal('fetch', vi.fn())
    const client = new BudunClient({ baseUrl: 'https://169.254.169.254', secret: 's' })
    try {
      await client.search('x')
      expect.unreachable()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      expect(message).not.toContain('169.254.169.254')
    }
  })

  it('a redirect from a public host to a private host is rejected, and the private target is never fetched', async () => {
    // First hop: the configured (public) base_url passes the guard and
    // returns a 3xx pointing at an internal address.
    budunUrlSafetyMocks.isSafeBudunUrl.mockImplementation(async (url: string) => !url.includes('169.254'))
    const fetchMock = vi.fn().mockResolvedValue(redirectResponse('http://169.254.169.254/latest/meta-data/'))
    vi.stubGlobal('fetch', fetchMock)

    const client = new BudunClient({ baseUrl: 'https://erp.example.com', secret: 's' })
    await expect(client.search('x')).rejects.toBeInstanceOf(BudunApiError)
    // Exactly one request went out — the redirect target was validated
    // and rejected BEFORE a second fetch was ever attempted.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a redirect between two public hosts is still followed normally', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(redirectResponse('https://erp-2.example.com/api/v1/catalog/search/?q=x'))
      .mockResolvedValueOnce(okResponse({ products: [{ id: 'moved' }] }))
    vi.stubGlobal('fetch', fetchMock)

    const client = new BudunClient({ baseUrl: 'https://erp.example.com', secret: 's' })
    const result = await client.search('x')
    expect(result).toEqual([{ id: 'moved' }])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('fetch is called with redirect: "manual" so the runtime never auto-follows a redirect on its own', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ products: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new BudunClient({ baseUrl: 'https://erp.example.com', secret: 's' })
    await client.search('x')
    const [, opts] = fetchMock.mock.calls[0]
    expect(opts.redirect).toBe('manual')
  })
})
