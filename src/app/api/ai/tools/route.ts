import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  AGENT_TOOL_KEYS,
  DEFAULT_AGENT_TOOLS,
  type AgentToolKey,
} from '@/lib/ai/tool-permissions'

async function resolveAgentId(
  supabase: Awaited<ReturnType<typeof requireRole>>['supabase'],
  accountId: string,
) {
  const { data, error } = await supabase
    .from('ai_configs')
    .select('id')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) throw error
  return data?.id ?? null
}

function defaultToolsResponse() {
  return Object.fromEntries(
    AGENT_TOOL_KEYS.map((key) => [key, { enabled: DEFAULT_AGENT_TOOLS[key], instructions: null }]),
  ) as Record<AgentToolKey, { enabled: boolean; instructions: string | null }>
}

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const agentId = await resolveAgentId(supabase, accountId)

    if (!agentId) {
      return NextResponse.json({ configured: false, agent_id: null, tools: defaultToolsResponse() })
    }

    const [toolRows, recentCalls, skillRows] = await Promise.all([
      supabase
        .from('agent_tools')
        .select('tool_key, enabled, instructions')
        .eq('account_id', accountId)
        .eq('agent_id', agentId),
      // Ordered desc, capped: the first row per tool_key is its most
      // recent call. No bespoke aggregate RPC needed for this.
      supabase
        .from('agent_tool_calls')
        .select('tool_key, called_at')
        .eq('account_id', accountId)
        .eq('agent_id', agentId)
        .order('called_at', { ascending: false })
        .limit(200),
      supabase
        .from('skills')
        .select('name, tool_keys')
        .eq('account_id', accountId)
        .eq('agent_id', agentId)
        .eq('enabled', true),
    ])
    if (toolRows.error) throw toolRows.error

    const tools = defaultToolsResponse()
    for (const row of toolRows.data ?? []) {
      if (AGENT_TOOL_KEYS.includes(row.tool_key as AgentToolKey)) {
        tools[row.tool_key as AgentToolKey] = {
          enabled: Boolean(row.enabled),
          instructions: row.instructions ?? null,
        }
      }
    }

    const lastUsedAt: Partial<Record<AgentToolKey, string>> = {}
    if (!recentCalls.error) {
      for (const row of recentCalls.data ?? []) {
        const key = row.tool_key as AgentToolKey
        if (AGENT_TOOL_KEYS.includes(key) && !lastUsedAt[key]) lastUsedAt[key] = row.called_at
      }
    }

    const usedBySkills: Record<AgentToolKey, string[]> = Object.fromEntries(
      AGENT_TOOL_KEYS.map((key) => [key, [] as string[]]),
    ) as Record<AgentToolKey, string[]>
    if (!skillRows.error) {
      for (const row of skillRows.data ?? []) {
        for (const key of (row.tool_keys ?? []) as string[]) {
          if (AGENT_TOOL_KEYS.includes(key as AgentToolKey)) {
            usedBySkills[key as AgentToolKey].push(row.name)
          }
        }
      }
    }

    return NextResponse.json({
      configured: true,
      agent_id: agentId,
      tools,
      last_used_at: lastUsedAt,
      used_by_skills: usedBySkills,
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const body = await request.json().catch(() => null)
    const toolKey = body?.tool_key as AgentToolKey | undefined
    const enabled = body?.enabled
    const rawInstructions = body?.instructions

    if (!toolKey || !AGENT_TOOL_KEYS.includes(toolKey) || typeof enabled !== 'boolean') {
      return NextResponse.json(
        { error: 'tool_key válido e enabled (boolean) são obrigatórios.' },
        { status: 400 },
      )
    }
    if (rawInstructions !== undefined && rawInstructions !== null && typeof rawInstructions !== 'string') {
      return NextResponse.json({ error: 'instructions deve ser texto ou nulo.' }, { status: 400 })
    }

    const agentId = await resolveAgentId(supabase, accountId)
    if (!agentId) {
      return NextResponse.json({ error: 'Configure primeiro o agente de IA.' }, { status: 409 })
    }

    // `instructions` is only included in the upsert payload when the caller
    // explicitly sent it — PostgREST's upsert only assigns the columns
    // present in the payload on conflict, so omitting it here leaves any
    // previously saved account-specific guidance untouched.
    const instructionsProvided = rawInstructions !== undefined
    const instructions =
      typeof rawInstructions === 'string' ? rawInstructions.trim() || null : null

    const upsertPayload: Record<string, unknown> = {
      account_id: accountId,
      agent_id: agentId,
      tool_key: toolKey,
      enabled,
    }
    if (instructionsProvided) upsertPayload.instructions = instructions

    const { error } = await supabase
      .from('agent_tools')
      .upsert(upsertPayload, { onConflict: 'agent_id,tool_key' })
    if (error) throw error

    return NextResponse.json({
      success: true,
      tool_key: toolKey,
      enabled,
      instructions: instructionsProvided ? instructions : undefined,
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
