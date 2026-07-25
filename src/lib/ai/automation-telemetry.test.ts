import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  from: vi.fn(),
  insert: vi.fn(),
  select: vi.fn(),
  single: vi.fn(),
}))

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({ from: h.from }),
}))

import { recordAutomationGeneration } from './automation-telemetry'

beforeEach(() => {
  vi.clearAllMocks()
  h.from.mockReturnValue({ insert: h.insert })
  h.insert.mockReturnValue({ select: h.select })
  h.select.mockReturnValue({ single: h.single })
  h.single.mockResolvedValue({ data: { id: 'generation-1' }, error: null })
})

describe('recordAutomationGeneration', () => {
  it('writes only the migration metadata allow-list through supabaseAdmin', async () => {
    const generationId = await recordAutomationGeneration({
      accountId: 'acct-1',
      userId: 'user-1',
      config: { provider: 'openai', model: 'gpt-test' },
      result: 'draft',
      failureCode: null,
      generationCount: 2,
      repairCount: 1,
      verificationCount: 2,
      promptTokens: 100,
      completionTokens: 40,
      durationMs: 123,
      issueCount: 0,
      draftHash:
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    })

    expect(generationId).toBe('generation-1')
    expect(h.from).toHaveBeenCalledWith('ai_automation_generations')
    const row = h.insert.mock.calls[0][0]
    expect(row).toEqual({
      account_id: 'acct-1',
      user_id: 'user-1',
      provider: 'openai',
      model: 'gpt-test',
      result: 'draft',
      failure_code: null,
      generation_count: 2,
      repair_count: 1,
      verification_count: 2,
      prompt_tokens: 100,
      completion_tokens: 40,
      duration_ms: 123,
      issue_count: 0,
      draft_hash:
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    })
    expect(Object.keys(row)).not.toEqual(
      expect.arrayContaining([
        'message',
        'history',
        'current_draft',
        'prompt',
        'automation',
      ]),
    )
  })
})
