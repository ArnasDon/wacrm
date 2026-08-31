import { describe, it, expect, vi, afterEach } from 'vitest'
import { executeTool } from './execute'
import type { AiTool } from './types'

function tool(overrides: Partial<AiTool> = {}): AiTool {
  return {
    id: 't1',
    accountId: 'acct-1',
    name: 'check_stock',
    description: 'Checks stock',
    method: 'GET',
    // A literal public IP so `isDeliverableUrl` resolves synchronously
    // via `isIP()` — no real DNS lookup needed in tests (mirrors
    // src/lib/webhooks/ssrf.test.ts's "allows a literal public IP").
    url: 'https://8.8.8.8/stock',
    headers: {},
    authType: 'none',
    authHeaderName: null,
    authSecret: null,
    parameters: [],
    timeoutMs: 5000,
    ...overrides,
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('executeTool — SSRF guard', () => {
  it('refuses a private / link-local destination and never calls fetch', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    // Literal IP — isDeliverableUrl catches this synchronously via
    // isIP(), same target used by the automations send_webhook test.
    const result = await executeTool(tool({ url: 'http://169.254.169.254/latest/meta-data/' }), {})

    expect(result.ok).toBe(false)
    expect(result.error).toContain('not allowed')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('executeTool — argument validation', () => {
  it('errors on a missing required parameter without calling fetch', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const result = await executeTool(
      tool({ parameters: [{ name: 'sku', in: 'query', type: 'string', required: true }] }),
      {},
    )

    expect(result.ok).toBe(false)
    expect(result.error).toContain('sku')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rejects a non-numeric value for a number parameter', async () => {
    const result = await executeTool(
      tool({ parameters: [{ name: 'qty', in: 'query', type: 'number', required: true }] }),
      { qty: 'not-a-number' },
    )
    expect(result.ok).toBe(false)
    expect(result.error).toContain('qty')
  })
})

describe('executeTool — request building', () => {
  it('interpolates path params and appends query params', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '{"in_stock":true}',
    })
    vi.stubGlobal('fetch', fetchSpy)

    await executeTool(
      tool({
        url: 'https://8.8.8.8/stock/{sku}',
        parameters: [
          { name: 'sku', in: 'path', type: 'string', required: true },
          { name: 'region', in: 'query', type: 'string', required: false },
        ],
      }),
      { sku: 'ABC-1', region: 'eu' },
    )

    const [url, opts] = fetchSpy.mock.calls[0]
    expect(url).toBe('https://8.8.8.8/stock/ABC-1?region=eu')
    expect(opts.redirect).toBe('manual')
  })

  it('builds a JSON body from body-location params', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      statusText: 'Created',
      text: async () => '{"id":"order-1"}',
    })
    vi.stubGlobal('fetch', fetchSpy)

    await executeTool(
      tool({
        method: 'POST',
        url: 'https://8.8.8.8/orders',
        parameters: [{ name: 'sku', in: 'body', type: 'string', required: true }],
      }),
      { sku: 'ABC-1' },
    )

    const [, opts] = fetchSpy.mock.calls[0]
    expect(JSON.parse(opts.body)).toEqual({ sku: 'ABC-1' })
    expect(opts.headers['Content-Type']).toBe('application/json')
  })
})

describe('executeTool — auth headers', () => {
  it('sends a Bearer header and redacts it in the logged request', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => 'ok',
    })
    vi.stubGlobal('fetch', fetchSpy)

    const result = await executeTool(
      tool({ authType: 'bearer', authSecret: 'sk-live-secret' }),
      {},
    )

    const [, opts] = fetchSpy.mock.calls[0]
    expect(opts.headers['Authorization']).toBe('Bearer sk-live-secret')
    expect(result.request.headers['Authorization']).not.toContain('sk-live-secret')
  })

  it('sends the API key under the configured header name', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => 'ok',
    })
    vi.stubGlobal('fetch', fetchSpy)

    await executeTool(
      tool({ authType: 'api_key', authHeaderName: 'X-API-Key', authSecret: 'key-123' }),
      {},
    )

    const [, opts] = fetchSpy.mock.calls[0]
    expect(opts.headers['X-API-Key']).toBe('key-123')
  })

  it('base64-encodes basic auth credentials', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => 'ok',
    })
    vi.stubGlobal('fetch', fetchSpy)

    await executeTool(tool({ authType: 'basic', authSecret: 'user:pass' }), {})

    const [, opts] = fetchSpy.mock.calls[0]
    expect(opts.headers['Authorization']).toBe(
      `Basic ${Buffer.from('user:pass').toString('base64')}`,
    )
  })
})

describe('executeTool — response handling', () => {
  it('truncates an oversized response body', async () => {
    const huge = 'x'.repeat(9000)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK', text: async () => huge }),
    )
    const result = await executeTool(tool(), {})
    expect(result.body!.length).toBeLessThan(9000)
    expect(result.body).toContain('[truncated]')
  })

  it('reports a non-2xx response as an error result, not a throw', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => '{"error":"not found"}',
      }),
    )
    const result = await executeTool(tool(), {})
    expect(result.ok).toBe(false)
    expect(result.status).toBe(404)
    expect(result.error).toContain('404')
  })

  it('never throws on a network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND')),
    )
    const result = await executeTool(tool(), {})
    expect(result.ok).toBe(false)
    expect(result.error).toContain('ENOTFOUND')
  })
})
