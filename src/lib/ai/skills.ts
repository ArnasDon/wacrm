import type { WacrmSupabaseClient } from '@/lib/supabase/types'
import { AGENT_TOOL_KEYS, type AgentToolKey } from './tool-permissions'

/** Columns the skills management API (list/create/update) reads and
 *  returns — shared so the collection and [id] routes stay in sync. */
export const SKILL_COLUMNS =
  'id, name, instructions, objective, when_to_use, when_not_to_use, tool_keys, enabled, sort_order'

export function trimmedFieldOrNull(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, maxLength) : null
}

export interface AgentSkill {
  id: string
  name: string
  instructions: string
  objective: string
  whenToUse: string
  whenNotToUse: string
  toolKeys: AgentToolKey[]
}

interface SkillRow {
  id: string
  name: string
  instructions: string | null
  objective: string | null
  when_to_use: string | null
  when_not_to_use: string | null
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
    .select('id, name, instructions, objective, when_to_use, when_not_to_use, tool_keys')
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
      objective: r.objective?.trim() ?? '',
      whenToUse: r.when_to_use?.trim() ?? '',
      whenNotToUse: r.when_not_to_use?.trim() ?? '',
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
  const withContent = skills.filter(
    (skill) => skill.instructions || skill.objective || skill.whenToUse || skill.whenNotToUse,
  )
  if (withContent.length === 0) return null
  return [
    'Skills — objectives this account configured for specific situations (e.g. selling, qualifying, after-sales). ' +
      'Each one may include when it applies and when it does not — use that as your own judgement call for THIS turn, not as a menu to announce; nothing external selects a skill for you. ' +
      'Follow whichever ones genuinely match what the customer needs right now; ignore the rest. These are internal guidance, never mention a skill by name to the customer.',
    ...withContent.map((skill) => {
      const lines = [`[${skill.name}]`]
      if (skill.objective) lines.push(`Objective: ${skill.objective}`)
      if (skill.whenToUse) lines.push(`Use when: ${skill.whenToUse}`)
      if (skill.whenNotToUse) lines.push(`Do not use when: ${skill.whenNotToUse}`)
      if (skill.instructions) lines.push(skill.instructions)
      return lines.join('\n')
    }),
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
