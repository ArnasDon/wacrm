import type { WacrmSupabaseClient } from '@/lib/supabase/types'

export const AGENT_TOOL_KEYS = [
  'search_catalog',
  'send_product',
  'search_knowledge',
  'add_tag',
  'create_deal',
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
  // This replaces the existing handoff sentinel, so preserve the current
  // automatic safety behaviour for every configured agent.
  handoff_human: true,
}

export async function loadAgentToolPermissions(
  db: WacrmSupabaseClient,
  accountId: string,
  agentId: string,
): Promise<Record<AgentToolKey, boolean>> {
  const { data, error } = await db
    .from('agent_tools')
    .select('tool_key, enabled')
    .eq('account_id', accountId)
    .eq('agent_id', agentId)

  if (error) {
    // Backwards-compatible fallback while a deployment is waiting for the
    // agent_tools migration. This preserves the behaviour that existed before
    // permissions became explicit.
    console.warn('[ai tools] permission lookup failed; using legacy defaults:', error.message)
    return { ...DEFAULT_AGENT_TOOLS }
  }

  const result = { ...DEFAULT_AGENT_TOOLS }
  for (const row of data ?? []) {
    if (AGENT_TOOL_KEYS.includes(row.tool_key as AgentToolKey)) {
      result[row.tool_key as AgentToolKey] = Boolean(row.enabled)
    }
  }
  return result
}
