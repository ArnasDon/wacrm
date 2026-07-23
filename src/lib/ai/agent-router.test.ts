import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ generateJson: vi.fn() }))
vi.mock('./generate-json', () => ({ generateJson: h.generateJson }))

import { routeAgentRole } from './agent-router'

const config = {
  accountId: 'acct-1',
  provider: 'openai' as const,
  model: 'gpt-test',
  apiKey: 'sk-test',
  agentEnabled: true,
  pipelineMoveEnabled: false,
  autoReplyMaxPerConversation: 3,
  handoffAgentId: null,
}

describe('routeAgentRole', () => {
  it('returns a known role from the coordinator response', async () => {
    h.generateJson.mockResolvedValue({ data: { role: 'support' }, usage: null })
    await expect(routeAgentRole({ config, message: 'What is your refund policy?' })).resolves.toBe('support')
  })

  it('falls back to triage for unknown roles', async () => {
    h.generateJson.mockResolvedValue({ data: { role: 'unknown' }, usage: null })
    await expect(routeAgentRole({ config, message: 'hello' })).resolves.toBe('triage')
  })
})
