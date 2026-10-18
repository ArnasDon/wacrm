import { describe, expect, it } from 'vitest'
import { canReuseStoredAiKey } from './stored-key'

describe('canReuseStoredAiKey', () => {
  it('reuses the key for the same hosted provider', () => {
    expect(canReuseStoredAiKey({ provider: 'openai', base_url: null }, 'openai', null)).toBe(true)
    expect(canReuseStoredAiKey({ provider: 'anthropic', base_url: null }, 'anthropic', null)).toBe(true)
  })

  it('refuses when there is no stored config', () => {
    expect(canReuseStoredAiKey(null, 'openai', null)).toBe(false)
    expect(canReuseStoredAiKey(undefined, 'openai', null)).toBe(false)
  })

  it('refuses when the provider changes', () => {
    expect(canReuseStoredAiKey({ provider: 'openai', base_url: null }, 'anthropic', null)).toBe(false)
    expect(
      canReuseStoredAiKey({ provider: 'openai', base_url: null }, 'openai_compatible', 'https://8.8.8.8/v1'),
    ).toBe(false)
  })

  it('reuses the key for the same compatible endpoint, ignoring trailing slashes and the completions suffix', () => {
    const stored = { provider: 'openai_compatible' as const, base_url: 'https://8.8.8.8/v1' }
    expect(canReuseStoredAiKey(stored, 'openai_compatible', 'https://8.8.8.8/v1')).toBe(true)
    expect(canReuseStoredAiKey(stored, 'openai_compatible', 'https://8.8.8.8/v1/')).toBe(true)
    expect(canReuseStoredAiKey(stored, 'openai_compatible', 'https://8.8.8.8/v1/chat/completions')).toBe(true)
  })

  it('refuses when the compatible endpoint moves to another host or path', () => {
    const stored = { provider: 'openai_compatible' as const, base_url: 'https://8.8.8.8/v1' }
    expect(canReuseStoredAiKey(stored, 'openai_compatible', 'https://1.1.1.1/v1')).toBe(false)
    expect(canReuseStoredAiKey(stored, 'openai_compatible', 'https://8.8.8.8/v2')).toBe(false)
  })

  it('refuses when either endpoint is missing or invalid', () => {
    expect(
      canReuseStoredAiKey({ provider: 'openai_compatible', base_url: null }, 'openai_compatible', 'https://8.8.8.8/v1'),
    ).toBe(false)
    expect(
      canReuseStoredAiKey({ provider: 'openai_compatible', base_url: 'not a url' }, 'openai_compatible', 'not a url'),
    ).toBe(false)
  })
})
