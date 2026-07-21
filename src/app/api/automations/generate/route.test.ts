import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  loadAiConfig: vi.fn(),
  loadAutomationResources: vi.fn(),
  generateAutomationFromPrompt: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: h.requireRole,
  toErrorResponse: (err: unknown) => new Response(JSON.stringify({ error: String(err) }), { status: 500 }),
}))
vi.mock('@/lib/ai/config', () => ({ loadAiConfig: h.loadAiConfig }))
vi.mock('@/lib/automations/resources', () => ({ loadAutomationResources: h.loadAutomationResources }))
vi.mock('@/lib/ai/automation-generate', () => ({ generateAutomationFromPrompt: h.generateAutomationFromPrompt }))

import { POST } from './route'

function req(body: unknown): Request {
  return new Request('http://localhost/api/automations/generate', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.requireRole.mockResolvedValue({ supabase: {}, accountId: 'acct-1', userId: 'user-1' })
  h.loadAutomationResources.mockResolvedValue({ tags: [], pipelines: [] })
})

describe('POST /api/automations/generate', () => {
  it('400s on an empty message', async () => {
    const res = await POST(req({ message: '   ', history: [] }))
    expect(res.status).toBe(400)
  })

  it('400s when no AI agent is configured', async () => {
    h.loadAiConfig.mockResolvedValue(null)
    const res = await POST(req({ message: 'tag VIP customers', history: [] }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('ai_not_configured')
  })

  it('returns a question turn as-is', async () => {
    h.loadAiConfig.mockResolvedValue({ agentEnabled: false })
    h.generateAutomationFromPrompt.mockResolvedValue({ kind: 'question', text: 'Which tag?' })
    const res = await POST(req({ message: 'tag VIP customers', history: [] }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.kind).toBe('question')
  })

  it('returns a draft turn with pre-flight validation issues', async () => {
    h.loadAiConfig.mockResolvedValue({ agentEnabled: false })
    h.generateAutomationFromPrompt.mockResolvedValue({
      kind: 'draft',
      automation: {
        name: 'Tag VIPs',
        description: '',
        trigger_type: 'keyword_match',
        trigger_config: { keywords: ['vip'] },
        steps: [{ step_type: 'add_tag', step_config: { tag_id: '' }, branch: null, parent_index: null }],
      },
    })
    const res = await POST(req({ message: 'tag VIP customers', history: [] }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.kind).toBe('draft')
    expect(body.issues.length).toBeGreaterThan(0) // blank tag_id should be flagged
  })
})
