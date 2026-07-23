import type { SupabaseClient } from '@supabase/supabase-js'

export type AgentRole = 'coordinator' | 'triage' | 'support' | 'sales' | 'retention' | 'automation_builder'

export type AgentActionName =
  | 'send_message'
  | 'add_tag'
  | 'remove_tag'
  | 'move_deal_stage'
  | 'assign_conversation'
  | 'create_deal'
  | 'create_automation_draft'
  | 'create_followup_task'

export interface AgentDefinition {
  role: AgentRole
  name: string
  instructions: string
  enabled: boolean
  allowedActions: AgentActionName[]
  knowledgeEnabled: boolean
}

export const ALLOWED_AGENT_ACTIONS: AgentActionName[] = [
  'send_message',
  'add_tag',
  'remove_tag',
  'move_deal_stage',
  'assign_conversation',
  'create_deal',
  'create_automation_draft',
  'create_followup_task',
]

export const BUILT_IN_AGENT_DEFINITIONS: AgentDefinition[] = [
  {
    role: 'coordinator',
    name: 'Coordinator',
    instructions: 'Choose exactly one specialist for the current CRM event.',
    enabled: true,
    allowedActions: [],
    knowledgeEnabled: false,
  },
  {
    role: 'triage',
    name: 'Triage',
    instructions: 'Classify customer intent and decide whether a human should take over.',
    enabled: true,
    allowedActions: ['assign_conversation', 'add_tag'],
    knowledgeEnabled: true,
  },
  {
    role: 'support',
    name: 'Support',
    instructions: 'Answer customer questions using account knowledge. Hand off when evidence is missing.',
    enabled: true,
    allowedActions: ['send_message', 'assign_conversation'],
    knowledgeEnabled: true,
  },
  {
    role: 'sales',
    name: 'Sales',
    instructions: 'Qualify leads and propose safe pipeline movement based on customer intent.',
    enabled: true,
    allowedActions: ['send_message', 'add_tag', 'move_deal_stage', 'create_deal'],
    knowledgeEnabled: true,
  },
  {
    role: 'retention',
    name: 'Retention',
    instructions: 'Detect complaint or churn risk and prioritize human handoff.',
    enabled: true,
    allowedActions: ['send_message', 'assign_conversation', 'add_tag'],
    knowledgeEnabled: true,
  },
  {
    role: 'automation_builder',
    name: 'Automation Builder',
    instructions: 'Draft editable automations from plain-language requests.',
    enabled: true,
    allowedActions: ['create_automation_draft'],
    knowledgeEnabled: false,
  },
]

const ROLE_SET = new Set<AgentRole>(BUILT_IN_AGENT_DEFINITIONS.map((agent) => agent.role))
const ACTION_SET = new Set<AgentActionName>(ALLOWED_AGENT_ACTIONS)

function isAgentRole(value: unknown): value is AgentRole {
  return typeof value === 'string' && ROLE_SET.has(value as AgentRole)
}

function isAgentActionName(value: unknown): value is AgentActionName {
  return typeof value === 'string' && ACTION_SET.has(value as AgentActionName)
}

export function sanitizeAgentDefinition(raw: Partial<AgentDefinition> & { role?: unknown }): AgentDefinition {
  const role = isAgentRole(raw.role) ? raw.role : 'triage'
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 80) : ''
  const instructions = typeof raw.instructions === 'string' ? raw.instructions.trim().slice(0, 4000) : ''
  const allowedActions = Array.isArray(raw.allowedActions)
    ? raw.allowedActions.filter(isAgentActionName)
    : []

  return {
    role,
    name: name || role,
    instructions,
    enabled: raw.enabled === true,
    allowedActions,
    knowledgeEnabled: raw.knowledgeEnabled === true,
  }
}

export async function loadAgentDefinitions(
  supabase: SupabaseClient,
  accountId: string,
): Promise<AgentDefinition[]> {
  const { data, error } = await supabase
    .from('ai_agent_definitions')
    .select('role, name, instructions, enabled, allowed_actions, knowledge_enabled')
    .eq('account_id', accountId)

  if (error) throw new Error(`Failed to load agent definitions: ${error.message}`)

  const overrides = new Map<AgentRole, AgentDefinition>()
  for (const row of data ?? []) {
    const raw = row as Record<string, unknown>
    if (!isAgentRole(raw.role)) continue

    overrides.set(
      raw.role,
      sanitizeAgentDefinition({
        role: raw.role,
        name: raw.name as string,
        instructions: raw.instructions as string,
        enabled: raw.enabled as boolean,
        allowedActions: raw.allowed_actions as AgentActionName[],
        knowledgeEnabled: raw.knowledge_enabled as boolean,
      }),
    )
  }

  return BUILT_IN_AGENT_DEFINITIONS.map((builtIn) => overrides.get(builtIn.role) ?? builtIn)
}
