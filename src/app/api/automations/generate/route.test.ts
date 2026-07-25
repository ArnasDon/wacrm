import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AiError } from '@/lib/ai/types'

const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  checkRateLimit: vi.fn(),
  rateLimitResponse: vi.fn(),
  loadAiConfig: vi.fn(),
  loadResources: vi.fn(),
  generateAutomationFromPrompt: vi.fn(),
  buildAutomationPreview: vi.fn(),
  recordTelemetry: vi.fn(),
  hashAutomationDraft: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: h.requireRole,
  toErrorResponse: (error: unknown) =>
    new Response(JSON.stringify({ error: String(error) }), { status: 500 }),
}))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: h.checkRateLimit,
  rateLimitResponse: h.rateLimitResponse,
  RATE_LIMITS: { aiCopilot: { limit: 20, windowMs: 60_000 } },
}))
vi.mock('@/lib/ai/config', () => ({ loadAiConfig: h.loadAiConfig }))
vi.mock('@/lib/automations/copilot-resources', () => ({
  loadCopilotAutomationResources: h.loadResources,
}))
vi.mock('@/lib/ai/automation-generate', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/ai/automation-generate')
  >('@/lib/ai/automation-generate')
  return {
    ...actual,
    generateAutomationFromPrompt: h.generateAutomationFromPrompt,
    buildAutomationPreview: h.buildAutomationPreview,
  }
})
vi.mock('@/lib/ai/automation-telemetry', () => ({
  recordAutomationGeneration: h.recordTelemetry,
}))
vi.mock('@/lib/automations/draft-integrity', () => ({
  hashAutomationDraft: h.hashAutomationDraft,
}))

import { POST } from './route'

const CONFIG = {
  accountId: 'acct-1',
  provider: 'openai' as const,
  model: 'gpt-test',
  apiKey: 'sk-test',
  agentEnabled: false,
  pipelineMoveEnabled: false,
  autoReplyMaxPerConversation: 3,
  handoffAgentId: null,
}

const RESOURCES = {
  tags: [{ id: 'tag-internal-id', name: 'VIP' }],
  members: [],
  customFields: [],
  pipelines: [],
  templates: [],
  interactiveReplies: [],
}

const AUTOMATION = {
  name: 'Tag VIPs',
  description: '',
  trigger_type: 'new_message_received' as const,
  trigger_config: {},
  steps: [
    {
      step_type: 'add_tag' as const,
      step_config: { tag_id: 'tag-internal-id' },
      branch: null,
      parent_index: null,
    },
  ],
}

const LARGE_AUTOMATION = {
  ...AUTOMATION,
  steps: [
    {
      step_type: 'send_message' as const,
      step_config: { text: 'x'.repeat(17_000) },
      branch: null,
      parent_index: null,
    },
  ],
}

const METADATA = {
  generationCount: 1,
  repairCount: 0,
  verificationCount: 1,
  promptTokens: 20,
  completionTokens: 8,
  issueCount: 0,
}

function req(body: unknown): Request {
  return new Request('http://localhost/api/automations/generate', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.requireRole.mockResolvedValue({
    supabase: { authenticated: true },
    accountId: 'acct-1',
    userId: 'user-1',
  })
  h.checkRateLimit.mockReturnValue({
    success: true,
    remaining: 19,
    reset: Date.now() + 60_000,
    limit: 20,
  })
  h.loadAiConfig.mockResolvedValue(CONFIG)
  h.loadResources.mockResolvedValue(RESOURCES)
  h.recordTelemetry.mockResolvedValue('generation-1')
  h.hashAutomationDraft.mockReturnValue(
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  )
  h.buildAutomationPreview.mockReturnValue({
    trigger: 'new_message_received',
    steps: ['add_tag: VIP'],
  })
})

describe('POST /api/automations/generate', () => {
  it('enforces authentication before the per-user copilot rate limit', async () => {
    h.generateAutomationFromPrompt.mockResolvedValue({
      kind: 'question',
      text: 'Which tag?',
      reasonCode: 'clarification_needed',
      choices: ['VIP'],
      metadata: METADATA,
    })

    await POST(req({ message: 'tag customers' }))

    expect(h.requireRole).toHaveBeenCalledWith('agent')
    expect(h.checkRateLimit).toHaveBeenCalledWith(
      'ai-copilot:user-1',
      expect.objectContaining({ limit: 20 }),
    )
  })

  it('awaits a denied rate-limit decision before short-circuiting AI work', async () => {
    const denied = {
      success: false,
      remaining: 0,
      reset: Date.now() + 60_000,
      limit: 20,
    }
    h.checkRateLimit.mockResolvedValue(denied)
    h.rateLimitResponse.mockReturnValue(
      new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
        status: 429,
      }),
    )

    const response = await POST(req({ message: 'create an automation' }))

    expect(response.status).toBe(429)
    expect(h.rateLimitResponse).toHaveBeenCalledWith(denied)
    expect(h.loadAiConfig).not.toHaveBeenCalled()
    expect(h.generateAutomationFromPrompt).not.toHaveBeenCalled()
  })

  it('fails closed with 503 when the shared rate-limit store is unavailable', async () => {
    const unavailable = {
      success: false,
      unavailable: true,
      remaining: 0,
      reset: Date.now() + 1_000,
      limit: 20,
    }
    h.checkRateLimit.mockResolvedValue(unavailable)
    h.rateLimitResponse.mockReturnValue(
      new Response(
        JSON.stringify({
          error: 'Rate limit service unavailable',
          code: 'rate_limit_unavailable',
        }),
        { status: 503 },
      ),
    )

    const response = await POST(req({ message: 'create an automation' }))

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: 'Rate limit service unavailable',
      code: 'rate_limit_unavailable',
    })
    expect(h.loadAiConfig).not.toHaveBeenCalled()
    expect(h.generateAutomationFromPrompt).not.toHaveBeenCalled()
    expect(h.rateLimitResponse).toHaveBeenCalledWith(unavailable)
  })

  it('rejects an empty or overlong current message', async () => {
    const empty = await POST(req({ message: '   ' }))
    expect(empty.status).toBe(400)

    const long = await POST(req({ message: 'x'.repeat(2001) }))
    expect(long.status).toBe(400)
    expect(await long.json()).toMatchObject({ code: 'message_too_long' })
    expect(h.loadAiConfig).not.toHaveBeenCalled()
  })

  it('bounds context to 12 messages including the current one and 2000 chars each', async () => {
    h.generateAutomationFromPrompt.mockResolvedValue({
      kind: 'question',
      text: 'Which tag?',
      reasonCode: 'clarification_needed',
      choices: ['VIP'],
      metadata: METADATA,
    })
    const history = Array.from({ length: 20 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      text: `${index}:${'x'.repeat(2200)}`,
    }))

    await POST(req({ message: 'current', history }))

    const generationArgs = h.generateAutomationFromPrompt.mock.calls[0][0]
    expect(generationArgs.history).toHaveLength(12)
    expect(
      generationArgs.history.every(
        (entry: { text: string }) => entry.text.length <= 2000,
      ),
    ).toBe(true)
    expect(generationArgs.history.at(-1)).toEqual({
      role: 'user',
      text: 'current',
    })
  })

  it('validates currentDraft and forwards a valid draft with locale', async () => {
    const invalid = await POST(
      req({ message: 'change it', currentDraft: { name: 'broken' } }),
    )
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toMatchObject({
      code: 'invalid_current_draft',
    })

    h.generateAutomationFromPrompt.mockResolvedValue({
      kind: 'question',
      text: 'O que devo mudar?',
      reasonCode: 'clarification_needed',
      choices: [],
      metadata: METADATA,
    })
    const valid = await POST(
      req({
        message: 'mude a tag',
        currentDraft: AUTOMATION,
        locale: 'pt-BR',
      }),
    )
    expect(valid.status).toBe(200)
    expect(h.generateAutomationFromPrompt).toHaveBeenLastCalledWith(
      expect.objectContaining({
        currentDraft: AUTOMATION,
        locale: 'pt-BR',
      }),
    )
  })

  it('rejects an oversized currentDraft before reaching AI generation', async () => {
    const response = await POST(
      req({
        message: 'mude a automação',
        currentDraft: LARGE_AUTOMATION,
      }),
    )

    expect(response.status).toBe(413)
    expect(await response.json()).toMatchObject({
      code: 'current_draft_too_large',
    })
    expect(h.generateAutomationFromPrompt).not.toHaveBeenCalled()
    expect(h.loadAiConfig).not.toHaveBeenCalled()
  })

  it('returns the structured question shape and records metadata without content', async () => {
    h.generateAutomationFromPrompt.mockResolvedValue({
      kind: 'question',
      text: 'Qual tag?',
      reasonCode: 'clarification_needed',
      choices: ['VIP'],
      metadata: METADATA,
    })

    const response = await POST(
      req({
        message: 'conteúdo secreto do usuário',
        history: [{ role: 'assistant', text: 'outro conteúdo secreto' }],
      }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      kind: 'question',
      text: 'Qual tag?',
      reasonCode: 'clarification_needed',
      choices: ['VIP'],
    })
    expect(h.recordTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acct-1',
        userId: 'user-1',
        config: CONFIG,
        result: 'question',
        failureCode: null,
        generationCount: 1,
        verificationCount: 1,
      }),
    )
    expect(JSON.stringify(h.recordTelemetry.mock.calls[0][0])).not.toContain(
      'conteúdo secreto',
    )
  })

  it('returns only a verified issue-free draft with generation id and name-resolved preview', async () => {
    h.generateAutomationFromPrompt.mockResolvedValue({
      kind: 'draft',
      automation: AUTOMATION,
      verified: true,
      issues: [],
      metadata: METADATA,
    })

    const response = await POST(req({ message: 'tag VIP customers' }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      kind: 'draft',
      automation: AUTOMATION,
      generation_id: 'generation-1',
      verified: true,
      issues: [],
      preview: {
        trigger: 'new_message_received',
        steps: ['add_tag: VIP'],
      },
    })
    expect(h.buildAutomationPreview).toHaveBeenCalledWith(
      AUTOMATION,
      RESOURCES,
    )
    expect(h.recordTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        result: 'draft',
        draftHash:
          'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      }),
    )
  })

  it('returns ai_not_configured with the Settings link when configuration is absent', async () => {
    h.loadAiConfig.mockResolvedValue(null)

    const response = await POST(req({ message: 'tag customers' }))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toMatchObject({ code: 'ai_not_configured' })
    expect(body.error).toContain('/settings?tab=ai-agent')
  })

  it('preserves model_incompatible Settings guidance and records failure_code', async () => {
    h.generateAutomationFromPrompt.mockRejectedValue(
      new AiError(
        'The selected model is incompatible. Choose another model in Settings → AI agent (/settings?tab=ai-agent).',
        { code: 'model_incompatible', status: 422 },
      ),
    )

    const response = await POST(req({ message: 'create an automation' }))
    const body = await response.json()

    expect(response.status).toBe(422)
    expect(body.code).toBe('model_incompatible')
    expect(body.error).toContain('/settings?tab=ai-agent')
    expect(h.recordTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        result: 'failed',
        failureCode: 'model_incompatible',
      }),
    )
  })
})
