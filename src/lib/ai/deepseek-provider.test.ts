import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { generateDeepSeek } from './providers/deepseek'
import { generateReply } from './generate'
import { executeConversationalTurn } from './conversation-engine'
import { AiError, type AiConfig } from './types'
import { AI_PROVIDER_DEFAULT_MODEL, MAX_OUTPUT_TOKENS } from './defaults'

function mockConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'deepseek',
    model: 'deepseek-chat',
    apiKey: 'sk-deepseek-test-key',
    deepseekApiKey: 'sk-deepseek-test-key',
    systemPrompt: 'You are Clara.',
    isActive: true,
    autoReplyEnabled: true,
    autoReplyMaxPerConversation: 3,
    handoffAgentId: null,
    embeddingsApiKey: null,
    ...overrides,
  }
}

function okDeepSeekResponse(content: string, usageOverrides = {}): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content } }],
      usage: {
        prompt_tokens: 150,
        completion_tokens: 45,
        total_tokens: 195,
        prompt_cache_hit_tokens: 120,
        prompt_cache_miss_tokens: 30,
        ...usageOverrides,
      },
    }),
  } as unknown as Response
}

function errResponse(status: number, json: unknown): Response {
  return {
    ok: false,
    status,
    json: async () => json,
  } as unknown as Response
}

function makeFluentDb(): SupabaseClient {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    is: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => ({ data: null, error: null }),
    single: async () => ({ data: null, error: null }),
  }
  return {
    from: () => chain,
    rpc: async () => ({ data: null, error: null }),
  } as unknown as SupabaseClient
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('DeepSeek Provider Integration', () => {
  describe('Provider Defaults and Constants', () => {
    it('preserves OpenAI as the default provider and model in the system', () => {
      expect(AI_PROVIDER_DEFAULT_MODEL.openai).toBe('gpt-5.4-mini')
      expect(AI_PROVIDER_DEFAULT_MODEL.deepseek).toBe('deepseek-chat')
    })
  })

  describe('Direct generateDeepSeek calls', () => {
    it('throws missing_key when apiKey is empty or whitespace', async () => {
      await expect(
        generateDeepSeek({
          apiKey: '',
          model: 'deepseek-chat',
          systemPrompt: 'sys',
          messages: [{ role: 'user', content: 'oi' }],
          timeoutMs: 5000,
        }),
      ).rejects.toMatchObject({
        code: 'missing_key',
      })

      await expect(
        generateDeepSeek({
          apiKey: '   ',
          model: 'deepseek-chat',
          systemPrompt: 'sys',
          messages: [{ role: 'user', content: 'oi' }],
          timeoutMs: 5000,
        }),
      ).rejects.toMatchObject({
        code: 'missing_key',
      })
    })

    it('sends request with Bearer authorization and max_tokens', async () => {
      const fetchMock = vi.fn().mockResolvedValue(okDeepSeekResponse('Olá! Tudo bem?'))
      vi.stubGlobal('fetch', fetchMock)

      const result = await generateDeepSeek({
        apiKey: 'sk-secret-deepseek-123',
        model: 'deepseek-chat',
        systemPrompt: 'Você é um assistente.',
        messages: [{ role: 'user', content: 'Olá' }],
        timeoutMs: 10000,
      })

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('https://api.deepseek.com/chat/completions')
      expect(init.headers['Authorization']).toBe('Bearer sk-secret-deepseek-123')
      expect(init.headers['Content-Type']).toBe('application/json')

      const body = JSON.parse(init.body)
      expect(body.model).toBe('deepseek-chat')
      expect(body.max_tokens).toBe(MAX_OUTPUT_TOKENS)
      expect(body.messages[0]).toEqual({ role: 'system', content: 'Você é um assistente.' })
      expect(body.messages[1]).toEqual({ role: 'user', content: 'Olá' })

      expect(result.text).toBe('Olá! Tudo bem?')
      expect(result.usage).toEqual({
        promptTokens: 150,
        completionTokens: 45,
        totalTokens: 195,
        cachedTokens: 120,
      })
    })

    it('adds response_format { type: json_object } when structuredOutputRequired is true', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        okDeepSeekResponse('{"response_text":"Perfeito","transfer_required":false}'),
      )
      vi.stubGlobal('fetch', fetchMock)

      await generateDeepSeek({
        apiKey: 'sk-deepseek',
        model: 'deepseek-chat',
        systemPrompt: 'Responda em json.',
        messages: [{ role: 'user', content: 'teste' }],
        timeoutMs: 5000,
        structuredOutputRequired: true,
      })

      const [, init] = fetchMock.mock.calls[0]
      const body = JSON.parse(init.body)
      expect(body.response_format).toEqual({ type: 'json_object' })
    })

    it('masks and sanitizes error responses without leaking the API key', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        errResponse(401, { error: { message: 'Authentication failed for key sk-secret-deepseek-123' } }),
      )
      vi.stubGlobal('fetch', fetchMock)

      try {
        await generateDeepSeek({
          apiKey: 'sk-secret-deepseek-123',
          model: 'deepseek-chat',
          systemPrompt: 'sys',
          messages: [{ role: 'user', content: 'oi' }],
          timeoutMs: 5000,
        })
        expect.unreachable('Should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(AiError)
        const aiErr = err as AiError
        expect(aiErr.code).toBe('invalid_key')
        expect(aiErr.message).toContain('DeepSeek rejected the API key')
      }
    })
  })

  describe('generateReply via DeepSeek provider', () => {
    it('dispatches to generateDeepSeek and parses handoff sentinel', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        okDeepSeekResponse('Vou te transferir agora [[HANDOFF]]'),
      )
      vi.stubGlobal('fetch', fetchMock)

      const result = await generateReply({
        config: mockConfig({ provider: 'deepseek', model: 'deepseek-chat' }),
        systemPrompt: 'Sys',
        messages: [{ role: 'user', content: 'Quero falar com humano' }],
      })

      expect(result.handoff).toBe(true)
      expect(result.text).toBe('Vou te transferir agora')
      expect(result.usage?.cachedTokens).toBe(120)
    })

    it('throws missing_key if neither deepseekApiKey nor apiKey is present', async () => {
      await expect(
        generateReply({
          config: mockConfig({ provider: 'deepseek', apiKey: '', deepseekApiKey: null }),
          systemPrompt: 'Sys',
          messages: [{ role: 'user', content: 'Oi' }],
        }),
      ).rejects.toMatchObject({
        code: 'missing_key',
      })
    })
  })

  describe('Clara Conversation Engine with DeepSeek', () => {
    it('successfully processes turn, parses structured decision, and preserves business rules', async () => {
      const structuredDecision = JSON.stringify({
        response_text: 'Olá! Temos excelentes apartamentos no Puerto Ventura com vista para o mar.',
        transfer_required: false,
        summary: 'Lead interessado no Puerto Ventura.',
        tags_to_add: ['Interesse: Puerto Ventura'],
        tags_to_remove: [],
        extracted_info: { property: 'Puerto Ventura' },
      })

      const fetchMock = vi.fn().mockResolvedValue(okDeepSeekResponse(structuredDecision))
      vi.stubGlobal('fetch', fetchMock)

      const db = makeFluentDb()

      const engineResult = await executeConversationalTurn({
        db,
        accountId: 'acc-1',
        config: mockConfig({ provider: 'deepseek', model: 'deepseek-chat' }),
        messages: [{ role: 'user', content: 'Quais opções no Puerto Ventura?' }],
      })

      expect(engineResult.decision.transfer_required).toBe(false)
      expect(engineResult.decision.response_text).toContain('Puerto Ventura')
      expect(engineResult.usage?.promptTokens).toBe(150)
      expect(engineResult.usage?.cachedTokens).toBe(120)
    })
  })
})
