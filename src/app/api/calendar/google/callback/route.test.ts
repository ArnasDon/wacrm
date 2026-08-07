import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  upsertCalendarConfig: vi.fn(),
  exchangeCodeForTokens: vi.fn(),
  googleOAuthCredentialsFromEnv: vi.fn(),
  verifyOAuthState: vi.fn(),
  googleOAuthStateSecretFromEnv: vi.fn(),
  googleOAuthRedirectUriFromEnv: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
}))
vi.mock('@/lib/eter/repo/calendar-config.repo', () => ({
  upsertCalendarConfig: mocks.upsertCalendarConfig,
}))
vi.mock('@/lib/calendar/google/client', () => ({
  exchangeCodeForTokens: mocks.exchangeCodeForTokens,
  googleOAuthCredentialsFromEnv: mocks.googleOAuthCredentialsFromEnv,
}))
vi.mock('@/lib/calendar/google/oauth-state', async () => {
  const actual = await vi.importActual<typeof import('@/lib/calendar/google/oauth-state')>(
    '@/lib/calendar/google/oauth-state',
  )
  return {
    ...actual,
    verifyOAuthState: mocks.verifyOAuthState,
  }
})
vi.mock('@/lib/calendar/google/env', () => ({
  googleOAuthStateSecretFromEnv: mocks.googleOAuthStateSecretFromEnv,
  googleOAuthRedirectUriFromEnv: mocks.googleOAuthRedirectUriFromEnv,
}))

import { GET } from './route'
import { OAuthStateError } from '@/lib/calendar/google/oauth-state'

const context = {
  supabase: { name: 'scoped-client' },
  accountId: 'account-1',
  userId: 'user-1',
  role: 'admin' as const,
  account: { id: 'account-1', name: 'Acme' },
}

function request(query: string) {
  return new Request(`http://localhost/api/calendar/google/callback${query}`)
}

async function locationOf(res: Response): Promise<URL> {
  return new URL(res.headers.get('location')!)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireRole.mockResolvedValue(context)
  mocks.googleOAuthStateSecretFromEnv.mockReturnValue('state-secret')
  mocks.googleOAuthRedirectUriFromEnv.mockReturnValue('https://app.example.com/api/calendar/google/callback')
  mocks.googleOAuthCredentialsFromEnv.mockReturnValue({ clientId: 'cid', clientSecret: 'csecret' })
  mocks.verifyOAuthState.mockReturnValue({ accountId: 'account-1', nonce: 'n', iat: 0 })
})

describe('GET /api/calendar/google/callback', () => {
  it('redirects with a google_ prefixed error when the user denies consent', async () => {
    const res = await GET(request('?error=access_denied'))
    const loc = await locationOf(res)
    expect(loc.searchParams.get('calendar_error')).toBe('google_access_denied')
    expect(mocks.exchangeCodeForTokens).not.toHaveBeenCalled()
  })

  it('redirects with missing_params when code or state is absent', async () => {
    const res = await GET(request('?code=abc'))
    const loc = await locationOf(res)
    expect(loc.searchParams.get('calendar_error')).toBe('missing_params')
  })

  it('redirects with a state_ prefixed error when state verification fails, without touching Google', async () => {
    mocks.verifyOAuthState.mockImplementation(() => {
      throw new OAuthStateError('bad state', 'invalid_signature')
    })
    const res = await GET(request('?code=abc&state=forged'))
    const loc = await locationOf(res)
    expect(loc.searchParams.get('calendar_error')).toBe('state_invalid_signature')
    expect(mocks.exchangeCodeForTokens).not.toHaveBeenCalled()
    expect(mocks.upsertCalendarConfig).not.toHaveBeenCalled()
  })

  it('redirects with session_expired when there is no live session', async () => {
    mocks.requireRole.mockRejectedValueOnce(new Error('no session'))
    const res = await GET(request('?code=abc&state=good'))
    const loc = await locationOf(res)
    expect(loc.searchParams.get('calendar_error')).toBe('session_expired')
  })

  it('redirects with account_mismatch when the session account differs from the state account', async () => {
    mocks.verifyOAuthState.mockReturnValue({ accountId: 'account-OTHER', nonce: 'n', iat: 0 })
    const res = await GET(request('?code=abc&state=good'))
    const loc = await locationOf(res)
    expect(loc.searchParams.get('calendar_error')).toBe('account_mismatch')
    expect(mocks.exchangeCodeForTokens).not.toHaveBeenCalled()
  })

  it('redirects with no_refresh_token and does NOT upsert when Google omits the refresh token', async () => {
    mocks.exchangeCodeForTokens.mockResolvedValue({
      accessToken: 'at-1',
      expiresAt: new Date(),
      refreshToken: null,
    })
    const res = await GET(request('?code=abc&state=good'))
    const loc = await locationOf(res)
    expect(loc.searchParams.get('calendar_error')).toBe('no_refresh_token')
    expect(mocks.upsertCalendarConfig).not.toHaveBeenCalled()
  })

  it('redirects with exchange_failed when the token exchange throws', async () => {
    mocks.exchangeCodeForTokens.mockRejectedValue(new Error('Google 500'))
    const res = await GET(request('?code=abc&state=good'))
    const loc = await locationOf(res)
    expect(loc.searchParams.get('calendar_error')).toBe('exchange_failed')
    expect(mocks.upsertCalendarConfig).not.toHaveBeenCalled()
  })

  it('on success, upserts an INACTIVE config with the plaintext refresh token and redirects connected', async () => {
    mocks.exchangeCodeForTokens.mockResolvedValue({
      accessToken: 'at-1',
      expiresAt: new Date(),
      refreshToken: 'rt-1',
    })
    mocks.upsertCalendarConfig.mockResolvedValue({ id: 'cfg-1' })

    const res = await GET(request('?code=abc&state=good'))
    const loc = await locationOf(res)
    expect(loc.searchParams.get('calendar')).toBe('connected')
    expect(mocks.upsertCalendarConfig).toHaveBeenCalledWith(
      context.supabase,
      'account-1',
      expect.objectContaining({ refreshToken: 'rt-1', isActive: false }),
    )
  })
})
