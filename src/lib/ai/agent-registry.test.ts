import { describe, expect, it, vi } from 'vitest'
import {
  BUILT_IN_AGENT_DEFINITIONS,
  loadAgentDefinitions,
  sanitizeAgentDefinition,
} from './agent-registry'

describe('agent registry', () => {
  it('includes the expected built-in roles', () => {
    expect(BUILT_IN_AGENT_DEFINITIONS.map((agent) => agent.role)).toEqual([
      'coordinator',
      'triage',
      'support',
      'sales',
      'retention',
      'automation_builder',
    ])
  })

  it('drops unsupported actions from overrides', () => {
    const sanitized = sanitizeAgentDefinition({
      role: 'support',
      name: 'Support',
      instructions: 'Answer with knowledge.',
      enabled: true,
      allowedActions: ['send_message', 'drop_database' as never],
      knowledgeEnabled: true,
    })

    expect(sanitized.allowedActions).toEqual(['send_message'])
  })

  it('sanitizes an invalid override role to triage', () => {
    const sanitized = sanitizeAgentDefinition({ role: 'not_a_role' } as Parameters<typeof sanitizeAgentDefinition>[0])

    expect(sanitized).toMatchObject({ role: 'triage', name: 'triage' })
  })

  it('loads account-scoped overrides and ignores invalid roles', async () => {
    const eq = vi.fn().mockResolvedValue({
      data: [
        {
          role: 'support',
          name: '  Account Support  ',
          instructions: 'Use this account knowledge.',
          enabled: true,
          allowed_actions: ['send_message', 'drop_database'],
          knowledge_enabled: true,
        },
        {
          role: 'not_a_role',
          name: 'Invalid override',
          instructions: 'This must not replace a built-in definition.',
          enabled: true,
          allowed_actions: ['send_message'],
          knowledge_enabled: true,
        },
      ],
      error: null,
    })
    const select = vi.fn().mockReturnValue({ eq })
    const from = vi.fn().mockReturnValue({ select })

    const definitions = await loadAgentDefinitions({ from } as never, 'acct-1')

    expect(from).toHaveBeenCalledWith('ai_agent_definitions')
    expect(select).toHaveBeenCalledWith(
      'role, name, instructions, enabled, allowed_actions, knowledge_enabled',
    )
    expect(eq).toHaveBeenCalledWith('account_id', 'acct-1')
    expect(definitions.find((definition) => definition.role === 'support')).toMatchObject({
      name: 'Account Support',
      allowedActions: ['send_message'],
    })
    expect(definitions).toContainEqual(expect.objectContaining({ role: 'triage', name: 'Triage' }))
    expect(definitions).not.toContainEqual(expect.objectContaining({ name: 'Invalid override' }))
  })

  it('propagates agent-definition query errors', async () => {
    const queryError = { message: 'database unavailable' }
    const eq = vi.fn().mockResolvedValue({ data: null, error: queryError })
    const select = vi.fn().mockReturnValue({ eq })
    const from = vi.fn().mockReturnValue({ select })

    await expect(loadAgentDefinitions({ from } as never, 'acct-1')).rejects.toThrow(
      'Failed to load agent definitions: database unavailable',
    )
    expect(eq).toHaveBeenCalledWith('account_id', 'acct-1')
  })
})
