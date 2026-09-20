import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateKeyPairSync } from 'crypto'
import {
  loadServiceAccountFromEnv,
  commercialImpersonatedUserFromEnv,
  getServiceAccountAccessToken,
  __resetServiceAccountTokenCacheForTests,
  type ServiceAccountKey,
} from './service-account'
import type { HttpClient } from './client'

function ok(body: unknown, status = 200): Response {
  return { ok: true, status, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response
}
function err(status: number, bodyText: string): Response {
  return { ok: false, status, text: async () => bodyText } as unknown as Response
}
function mockHttp(...responses: Response[]): HttpClient {
  const fn = vi.fn()
  for (const r of responses) fn.mockResolvedValueOnce(r)
  return { fetch: fn as unknown as typeof fetch }
}

// A real (small) RSA key pair so `crypto.createSign` has something
// valid to sign against — this test never calls Google for real, only
// exercises our own JWT construction + the token-exchange HTTP call.
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
})

const sa: ServiceAccountKey = { clientEmail: 'sa@project.iam.gserviceaccount.com', privateKey }

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  __resetServiceAccountTokenCacheForTests()
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('loadServiceAccountFromEnv', () => {
  it('parses raw JSON given directly in the env var', () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({
      client_email: 'sa@x.iam.gserviceaccount.com',
      private_key: 'PRIVATE',
    })
    const key = loadServiceAccountFromEnv()
    expect(key).toEqual({ clientEmail: 'sa@x.iam.gserviceaccount.com', privateKey: 'PRIVATE' })
  })

  it('throws when the env var is unset', () => {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON
    expect(() => loadServiceAccountFromEnv()).toThrow(/GOOGLE_SERVICE_ACCOUNT_JSON/)
  })

  it('throws when the JSON is missing client_email/private_key', () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: 'only@x.com' })
    expect(() => loadServiceAccountFromEnv()).toThrow(/client_email or private_key/)
  })

  it('throws a clear error for a path that does not exist', () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '/definitely/not/a/real/path.json'
    expect(() => loadServiceAccountFromEnv()).toThrow(/not.*JSON string.*nor.*existing file/i)
  })
})

describe('commercialImpersonatedUserFromEnv', () => {
  it('defaults to geral@etergrowth.com when unset', () => {
    delete process.env.GMAIL_IMPERSONATE_USER
    expect(commercialImpersonatedUserFromEnv()).toBe('geral@etergrowth.com')
  })

  it('uses the configured user when set', () => {
    process.env.GMAIL_IMPERSONATE_USER = 'someone@etergrowth.com'
    expect(commercialImpersonatedUserFromEnv()).toBe('someone@etergrowth.com')
  })
})

describe('getServiceAccountAccessToken', () => {
  it('signs a JWT-bearer assertion and exchanges it for an access token', async () => {
    const http = mockHttp(ok({ access_token: 'at-1', expires_in: 3600 }))
    const token = await getServiceAccountAccessToken(
      sa,
      { scope: 'https://www.googleapis.com/auth/calendar.events', subject: 'geral@etergrowth.com' },
      http,
    )
    expect(token).toBe('at-1')

    const [url, init] = vi.mocked(http.fetch).mock.calls[0]
    expect(url).toBe('https://oauth2.googleapis.com/token')
    const body = new URLSearchParams(init!.body as string)
    expect(body.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer')
    const assertion = body.get('assertion')!
    const [headerB64, claimsB64] = assertion.split('.')
    const claims = JSON.parse(Buffer.from(claimsB64, 'base64url').toString('utf-8'))
    expect(claims.iss).toBe(sa.clientEmail)
    expect(claims.sub).toBe('geral@etergrowth.com')
    expect(claims.aud).toBe('https://oauth2.googleapis.com/token')
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf-8'))
    expect(header.alg).toBe('RS256')
  })

  it('caches the access token across calls with the same subject/scope', async () => {
    const http = mockHttp(ok({ access_token: 'at-1', expires_in: 3600 }))
    await getServiceAccountAccessToken(sa, { scope: 'scope-a', subject: 'geral@etergrowth.com' }, http)
    const token2 = await getServiceAccountAccessToken(
      sa,
      { scope: 'scope-a', subject: 'geral@etergrowth.com' },
      http,
    )
    expect(token2).toBe('at-1')
    expect(http.fetch).toHaveBeenCalledTimes(1) // second call served from cache
  })

  it('re-fetches for a different subject even with the same scope', async () => {
    const http = mockHttp(
      ok({ access_token: 'at-1', expires_in: 3600 }),
      ok({ access_token: 'at-2', expires_in: 3600 }),
    )
    const t1 = await getServiceAccountAccessToken(sa, { scope: 'scope-a', subject: 'a@x.com' }, http)
    const t2 = await getServiceAccountAccessToken(sa, { scope: 'scope-a', subject: 'b@x.com' }, http)
    expect(t1).toBe('at-1')
    expect(t2).toBe('at-2')
    expect(http.fetch).toHaveBeenCalledTimes(2)
  })

  it('throws a CalendarError with code invalid_grant on an unauthorized-delegation response', async () => {
    const http = mockHttp(err(400, '{"error":"unauthorized_client","error_description":"invalid_grant"}'))
    await expect(
      getServiceAccountAccessToken(sa, { scope: 'scope-a', subject: 'geral@etergrowth.com' }, http),
    ).rejects.toMatchObject({ code: 'invalid_grant' })
  })

  it('throws when the response has no access_token', async () => {
    const http = mockHttp(ok({ expires_in: 3600 }))
    await expect(
      getServiceAccountAccessToken(sa, { scope: 'scope-a', subject: 'geral@etergrowth.com' }, http),
    ).rejects.toMatchObject({ code: 'invalid_token_response' })
  })
})
