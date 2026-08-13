import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  supabaseAdmin: vi.fn(),
  buildMetaCatalogFeedCsv: vi.fn(),
  metaCatalogFeedSlug: vi.fn(),
}))

vi.mock('@/lib/ai/admin-client', () => ({ supabaseAdmin: mocks.supabaseAdmin }))
vi.mock('@/lib/catalog/meta-feed', () => ({
  buildMetaCatalogFeedCsv: mocks.buildMetaCatalogFeedCsv,
  metaCatalogFeedSlug: mocks.metaCatalogFeedSlug,
}))

import { GET } from './route'

const TOKEN_A = 'a'.repeat(64)
const TOKEN_B = 'b'.repeat(64)

type SourceRow = { id: string; account_id: string; name: string; meta_feed_token: string; is_active: boolean }

function dbWithSources(sources: SourceRow[]) {
  return {
    from: () => {
      const state: { token?: string } = {}
      const chain = {
        select: () => chain,
        eq: (column: string, value: string | boolean) => {
          if (column === 'meta_feed_token') state.token = value as string
          return chain
        },
        maybeSingle: () =>
          Promise.resolve({
            data: sources.find((source) => source.meta_feed_token === state.token && source.is_active) ?? null,
            error: null,
          }),
      }
      return chain
    },
  }
}

const sources: SourceRow[] = [
  { id: 'source-a', account_id: 'account-a', name: 'Base LC Fitness', meta_feed_token: TOKEN_A, is_active: true },
  { id: 'source-b', account_id: 'account-b', name: 'Aluguer de Carros Maputo', meta_feed_token: TOKEN_B, is_active: true },
]

beforeEach(() => {
  vi.clearAllMocks()
  mocks.supabaseAdmin.mockReturnValue(dbWithSources(sources))
  mocks.buildMetaCatalogFeedCsv.mockImplementation(async (source: SourceRow) => `id,title\n${source.account_id}-product,Demo`)
  mocks.metaCatalogFeedSlug.mockImplementation((source: SourceRow) => source.account_id)
})

describe('GET /api/meta/catalog-feed/[token] — tenant isolation', () => {
  it("resolves tenant A's own feed by its own token", async () => {
    const response = await GET(new Request(`https://crm.test/api/meta/catalog-feed/${TOKEN_A}`), {
      params: Promise.resolve({ token: TOKEN_A }),
    })

    expect(response.status).toBe(200)
    const body = await response.text()
    expect(body).toContain('account-a-product')
    expect(body).not.toContain('account-b-product')
  })

  it("never returns tenant B's products for tenant A's token", async () => {
    const response = await GET(new Request(`https://crm.test/api/meta/catalog-feed/${TOKEN_A}`), {
      params: Promise.resolve({ token: TOKEN_A }),
    })
    const body = await response.text()

    expect(mocks.buildMetaCatalogFeedCsv).toHaveBeenCalledWith(expect.objectContaining({ account_id: 'account-a' }))
    expect(body).not.toContain('account-b')
  })

  it('resolves the other tenant feed independently through its own token', async () => {
    const response = await GET(new Request(`https://crm.test/api/meta/catalog-feed/${TOKEN_B}`), {
      params: Promise.resolve({ token: TOKEN_B }),
    })
    const body = await response.text()

    expect(body).toContain('account-b-product')
    expect(body).not.toContain('account-a-product')
  })
})

describe('GET /api/meta/catalog-feed/[token] — no valid credential, no catalogue', () => {
  it('returns 404 and never queries the database for a malformed token', async () => {
    const response = await GET(new Request('https://crm.test/api/meta/catalog-feed/not-a-real-token'), {
      params: Promise.resolve({ token: 'not-a-real-token' }),
    })

    expect(response.status).toBe(404)
    expect(mocks.supabaseAdmin).not.toHaveBeenCalled()
  })

  it('returns 404 for a well-formed but unknown token, exposing no catalogue data', async () => {
    const unknownToken = 'c'.repeat(64)

    const response = await GET(new Request(`https://crm.test/api/meta/catalog-feed/${unknownToken}`), {
      params: Promise.resolve({ token: unknownToken }),
    })
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body.error).toBeTruthy()
    expect(mocks.buildMetaCatalogFeedCsv).not.toHaveBeenCalled()
  })

  it('returns 404 for a deactivated source even with its correct token', async () => {
    mocks.supabaseAdmin.mockReturnValue(
      dbWithSources([{ ...sources[0], is_active: false }]),
    )

    const response = await GET(new Request(`https://crm.test/api/meta/catalog-feed/${TOKEN_A}`), {
      params: Promise.resolve({ token: TOKEN_A }),
    })

    expect(response.status).toBe(404)
  })
})
