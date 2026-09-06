import { describe, it, expect } from 'vitest'
import { parseOtpType, sanitizeNext } from './confirm-params'

describe('parseOtpType', () => {
  it('accepts the e-mail-link OTP types', () => {
    for (const t of ['invite', 'recovery', 'magiclink', 'email', 'signup', 'email_change']) {
      expect(parseOtpType(t)).toBe(t)
    }
  })

  it('rejects anything else', () => {
    expect(parseOtpType('sms')).toBeNull()
    expect(parseOtpType('phone_change')).toBeNull()
    expect(parseOtpType('')).toBeNull()
    expect(parseOtpType(null)).toBeNull()
    expect(parseOtpType(undefined)).toBeNull()
    expect(parseOtpType('recovery; drop table')).toBeNull()
  })
})

describe('sanitizeNext', () => {
  it('passes through a plain in-app path', () => {
    expect(sanitizeNext('/reset-password')).toBe('/reset-password')
    expect(sanitizeNext('/dashboard?tab=x')).toBe('/dashboard?tab=x')
  })

  it('falls back when empty or missing', () => {
    expect(sanitizeNext(null)).toBe('/dashboard')
    expect(sanitizeNext('')).toBe('/dashboard')
    expect(sanitizeNext(undefined, '/reset-password')).toBe('/reset-password')
  })

  it('rejects off-origin destinations', () => {
    expect(sanitizeNext('//evil.com')).toBe('/dashboard')
    expect(sanitizeNext('https://evil.com')).toBe('/dashboard')
    expect(sanitizeNext('http://evil.com')).toBe('/dashboard')
    expect(sanitizeNext('/\\evil.com')).toBe('/dashboard')
    expect(sanitizeNext('/path\\x')).toBe('/dashboard')
    expect(sanitizeNext('javascript:alert(1)')).toBe('/dashboard')
    expect(sanitizeNext('/%2F%2Fevil.com')).toBe('/dashboard')
    expect(sanitizeNext('  /ok', '/reset-password')).toBe('/ok')
  })

  it('uses the given fallback', () => {
    expect(sanitizeNext('bad', '/reset-password')).toBe('/reset-password')
  })
})
