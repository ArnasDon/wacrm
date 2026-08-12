import type { WacrmSupabaseClient } from '@/lib/supabase/types'
import { AGENT_TOOL_KEYS, type AgentToolKey } from './tool-permissions'

export interface AgentSkill {
  id: string
  name: string
  instructions: string
  toolKeys: AgentToolKey[]
}

interface SkillRow {
  id: string
  name: string
  instructions: string | null
  tool_keys: string[] | null
}

/**
 * Enabled skills for this agent, in display order. An agent that has never
 * configured a skill gets `[]` — every caller must treat that as "no
 * skill-based narrowing", not "no tools allowed", so every existing
 * account keeps today's behaviour until it opts in by creating a skill.
 */
export async function loadAgentSkills(
  db: WacrmSupabaseClient,
  accountId: string,
  agentId: string,
): Promise<AgentSkill[]> {
  const { data, error } = await db
    .from('skills')
    .select('id, name, instructions, tool_keys')
    .eq('account_id', accountId)
    .eq('agent_id', agentId)
    .eq('enabled', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) {
    console.error('[ai skills] load failed:', error)
    return []
  }
  return (data ?? []).map((row) => {
    const r = row as SkillRow
    return {
      id: r.id,
      name: r.name,
      instructions: r.instructions?.trim() ?? '',
      toolKeys: (r.tool_keys ?? []).filter((key): key is AgentToolKey =>
        (AGENT_TOOL_KEYS as readonly string[]).includes(key),
      ),
    }
  })
}

/**
 * Prompt block folding each enabled skill's own objective/instructions in,
 * alongside the fixed scaffold in defaults.ts and the account's own
 * system_prompt — additive, never a replacement for either. Mirrors the
 * shape of lessonsPrompt/contactMemoryPrompt so all "extra context" blocks
 * read the same way to the model.
 */
export function skillsPrompt(skills: AgentSkill[]): string | null {
  const withText = skills.filter((skill) => skill.instructions)
  if (withText.length === 0) return null
  return [
    'Skills — objectives this account configured for specific situations (e.g. selling, qualifying, after-sales). Follow whichever ones match what the customer needs right now; ignore the rest. These are internal guidance, never mention a skill by name to the customer.',
    ...withText.map((skill) => `[${skill.name}] ${skill.instructions}`),
  ].join('\n\n')
}

/**
 * Union of tool keys referenced by the agent's enabled skills, or `null`
 * when the agent has no skills at all (meaning: don't narrow, agent_tools
 * alone still governs). `handoff_human` is deliberately excluded from this
 * narrowing at the call site (see tools/index.ts) — it's the safety valve
 * the rest of the guardrail system depends on, not a business capability
 * that should require an admin to remember to attach it to every skill.
 */
export function skillToolKeys(skills: AgentSkill[]): Set<AgentToolKey> | null {
  if (skills.length === 0) return null
  const keys = new Set<AgentToolKey>()
  for (const skill of skills) {
    for (const key of skill.toolKeys) keys.add(key)
  }
  return keys
}

/**
 * Apply skill-based narrowing on top of the account's agent_tools
 * permissions. Returns `permissions` unchanged when the agent has no
 * skills configured. `handoff_human` is always exempt — see skillToolKeys.
 */
export function applySkillNarrowing(
  permissions: Record<AgentToolKey, boolean>,
  skills: AgentSkill[],
): Record<AgentToolKey, boolean> {
  const narrowed = skillToolKeys(skills)
  if (!narrowed) return permissions
  const effective = { ...permissions }
  for (const key of AGENT_TOOL_KEYS) {
    if (key === 'handoff_human') continue
    effective[key] = permissions[key] && narrowed.has(key)
  }
  return effective
}
