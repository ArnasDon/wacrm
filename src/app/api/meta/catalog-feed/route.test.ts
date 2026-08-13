import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GET } from './route'

const originalToken = process.env.LEGACY_META_FEED_TOKEN

beforeEach(() => {
  delete process.env.LEGACY_META_FEED_TOKEN
})

afterEach(() => {
  if (originalToken === undefined) delete process.env.LEGACY_META_FEED_TOKEN
  else process.env.LEGACY_META_FEED_TOKEN = originalToken
})

describe('GET /api/meta/catalog-feed — deprecated fixed URL', () => {
  it('returns 404 with no tenant/business name in the response when unconfigured', async () => {
    const response = await GET(new Request('https://crm.test/api/meta/catalog-feed'))
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(JSON.stringify(body).toLowerCase()).not.toContain('lc fitness')
  })

  it('redirects to the token URL only when an operator explicitly configured one', async () => {
    process.env.LEGACY_META_FEED_TOKEN = 'x'.repeat(64)

    const response = await GET(new Request('https://crm.test/api/meta/catalog-feed'))

    expect(response.status).toBe(308)
    expect(response.headers.get('location')).toContain(`/api/meta/catalog-feed/${'x'.repeat(64)}`)
  })
})
