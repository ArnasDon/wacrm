import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BudunApiError, BudunClient } from './client'

function okResponse(json: unknown): Response {
  return { ok: true, status: 200, json: async () => json } as unknown as Response
}
function errResponse(status: number, json: unknown): Response {
  return { ok: false, status, json: async () => json } as unknown as Response
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
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
