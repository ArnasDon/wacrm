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

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const agentId = await resolveAgentId(supabase, accountId)

    if (!agentId) {
      return NextResponse.json({ configured: false, agent_id: null, tools: DEFAULT_AGENT_TOOLS })
    }

    const { data, error } = await supabase
      .from('agent_tools')
      .select('tool_key, enabled')
      .eq('account_id', accountId)
      .eq('agent_id', agentId)
    if (error) throw error

    const tools = { ...DEFAULT_AGENT_TOOLS }
    for (const row of data ?? []) {
      if (AGENT_TOOL_KEYS.includes(row.tool_key as AgentToolKey)) {
        tools[row.tool_key as AgentToolKey] = Boolean(row.enabled)
      }
    }

    return NextResponse.json({ configured: true, agent_id: agentId, tools })
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

    if (!toolKey || !AGENT_TOOL_KEYS.includes(toolKey) || typeof enabled !== 'boolean') {
      return NextResponse.json(
        { error: 'tool_key válido e enabled (boolean) são obrigatórios.' },
        { status: 400 },
      )
    }

    const agentId = await resolveAgentId(supabase, accountId)
    if (!agentId) {
      return NextResponse.json({ error: 'Configure primeiro o agente de IA.' }, { status: 409 })
    }

    const { error } = await supabase.from('agent_tools').upsert(
      {
        account_id: accountId,
        agent_id: agentId,
        tool_key: toolKey,
        enabled,
      },
      { onConflict: 'agent_id,tool_key' },
    )
    if (error) throw error

    return NextResponse.json({ success: true, tool_key: toolKey, enabled })
  } catch (error) {
    return toErrorResponse(error)
  }
}
