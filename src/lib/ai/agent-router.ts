import { generateJson } from './generate-json'
import type { AgentRole } from './agent-registry'
import type { AiConfig } from './types'

const ROUTABLE_ROLES: AgentRole[] = ['triage', 'support', 'sales', 'retention']

interface RawRoute {
  role?: unknown
}

export async function routeAgentRole(args: { config: AiConfig; message: string }): Promise<AgentRole> {
  const systemPrompt =
    'You are a CRM AI coordinator. Choose exactly one specialist for this WhatsApp customer message. ' +
    `Allowed roles: ${ROUTABLE_ROLES.join(', ')}. ` +
    'Choose support for factual questions, sales for buying/qualification/pipeline intent, retention for complaints or cancellation risk, and triage when unclear.'

  const userPrompt = `Customer message:\n${args.message}\n\nReturn {"role":"support|sales|retention|triage"}.`
  const { data } = await generateJson<RawRoute>({ config: args.config, systemPrompt, userPrompt })
  const role = data && typeof data === 'object' ? data.role : null
  return ROUTABLE_ROLES.includes(role as AgentRole) ? (role as AgentRole) : 'triage'
}
