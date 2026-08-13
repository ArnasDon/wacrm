import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  supabaseAdmin: vi.fn(),
  loadAiConfig: vi.fn(),
  loadAccountCategoryTerms: vi.fn(),
  generateReply: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn((error: unknown) =>
    Response.json({ error: error instanceof Error ? error.message : 'error' }, { status: 500 }),
  ),
}))
vi.mock('@/lib/ai/admin-client', () => ({ supabaseAdmin: mocks.supabaseAdmin }))
vi.mock('@/lib/ai/config', () => ({ loadAiConfig: mocks.loadAiConfig }))
vi.mock('@/lib/ai/generate', () => ({ generateReply: mocks.generateReply }))
vi.mock('@/lib/catalog/taxonomy', () => ({ loadAccountCategoryTerms: mocks.loadAccountCategoryTerms }))

import { buildClassificationSystemPrompt, POST } from './route'

const FASHION_WORDS = ['legging', 'camisola', 'macacão', 'saia-calção', 'sapatilha']

beforeEach(() => {
  vi.clearAllMocks()
  mocks.supabaseAdmin.mockReturnValue({})
  mocks.loadAiConfig.mockResolvedValue({ provider: 'openai', model: 'test-model' })
  mocks.generateReply.mockResolvedValue({ text: '{"color":null,"category":null,"description":"ok"}' })
})

describe('buildClassificationSystemPrompt', () => {
  it('proposes a category from the image itself, with no fashion vocabulary, when the account has none configured', () => {
    const prompt = buildClassificationSystemPrompt([])

    for (const word of FASHION_WORDS) {
      expect(prompt.toLowerCase()).not.toContain(word)
    }
    expect(prompt).toContain('infer one from the image itself')
  })

  it("includes LC's own configured categories, including pantalona, when it configured them", () => {
    const prompt = buildClassificationSystemPrompt(['legging', 'camisola', 'pantalona'])

    expect(prompt).toContain('pantalona')
    expect(prompt).toContain('legging')
  })

  it('includes a car-rental tenant own vehicle categories with no fashion words baked in', () => {
    const prompt = buildClassificationSystemPrompt(['SUV', 'sedan', 'van'])

    expect(prompt).toContain('SUV')
    expect(prompt).toContain('sedan')
    for (const word of FASHION_WORDS) {
      expect(prompt.toLowerCase()).not.toContain(word)
    }
  })
})

describe('POST /api/catalog/classify — tenant-driven schema', () => {
  it("passes LC's own configured categories (including pantalona) into the classification prompt", async () => {
    mocks.requireRole.mockResolvedValue({ accountId: 'lc-account' })
    mocks.loadAccountCategoryTerms.mockResolvedValue(['legging', 'pantalona'])

    await POST(
      new Request('https://crm.test/api/catalog/classify', {
        method: 'POST',
        body: JSON.stringify({ image_url: 'https://cdn.example.com/photo.jpg' }),
      }),
    )

    expect(mocks.loadAccountCategoryTerms).toHaveBeenCalledWith(expect.anything(), 'lc-account')
    const [[call]] = mocks.generateReply.mock.calls
    expect(call.systemPrompt).toContain('pantalona')
  })

  it("classifies a car-rental tenant's photo using only its own configured vehicle categories, no code change", async () => {
    mocks.requireRole.mockResolvedValue({ accountId: 'car-rental-account' })
    mocks.loadAccountCategoryTerms.mockResolvedValue(['SUV', 'sedan', 'van'])

    await POST(
      new Request('https://crm.test/api/catalog/classify', {
        method: 'POST',
        body: JSON.stringify({ image_url: 'https://cdn.example.com/car.jpg' }),
      }),
    )

    const [[call]] = mocks.generateReply.mock.calls
    expect(call.systemPrompt).toContain('SUV')
    for (const word of FASHION_WORDS) {
      expect(call.systemPrompt.toLowerCase()).not.toContain(word)
    }
  })

  it('rejects a request with no image_url before touching the taxonomy or the model', async () => {
    mocks.requireRole.mockResolvedValue({ accountId: 'lc-account' })

    const response = await POST(
      new Request('https://crm.test/api/catalog/classify', { method: 'POST', body: JSON.stringify({}) }),
    )

    expect(response.status).toBe(400)
    expect(mocks.loadAccountCategoryTerms).not.toHaveBeenCalled()
    expect(mocks.generateReply).not.toHaveBeenCalled()
  })
})
