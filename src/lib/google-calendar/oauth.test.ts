import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { encrypt } from '@/lib/whatsapp/encryption'
import { buildAuthUrl, getValidAccessToken, GoogleCalendarError } from './oauth'

function okResponse(json: unknown): Response {
  return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) } as unknown as Response
}

function makeDb(row: { refresh_token: string; access_token: string | null; token_expiry: string | null } | null) {
  const updates: Record<string, unknown>[] = []
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve({ data: row, error: null }),
    update: (payload: Record<string, unknown>) => {
      updates.push(payload)
      const updateChain = { eq: () => Promise.resolve({ error: null }) }
      return updateChain
    },
  }
  const db = { from: () => chain } as unknown as SupabaseClient
  return { db, updates }
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  process.env.GOOGLE_CALENDAR_CLIENT_ID = 'client-id'
  process.env.GOOGLE_CALENDAR_CLIENT_SECRET = 'client-secret'
})
afterEach(() => vi.unstubAllGlobals())

describe('buildAuthUrl', () => {
  it('includes the CSRF state, offline access, and forced consent', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://crm.example.com'
    const url = buildAuthUrl('nonce-123')
    expect(url).toContain('state=nonce-123')
    expect(url).toContain('access_type=offline')
    expect(url).toContain('prompt=consent')
    expect(url).toContain(encodeURIComponent('https://crm.example.com/api/google-calendar/oauth/callback'))
    delete process.env.NEXT_PUBLIC_SITE_URL
  })

  it('throws a clear error when NEXT_PUBLIC_SITE_URL is not configured', () => {
    delete process.env.NEXT_PUBLIC_SITE_URL
    expect(() => buildAuthUrl('nonce-123')).toThrow(GoogleCalendarError)
  })
})

describe('getValidAccessToken', () => {
  it('returns the cached token without refreshing when it is not expired', async () => {
    const { db, updates } = makeDb({
      refresh_token: encrypt('refresh-1'),
      access_token: encrypt('cached-access-1'),
      token_expiry: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const token = await getValidAccessToken(db, 'acct-1')

    expect(token).toBe('cached-access-1')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(updates).toEqual([])
  })

  it('refreshes when the cached token has expired, and persists the new one encrypted', async () => {
    const { db, updates } = makeDb({
      refresh_token: encrypt('refresh-1'),
      access_token: encrypt('stale-access'),
      token_expiry: new Date(Date.now() - 1000).toISOString(),
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(okResponse({ access_token: 'fresh-access', expires_in: 3600 })),
    )

    const token = await getValidAccessToken(db, 'acct-1')

    expect(token).toBe('fresh-access')
    expect(updates).toHaveLength(1)
    expect(updates[0].token_expiry).toBeTruthy()
    expect(updates[0].access_token).not.toBe('fresh-access') // stored encrypted, not plaintext
  })

  it('refreshes when there is no cached access_token yet', async () => {
    const { db } = makeDb({ refresh_token: encrypt('refresh-1'), access_token: null, token_expiry: null })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(okResponse({ access_token: 'fresh-access', expires_in: 3600 })),
    )

    const token = await getValidAccessToken(db, 'acct-1')
    expect(token).toBe('fresh-access')
  })

  it('falls back to a refresh when the cached access_token fails to decrypt', async () => {
    const { db } = makeDb({
      refresh_token: encrypt('refresh-1'),
      access_token: 'not-actually-encrypted',
      token_expiry: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(okResponse({ access_token: 'fresh-access', expires_in: 3600 })),
    )

    const token = await getValidAccessToken(db, 'acct-1')
    expect(token).toBe('fresh-access')
  })

  it('throws when the account has no Google Calendar connection', async () => {
    const { db } = makeDb(null)
    await expect(getValidAccessToken(db, 'acct-1')).rejects.toBeInstanceOf(GoogleCalendarError)
  })

  it('throws a clear error when the refresh_token cannot be decrypted', async () => {
    const { db } = makeDb({ refresh_token: 'garbage', access_token: null, token_expiry: null })
    await expect(getValidAccessToken(db, 'acct-1')).rejects.toMatchObject({ status: 400 })
  })

  it('throws when Google rejects the refresh request', async () => {
    const { db } = makeDb({ refresh_token: encrypt('refresh-1'), access_token: null, token_expiry: null })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => 'invalid_grant' }),
    )
    await expect(getValidAccessToken(db, 'acct-1')).rejects.toMatchObject({ status: 502 })
  })
})
