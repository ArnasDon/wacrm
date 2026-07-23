import { describe, expect, it } from 'vitest'
import { BUILT_IN_AGENT_DEFINITIONS, sanitizeAgentDefinition } from './agent-registry'

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
})
