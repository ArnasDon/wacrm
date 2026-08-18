import { describe, it, expect, afterEach } from 'vitest'
import { resolveBaseUrl } from './base-url'

function req(url: string, headers: Record<string, string> = {}) {
  return new Request(url, { headers })
}

afterEach(() => {
  delete process.env.NEXT_PUBLIC_SITE_URL
  delete process.env.ALLOWED_INVITE_HOSTS
})

describe('resolveBaseUrl', () => {
  it('prefers NEXT_PUBLIC_SITE_URL, trailing slash stripped, over any header', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://crm.example.com/'
    const result = resolveBaseUrl(req('http://0.0.0.0/x', { host: 'other.example.com' }))
    expect(result).toBe('https://crm.example.com')
  })

  it('uses X-Forwarded-Host/-Proto behind a reverse proxy (the EasyPanel case)', () => {
    // This is exactly the regression: the raw request URL resolves to
    // the container's internal bind address, but the proxy still tells
    // us the real public host via the forwarded headers.
    const result = resolveBaseUrl(
      req('http://0.0.0.0:80/auth/callback', {
        'x-forwarded-host': 'sandia-sandia-crm.kmencc.easypanel.host',
        'x-forwarded-proto': 'https',
      }),
    )
    expect(result).toBe('https://sandia-sandia-crm.kmencc.easypanel.host')
  })

  it('defaults the forwarded protocol to https when only the host is forwarded', () => {
    const result = resolveBaseUrl(req('http://0.0.0.0/x', { 'x-forwarded-host': 'crm.example.com' }))
    expect(result).toBe('https://crm.example.com')
  })

  it('falls back to the Host header + request protocol for a bare deployment', () => {
    const result = resolveBaseUrl(req('https://crm.example.com/x', { host: 'crm.example.com' }))
    expect(result).toBe('https://crm.example.com')
  })

  it('falls back to the marketing site with no Host header at all', () => {
    const result = resolveBaseUrl(req('http://0.0.0.0/x'))
    expect(result).toBe('https://wacrm.tech')
  })

  it('rejects a forwarded host not on ALLOWED_INVITE_HOSTS and falls back', () => {
    process.env.ALLOWED_INVITE_HOSTS = 'crm.example.com,other.example.com'
    const result = resolveBaseUrl(
      req('http://0.0.0.0/x', { 'x-forwarded-host': 'phishing.example', host: 'phishing.example' }),
    )
    expect(result).toBe('https://wacrm.tech')
  })

  it('accepts a forwarded host that is on ALLOWED_INVITE_HOSTS', () => {
    process.env.ALLOWED_INVITE_HOSTS = 'crm.example.com'
    const result = resolveBaseUrl(req('http://0.0.0.0/x', { 'x-forwarded-host': 'crm.example.com' }))
    expect(result).toBe('https://crm.example.com')
  })
})
