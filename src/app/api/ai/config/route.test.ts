import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EncryptionConfigError } from '@/lib/whatsapp/encryption'

const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  loadAiConfig: vi.fn(),
  saveAiConfig: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: h.requireRole,
  toErrorResponse: (err: unknown) => new Response(JSON.stringify({ error: String(err) }), { status: 500 }),
}))
vi.mock('@/lib/ai/config', () => ({
  loadAiConfig: h.loadAiConfig,
  saveAiConfig: h.saveAiConfig,
}))

import { GET, PUT } from './route'

function putReq(body: unknown): Request {
  return new Request('http://localhost/api/ai/config', {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.requireRole.mockResolvedValue({
    supabase: {},
    accountId: 'acct-1',
    userId: 'user-1',
  })
})

describe('GET /api/ai/config', () => {
  it('never returns plaintext provider or embeddings keys', async () => {
    h.loadAiConfig.mockResolvedValue({
      accountId: 'acct-1',
      provider: 'openai',
      model: 'gpt-test',
      apiKey: 'sk-real-secret',
      agentEnabled: true,
      pipelineMoveEnabled: false,
      knowledgeEnabled: true,
      embeddingsModel: 'text-embedding-test',
      embeddingsApiKey: 'sk-embeddings-secret',
      autoReplyMaxPerConversation: 3,
      handoffAgentId: null,
    })
    const res = await GET()
    const body = await res.json()
    expect(JSON.stringify(body)).not.toContain('sk-real-secret')
    expect(JSON.stringify(body)).not.toContain('sk-embeddings-secret')
    expect(body.hasApiKey).toBe(true)
    expect(body.hasEmbeddingsApiKey).toBe(true)
  })

  it('returns null config as-is', async () => {
    h.loadAiConfig.mockResolvedValue(null)
    const res = await GET()
    const body = await res.json()
    expect(body.config).toBeNull()
  })
})

describe('PUT /api/ai/config', () => {
  it('400s on an invalid provider', async () => {
    const res = await PUT(putReq({ provider: 'bogus', model: 'x', apiKey: 'sk-1' }))
    expect(res.status).toBe(400)
  })

  it('saves a valid config', async () => {
    const res = await PUT(
      putReq({
        provider: 'openai',
        model: 'gpt-test',
        apiKey: 'sk-1',
        agentEnabled: true,
        pipelineMoveEnabled: false,
        knowledgeEnabled: true,
        embeddingsModel: 'text-embedding-test',
        embeddingsApiKey: 'sk-embeddings',
        autoReplyMaxPerConversation: 3,
        handoffAgentId: null,
      }),
    )
    expect(res.status).toBe(200)
    expect(h.saveAiConfig).toHaveBeenCalled()
  })

  it('keeps the existing key when apiKey is blank and a config already exists', async () => {
    h.loadAiConfig.mockResolvedValue({
      accountId: 'acct-1',
      provider: 'openai',
      model: 'gpt-old',
      apiKey: 'sk-existing',
      agentEnabled: false,
      pipelineMoveEnabled: false,
      knowledgeEnabled: true,
      embeddingsModel: 'text-embedding-old',
      embeddingsApiKey: 'sk-embeddings-existing',
      autoReplyMaxPerConversation: 3,
      handoffAgentId: null,
    })
    const res = await PUT(
      putReq({
        provider: 'openai',
        model: 'gpt-test',
        apiKey: '',
        agentEnabled: true,
        pipelineMoveEnabled: false,
        knowledgeEnabled: true,
        embeddingsModel: 'text-embedding-test',
        embeddingsApiKey: '',
        autoReplyMaxPerConversation: 3,
        handoffAgentId: null,
      }),
    )
    expect(res.status).toBe(200)
    expect(h.saveAiConfig).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({
        apiKey: 'sk-existing',
        embeddingsApiKey: 'sk-embeddings-existing',
      }),
    )
  })

  it('preserves a stored embeddings key when only that field is blank', async () => {
    h.loadAiConfig.mockResolvedValue({
      accountId: 'acct-1',
      provider: 'openai',
      model: 'gpt-old',
      apiKey: 'sk-existing',
      agentEnabled: false,
      pipelineMoveEnabled: false,
      knowledgeEnabled: true,
      embeddingsModel: 'text-embedding-old',
      embeddingsApiKey: 'sk-embeddings-existing',
      autoReplyMaxPerConversation: 3,
      handoffAgentId: null,
    })

    const res = await PUT(
      putReq({
        provider: 'openai',
        model: 'gpt-test',
        apiKey: 'sk-new',
        agentEnabled: true,
        pipelineMoveEnabled: false,
        knowledgeEnabled: true,
        embeddingsModel: 'text-embedding-test',
        embeddingsApiKey: '',
        autoReplyMaxPerConversation: 3,
        handoffAgentId: null,
      }),
    )

    expect(res.status).toBe(200)
    expect(h.saveAiConfig).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({
        apiKey: 'sk-new',
        embeddingsApiKey: 'sk-embeddings-existing',
      }),
    )
  })

  it('400s on a blank apiKey when no config exists yet', async () => {
    h.loadAiConfig.mockResolvedValue(null)
    const res = await PUT(putReq({ provider: 'openai', model: 'gpt-test', apiKey: '' }))
    expect(res.status).toBe(400)
    expect(h.saveAiConfig).not.toHaveBeenCalled()
  })

  it('503s with a clear message when ENCRYPTION_KEY is missing or invalid', async () => {
    h.saveAiConfig.mockRejectedValue(new EncryptionConfigError('ENCRYPTION_KEY is not configured.'))

    const res = await PUT(
      putReq({
        provider: 'openai',
        model: 'gpt-test',
        apiKey: 'sk-1',
        agentEnabled: true,
        pipelineMoveEnabled: false,
        autoReplyMaxPerConversation: 3,
        handoffAgentId: null,
      }),
    )

    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({
      code: 'encryption_key_invalid',
    })
  })

  it('503s with a migration hint when the ai_configs schema is missing', async () => {
    h.saveAiConfig.mockRejectedValue({
      code: '42P01',
      message: 'relation "ai_configs" does not exist',
    })

    const res = await PUT(
      putReq({
        provider: 'openai',
        model: 'gpt-test',
        apiKey: 'sk-1',
        agentEnabled: true,
        pipelineMoveEnabled: false,
        autoReplyMaxPerConversation: 3,
        handoffAgentId: null,
      }),
    )

    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({
      code: 'ai_schema_missing',
    })
  })
})
