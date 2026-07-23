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
  knowledgeEnabled: false,
  embeddingsModel: 'text-embedding-3-small',
  embeddingsApiKey: null,
  autoReplyMaxPerConversation: 3,
  handoffAgentId: null,
}

describe('routeAgentRole', () => {
  it('returns a known role from the coordinator response', async () => {
    h.generateJson.mockResolvedValue({ data: { role: 'support' }, usage: null })
    const message = 'What is your refund policy?'

    await expect(routeAgentRole({ config, message })).resolves.toBe('support')

    expect(h.generateJson).toHaveBeenCalledWith({
      config,
      systemPrompt: expect.stringContaining('CRM AI coordinator'),
      userPrompt: `Customer message:\n${message}\n\nReturn {"role":"support|sales|retention|triage"}.`,
    })
    expect(h.generateJson).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining('Allowed roles: triage, support, sales, retention.'),
      }),
    )
  })

  it('falls back to triage for unknown roles', async () => {
    h.generateJson.mockResolvedValue({ data: { role: 'unknown' }, usage: null })
    await expect(routeAgentRole({ config, message: 'hello' })).resolves.toBe('triage')
  })

  it('falls back to triage for non-object coordinator JSON', async () => {
    h.generateJson.mockResolvedValue({ data: null, usage: null })
    await expect(routeAgentRole({ config, message: 'hello' })).resolves.toBe('triage')
  })

  it('propagates provider failures from the coordinator request', async () => {
    h.generateJson.mockRejectedValue(new Error('provider unavailable'))

    await expect(routeAgentRole({ config, message: 'hello' })).rejects.toThrow('provider unavailable')
  })
})
