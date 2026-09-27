import { describe, expect, it } from 'vitest'
import { normalizeOpenAiCompatibleBaseUrl } from './openai-compatible'

describe('normalizeOpenAiCompatibleBaseUrl', () => {
  it('appends /chat/completions to a base URL', () => {
    expect(normalizeOpenAiCompatibleBaseUrl('https://example.com/v1')).toBe(
      'https://example.com/v1/chat/completions',
    )
  })

  it('does not duplicate an existing endpoint path', () => {
    expect(normalizeOpenAiCompatibleBaseUrl('https://example.com/v1/chat/completions')).toBe(
      'https://example.com/v1/chat/completions',
    )
  })

  it('accepts http for local/self-hosted servers', () => {
    expect(normalizeOpenAiCompatibleBaseUrl('http://127.0.0.1:11434/v1')).toBe(
      'http://127.0.0.1:11434/v1/chat/completions',
    )
  })

  it('rejects credentials, query strings, fragments, and unsupported protocols', () => {
    expect(() => normalizeOpenAiCompatibleBaseUrl('https://user:pass@example.com/v1')).toThrow(
      /embedded credentials/,
    )
    expect(() => normalizeOpenAiCompatibleBaseUrl('https://example.com/v1?x=1')).toThrow(
      /query string or fragment/,
    )
    expect(() => normalizeOpenAiCompatibleBaseUrl('https://example.com/v1#x')).toThrow(
      /query string or fragment/,
    )
    expect(() => normalizeOpenAiCompatibleBaseUrl('ftp://example.com/v1')).toThrow(
      /http:\/\/ or https:\/\//,
    )
  })
})
