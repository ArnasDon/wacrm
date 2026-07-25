import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ generateStructured: vi.fn() }))
vi.mock('./generate-structured', () => ({
  generateStructured: h.generateStructured,
}))

import { verifyAutomationSemantics } from './automation-verify'
import type { AiConfig } from './types'

const CONFIG: AiConfig = {
  accountId: 'acct-1',
  provider: 'openai',
  model: 'gpt-test',
  apiKey: 'sk-test',
  agentEnabled: false,
  pipelineMoveEnabled: false,
  autoReplyMaxPerConversation: 3,
  handoffAgentId: null,
}

const INTENT = {
  name: 'Welcome',
  description: null,
  trigger_type: 'new_message_received' as const,
  trigger_config: {},
  steps: [
    {
      step_type: 'send_message' as const,
      step_config: { text: 'Hello' },
      branch: null,
      parent_index: null,
    },
  ],
}

beforeEach(() => vi.clearAllMocks())

describe('verifyAutomationSemantics', () => {
  it('uses a separate 1024-token structured verification call', async () => {
    h.generateStructured.mockResolvedValue({
      data: { verified: true, issues: [] },
      usage: { promptTokens: 7, completionTokens: 2 },
    })

    const result = await verifyAutomationSemantics({
      config: CONFIG,
      history: [{ role: 'user', text: 'Send Hello' }],
      locale: 'en',
      intent: INTENT,
      modelFacingAutomation: { steps: [{ text: 'Hello' }] },
    })

    expect(result).toEqual({
      verified: true,
      issues: [],
      usage: { promptTokens: 7, completionTokens: 2 },
    })
    expect(h.generateStructured).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'verify_automation_semantics',
        maxTokens: 1024,
      }),
    )
  })

  it('fails closed when the verifier says true but also reports issues', async () => {
    h.generateStructured.mockResolvedValue({
      data: {
        verified: true,
        issues: [{ code: 'omission', message: 'Wait step is missing.' }],
      },
      usage: null,
    })

    const result = await verifyAutomationSemantics({
      config: CONFIG,
      history: [],
      locale: 'en',
      intent: INTENT,
      modelFacingAutomation: {},
    })

    expect(result.verified).toBe(false)
    expect(result.issues).toHaveLength(1)
  })
})
