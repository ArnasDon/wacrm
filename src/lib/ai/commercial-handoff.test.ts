import { describe, it, expect } from 'vitest'
import {
  checkHandoffReadiness,
  buildMissingInfoNudge,
  shouldForceHandoffThrough,
  DEFAULT_MAX_HANDOFF_BLOCKED_ATTEMPTS,
} from './commercial-handoff'

describe('checkHandoffReadiness', () => {
  it('is ready when name, email and reason are all present', () => {
    const result = checkHandoffReadiness({
      contactName: 'Ricardo',
      contactEmail: 'ricardo@example.com',
      escalationReason: 'Quer falar de preços.',
      contactCompany: 'Acme Lda',
    })
    expect(result).toEqual({ ready: true, missing: [] })
  })

  it('flags a missing email', () => {
    const result = checkHandoffReadiness({
      contactName: 'Ricardo',
      contactEmail: null,
      escalationReason: 'Quer falar de preços.',
      contactCompany: 'Acme Lda',
    })
    expect(result.ready).toBe(false)
    expect(result.missing).toEqual(['email'])
  })

  it('flags a missing name', () => {
    const result = checkHandoffReadiness({
      contactName: undefined,
      contactEmail: 'ricardo@example.com',
      escalationReason: 'Quer falar de preços.',
      contactCompany: 'Acme Lda',
    })
    expect(result.ready).toBe(false)
    expect(result.missing).toEqual(['name'])
  })

  it('flags a missing escalation reason', () => {
    const result = checkHandoffReadiness({
      contactName: 'Ricardo',
      contactEmail: 'ricardo@example.com',
      escalationReason: null,
      contactCompany: 'Acme Lda',
    })
    expect(result.ready).toBe(false)
    expect(result.missing).toEqual(['reason'])

    const missingCompanyOnly = checkHandoffReadiness({
      contactName: 'Ricardo',
      contactEmail: 'ricardo@example.com',
      escalationReason: 'Quer falar de preços.',
      contactCompany: null,
    })
    expect(missingCompanyOnly.ready).toBe(false)
    expect(missingCompanyOnly.missing).toEqual(['company'])

    const sectorIsNotACompany = checkHandoffReadiness({
      contactName: 'Ricardo',
      contactEmail: 'ricardo@example.com',
      escalationReason: 'Quer falar de preços.',
      contactCompany: '   ',
    })
    expect(sectorIsNotACompany.ready).toBe(false)
    expect(sectorIsNotACompany.missing).toEqual(['company'])
  })

  it('treats blank/whitespace-only strings the same as missing', () => {
    const result = checkHandoffReadiness({
      contactName: '   ',
      contactEmail: '',
      escalationReason: '  ',
      contactCompany: '   ',
    })
    expect(result.ready).toBe(false)
    expect(result.missing).toEqual(['name', 'email', 'reason', 'company'])
  })

  it('flags all three when everything is missing', () => {
    const result = checkHandoffReadiness({
      contactName: null,
      contactEmail: null,
      escalationReason: null,
      contactCompany: null,
    })
    expect(result.missing).toEqual(['name', 'email', 'reason', 'company'])
  })
})

describe('buildMissingInfoNudge', () => {
  it('mentions a single missing field naturally', () => {
    const text = buildMissingInfoNudge(['email'])
    expect(text).toContain('preciso só de o teu email,')
  })

  it('joins two missing fields with "e"', () => {
    const text = buildMissingInfoNudge(['name', 'email'])
    expect(text).toContain('o teu nome e o teu email')
  })

  it('joins three missing fields with commas and a final "e"', () => {
    const text = buildMissingInfoNudge(['name', 'email', 'reason'])
    expect(text).toContain('o teu nome, o teu email e o motivo do que precisas')
  })

  it('mentions the company name when it is the missing field', () => {
    const text = buildMissingInfoNudge(['company'])
    expect(text).toContain('preciso só de o nome da empresa,')
  })

  it('joins four missing fields (incluindo empresa) com vírgulas e um "e" final', () => {
    const text = buildMissingInfoNudge(['name', 'email', 'reason', 'company'])
    expect(text).toContain(
      'o teu nome, o teu email, o motivo do que precisas e o nome da empresa',
    )
  })

  it('explains why the data is needed, so it never reads like a bare form', () => {
    const text = buildMissingInfoNudge(['email'])
    expect(text).toMatch(/saberem com quem/i)
  })
})

describe('shouldForceHandoffThrough', () => {
  it('does not force through before the limit is reached', () => {
    expect(shouldForceHandoffThrough(0, 2)).toBe(false)
    expect(shouldForceHandoffThrough(1, 2)).toBe(false)
  })

  it('forces through once the limit of blocked attempts is reached', () => {
    expect(shouldForceHandoffThrough(2, 2)).toBe(true)
    expect(shouldForceHandoffThrough(3, 2)).toBe(true)
  })

  it('falls back to DEFAULT_MAX_HANDOFF_BLOCKED_ATTEMPTS when no limit is given', () => {
    expect(shouldForceHandoffThrough(DEFAULT_MAX_HANDOFF_BLOCKED_ATTEMPTS)).toBe(true)
    expect(shouldForceHandoffThrough(DEFAULT_MAX_HANDOFF_BLOCKED_ATTEMPTS - 1)).toBe(false)
  })
})
