import { describe, expect, it, vi } from 'vitest'
import { generateOpenAiCompatible, normalizeOpenAiCompatibleBaseUrl } from './openai-compatible'

describe('normalizeOpenAiCompatibleBaseUrl', () => {
  it('appends /chat/completions to a base URL', () => {
    expect(normalizeOpenAiCompatibleBaseUrl('https://8.8.8.8/v1')).toBe(
      'https://8.8.8.8/v1/chat/completions',
    )
  })

  it('does not duplicate an existing endpoint path', () => {
    expect(
      normalizeOpenAiCompatibleBaseUrl('https://8.8.8.8/v1/chat/completions'),
    ).toBe('https://8.8.8.8/v1/chat/completions')
  })

  it('accepts http for explicitly allow-listed self-hosted servers', () => {
    const previous = process.env.AI_PROVIDER_ALLOWED_PRIVATE_HOSTS
    process.env.AI_PROVIDER_ALLOWED_PRIVATE_HOSTS = '127.0.0.1'
    try {
      expect(normalizeOpenAiCompatibleBaseUrl('http://127.0.0.1:11434/v1')).toBe(
        'http://127.0.0.1:11434/v1/chat/completions',
      )
    } finally {
      if (previous === undefined) delete process.env.AI_PROVIDER_ALLOWED_PRIVATE_HOSTS
      else process.env.AI_PROVIDER_ALLOWED_PRIVATE_HOSTS = previous
    }
  })

  it('rejects plain http for a host that is not allow-listed', () => {
    const previous = process.env.AI_PROVIDER_ALLOWED_PRIVATE_HOSTS
    process.env.AI_PROVIDER_ALLOWED_PRIVATE_HOSTS = '127.0.0.1'
    try {
      expect(() => normalizeOpenAiCompatibleBaseUrl('http://8.8.8.8/v1')).toThrow(
        /must use https:\/\//,
      )
      expect(() => normalizeOpenAiCompatibleBaseUrl('http://api.groq.com/openai/v1')).toThrow(
        /must use https:\/\//,
      )
      expect(() => normalizeOpenAiCompatibleBaseUrl('http://127.0.0.2:11434/v1')).toThrow(
        /must use https:\/\//,
      )
      expect(normalizeOpenAiCompatibleBaseUrl('https://api.groq.com/openai/v1')).toBe(
        'https://api.groq.com/openai/v1/chat/completions',
      )
    } finally {
      if (previous === undefined) delete process.env.AI_PROVIDER_ALLOWED_PRIVATE_HOSTS
      else process.env.AI_PROVIDER_ALLOWED_PRIVATE_HOSTS = previous
    }
  })

  it('rejects plain http when no allow-list is configured', () => {
    const previous = process.env.AI_PROVIDER_ALLOWED_PRIVATE_HOSTS
    delete process.env.AI_PROVIDER_ALLOWED_PRIVATE_HOSTS
    try {
      expect(() => normalizeOpenAiCompatibleBaseUrl('http://127.0.0.1:11434/v1')).toThrow(
        /must use https:\/\//,
      )
    } finally {
      if (previous === undefined) delete process.env.AI_PROVIDER_ALLOWED_PRIVATE_HOSTS
      else process.env.AI_PROVIDER_ALLOWED_PRIVATE_HOSTS = previous
    }
  })

  it('rejects credentials, query strings, fragments, and unsupported protocols', () => {
    expect(() => normalizeOpenAiCompatibleBaseUrl('https://user:pass@8.8.8.8/v1')).toThrow(
      /embedded credentials/,
    )
    expect(() => normalizeOpenAiCompatibleBaseUrl('https://8.8.8.8/v1?x=1')).toThrow(
      /query string or fragment/,
    )
    expect(() => normalizeOpenAiCompatibleBaseUrl('https://8.8.8.8/v1#x')).toThrow(
      /query string or fragment/,
    )
    expect(() => normalizeOpenAiCompatibleBaseUrl('ftp://8.8.8.8/v1')).toThrow(
      /http:\/\/ or https:\/\//,
    )
  })
})

describe('generateOpenAiCompatible', () => {
  it('blocks private addresses by default', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const previous = process.env.AI_PROVIDER_ALLOWED_PRIVATE_HOSTS
    delete process.env.AI_PROVIDER_ALLOWED_PRIVATE_HOSTS
    try {
      await expect(
        generateOpenAiCompatible({
          apiKey: 'test-key',
          model: 'llama3.2',
          systemPrompt: 'sys',
          messages: [{ role: 'user', content: 'Hi' }],
          timeoutMs: 1000,
          baseUrl: 'https://127.0.0.1:11434/v1',
        }),
      ).rejects.toMatchObject({ code: 'blocked_url', status: 400 })
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      if (previous === undefined) delete process.env.AI_PROVIDER_ALLOWED_PRIVATE_HOSTS
      else process.env.AI_PROVIDER_ALLOWED_PRIVATE_HOSTS = previous
    }
  })

  it('allows a private address only when the operator explicitly allow-lists it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'Local reply' } }],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const previous = process.env.AI_PROVIDER_ALLOWED_PRIVATE_HOSTS
    process.env.AI_PROVIDER_ALLOWED_PRIVATE_HOSTS = '127.0.0.1'
    try {
      const result = await generateOpenAiCompatible({
        apiKey: 'test-key',
        model: 'llama3.2',
        systemPrompt: 'sys',
        messages: [{ role: 'user', content: 'Hi' }],
        timeoutMs: 1000,
        baseUrl: 'http://127.0.0.1:11434/v1',
      })
      expect(result).toEqual({
        text: 'Local reply',
        usage: { promptTokens: 3, completionTokens: 2, totalTokens: 5 },
      })
      expect(fetchMock).toHaveBeenCalledOnce()
    } finally {
      if (previous === undefined) delete process.env.AI_PROVIDER_ALLOWED_PRIVATE_HOSTS
      else process.env.AI_PROVIDER_ALLOWED_PRIVATE_HOSTS = previous
    }
  })

  it('uses manual redirects', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 302 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      generateOpenAiCompatible({
        apiKey: 'test-key',
        model: 'llama3.2',
        systemPrompt: 'sys',
        messages: [{ role: 'user', content: 'Hi' }],
        timeoutMs: 1000,
        baseUrl: 'https://8.8.8.8/v1',
      }),
    ).rejects.toMatchObject({ code: 'provider_error' })

    expect(fetchMock.mock.calls[0][1].redirect).toBe('manual')
  })
})
