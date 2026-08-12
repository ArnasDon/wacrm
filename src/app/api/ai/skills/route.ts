import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { AGENT_TOOL_KEYS, type AgentToolKey } from '@/lib/ai/tool-permissions'
import { SKILL_COLUMNS, trimmedFieldOrNull } from '@/lib/ai/skills'

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

function parseToolKeys(raw: unknown): AgentToolKey[] {
  if (!Array.isArray(raw)) return []
  const unique = new Set<AgentToolKey>()
  for (const value of raw) {
    if (typeof value === 'string' && (AGENT_TOOL_KEYS as readonly string[]).includes(value)) {
      unique.add(value as AgentToolKey)
    }
  }
  return Array.from(unique)
}

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const agentId = await resolveAgentId(supabase, accountId)
    if (!agentId) {
      return NextResponse.json({ configured: false, agent_id: null, skills: [] })
    }

    const { data, error } = await supabase
      .from('skills')
      .select(SKILL_COLUMNS)
      .eq('account_id', accountId)
      .eq('agent_id', agentId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
    if (error) throw error

    return NextResponse.json({ configured: true, agent_id: agentId, skills: data ?? [] })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name || name.length > 80) {
      return NextResponse.json({ error: 'name is required (max 80 characters)' }, { status: 400 })
    }
    const instructions =
      typeof body.instructions === 'string' ? body.instructions.trim().slice(0, 4000) : ''
    const objective = trimmedFieldOrNull(body.objective, 500)
    const whenToUse = trimmedFieldOrNull(body.when_to_use, 500)
    const whenNotToUse = trimmedFieldOrNull(body.when_not_to_use, 500)
    const toolKeys = parseToolKeys(body.tool_keys)

    const agentId = await resolveAgentId(supabase, accountId)
    if (!agentId) {
      return NextResponse.json({ error: 'Configure primeiro o agente de IA.' }, { status: 409 })
    }

    const { data, error } = await supabase
      .from('skills')
      .insert({
        account_id: accountId,
        agent_id: agentId,
        name,
        instructions,
        objective,
        when_to_use: whenToUse,
        when_not_to_use: whenNotToUse,
        tool_keys: toolKeys,
      })
      .select(SKILL_COLUMNS)
      .single()
    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'Já existe uma skill com este nome.' },
          { status: 409 },
        )
      }
      throw error
    }

    return NextResponse.json({ success: true, skill: data })
  } catch (error) {
    return toErrorResponse(error)
  }
}
