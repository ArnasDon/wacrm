import type { WacrmSupabaseClient } from '@/lib/supabase/types'

export const AGENT_TOOL_KEYS = [
  'search_catalog',
  'send_product',
  'search_knowledge',
  'add_tag',
  'create_deal',
  'schedule_visit',
  'get_style_opinion',
  'handoff_human',
] as const

export type AgentToolKey = (typeof AGENT_TOOL_KEYS)[number]

export const DEFAULT_AGENT_TOOLS: Record<AgentToolKey, boolean> = {
  search_catalog: true,
  send_product: true,
  search_knowledge: true,
  // CRM mutations require an explicit administrator opt-in.
  add_tag: false,
  create_deal: false,
  schedule_visit: false,
  // Bakes in a fashion-retail assumption (styling opinion on garments) that
  // doesn't fit every tenant on this multi-business platform — opt-in like
  // the other business-specific tools above, not an always-on lookup tool.
  get_style_opinion: false,
  // This replaces the existing handoff sentinel, so preserve the current
  // automatic safety behaviour for every configured agent.
  handoff_human: true,
}

export interface AgentToolPermissions {
  permissions: Record<AgentToolKey, boolean>
  /** Account-specific free text appended to a tool's built-in description,
   *  keyed by tool — the generic lever for tailoring a fixed tool catalogue
   *  to a specific business without a code change. Only present for tools
   *  that have non-empty instructions configured. */
  instructions: Partial<Record<AgentToolKey, string>>
}

export async function loadAgentToolPermissions(
  db: WacrmSupabaseClient,
  accountId: string,
  agentId: string,
): Promise<AgentToolPermissions> {
  const { data, error } = await db
    .from('agent_tools')
    .select('tool_key, enabled, instructions')
    .eq('account_id', accountId)
    .eq('agent_id', agentId)

  if (error) {
    // Backwards-compatible fallback while a deployment is waiting for the
    // agent_tools migration. This preserves the behaviour that existed before
    // permissions became explicit.
    console.warn('[ai tools] permission lookup failed; using legacy defaults:', error.message)
    return { permissions: { ...DEFAULT_AGENT_TOOLS }, instructions: {} }
  }

  const permissions = { ...DEFAULT_AGENT_TOOLS }
  const instructions: Partial<Record<AgentToolKey, string>> = {}
  for (const row of data ?? []) {
    if (AGENT_TOOL_KEYS.includes(row.tool_key as AgentToolKey)) {
      const key = row.tool_key as AgentToolKey
      permissions[key] = Boolean(row.enabled)
      const rowInstructions = (row as { instructions?: string | null }).instructions
      if (rowInstructions && rowInstructions.trim()) instructions[key] = rowInstructions.trim()
    }
  }
  return { permissions, instructions }
}
