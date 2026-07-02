import { afterEach, describe, expect, it, vi } from 'vitest'

// Regression: opening a long conversation renders every message (and every
// image) at once — without caching, that fires one concurrent
// /message/download per image, which was observed hitting Uazapi's rate
// limiting in production (200 responses missing the base64Data payload).
// These tests lock in that a cache hit skips the provider entirely, and
// that a cache miss downloads once and writes the cache before returning.

vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server')
  return {
    ...actual,
    // Run the deferred callback synchronously so tests can assert on the
    // cache-write side effect without needing to await a detached promise.
    after: vi.fn((cb: () => unknown) => cb()),
  }
})

const downloadMedia = vi.fn()
vi.mock('@/lib/whatsapp/providers/factory', () => ({
  getProviderFromConfig: vi.fn(() => ({ downloadMedia })),
}))

let storageDownloadResult: { data: Blob | null; error: unknown } = { data: null, error: null }
const storageUpload = vi.fn(
  async (..._args: [string, unknown, Record<string, unknown>]) => ({ data: null, error: null }),
)
const storageDownload = vi.fn(async () => storageDownloadResult)

const supabaseMock = {
  auth: {
    getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null })),
  },
  from: vi.fn((table: string) => {
    const b: Record<string, unknown> = {}
    const chain = () => b
    for (const m of ['select', 'eq']) b[m] = vi.fn(chain)
    const terminal = () => {
      if (table === 'profiles') return Promise.resolve({ data: { account_id: 'acct-1' }, error: null })
      if (table === 'whatsapp_config') {
        return Promise.resolve({
          data: { account_id: 'acct-1', provider: 'uazapi', uazapi_instance_token: 'enc', uazapi_base_url: 'https://x' },
          error: null,
        })
      }
      return Promise.resolve({ data: null, error: null })
    }
    b.maybeSingle = vi.fn(terminal)
    b.single = vi.fn(terminal)
    return b
  }),
  storage: {
    from: vi.fn(() => ({
      download: storageDownload,
      upload: storageUpload,
    })),
  },
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => supabaseMock),
}))

const { cachePath } = await import('./route')
const { GET } = await import('./route')

function request() {
  return GET(new Request('http://localhost/api/uazapi/media/owner%3Amsg-1'), {
    params: Promise.resolve({ messageId: 'owner%3Amsg-1' }),
  })
}

describe('cachePath', () => {
  it('is stable for the same account + external id', () => {
    expect(cachePath('acct-1', 'owner:msg-1')).toBe(cachePath('acct-1', 'owner:msg-1'))
  })

  it('sanitizes non-alphanumeric characters (the composite id contains `:`)', () => {
    expect(cachePath('acct-1', 'owner:msg-1')).toBe('account-acct-1/uazapi-cache/owner_msg-1')
  })

  it('scopes the path under the account id, matching the bucket RLS predicate', () => {
    expect(cachePath('acct-1', 'x')).toMatch(/^account-acct-1\//)
  })
})

describe('GET /api/uazapi/media/[messageId]', () => {
  afterEach(() => {
    vi.clearAllMocks()
    storageDownloadResult = { data: null, error: null }
  })

  it('serves from the Storage cache and never calls the provider on a hit', async () => {
    const cachedBlob = new Blob(['cached-bytes'], { type: 'image/png' })
    storageDownloadResult = { data: cachedBlob, error: null }

    const res = await request()

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/png')
    expect(downloadMedia).not.toHaveBeenCalled()
    expect(storageUpload).not.toHaveBeenCalled()
  })

  it('downloads from the provider on a cache miss and writes the cache', async () => {
    storageDownloadResult = { data: null, error: { message: 'not found' } }
    downloadMedia.mockResolvedValue({ buffer: Buffer.from('fresh-bytes'), contentType: 'image/jpeg' })

    const res = await request()

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/jpeg')
    expect(downloadMedia).toHaveBeenCalledWith({ mediaRef: 'owner:msg-1' })
    expect(storageUpload).toHaveBeenCalledTimes(1)
    const [path, , opts] = storageUpload.mock.calls[0]
    expect(path).toBe('account-acct-1/uazapi-cache/owner_msg-1')
    expect(opts).toMatchObject({ contentType: 'image/jpeg', upsert: true })
  })

  it('returns 500 with the underlying error when the provider throws', async () => {
    storageDownloadResult = { data: null, error: { message: 'not found' } }
    downloadMedia.mockRejectedValue(new Error('Uazapi media download returned no base64 payload: rate limited'))

    const res = await request()

    expect(res.status).toBe(500)
    expect(storageUpload).not.toHaveBeenCalled()
  })
})
