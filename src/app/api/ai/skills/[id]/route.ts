import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { AGENT_TOOL_KEYS, type AgentToolKey } from '@/lib/ai/tool-permissions'
import { SKILL_COLUMNS, trimmedFieldOrNull } from '@/lib/ai/skills'

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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  try {
    const { supabase, accountId } = await requireRole('admin')
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const update: Record<string, unknown> = {}
    if ('name' in body) {
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      if (!name || name.length > 80) {
        return NextResponse.json({ error: 'name is required (max 80 characters)' }, { status: 400 })
      }
      update.name = name
    }
    if ('instructions' in body) {
      update.instructions =
        typeof body.instructions === 'string' ? body.instructions.trim().slice(0, 4000) : ''
    }
    if ('objective' in body) update.objective = trimmedFieldOrNull(body.objective, 500)
    if ('when_to_use' in body) update.when_to_use = trimmedFieldOrNull(body.when_to_use, 500)
    if ('when_not_to_use' in body) {
      update.when_not_to_use = trimmedFieldOrNull(body.when_not_to_use, 500)
    }
    if ('tool_keys' in body) update.tool_keys = parseToolKeys(body.tool_keys)
    if ('enabled' in body) update.enabled = body.enabled === true
    if ('sort_order' in body) {
      const sortOrder = Number(body.sort_order)
      if (Number.isFinite(sortOrder)) update.sort_order = Math.floor(sortOrder)
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('skills')
      .update(update)
      .eq('id', id)
      .eq('account_id', accountId)
      .select(SKILL_COLUMNS)
      .maybeSingle()
    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'Já existe uma skill com este nome.' },
          { status: 409 },
        )
      }
      throw error
    }
    if (!data) return NextResponse.json({ error: 'Skill not found' }, { status: 404 })

    return NextResponse.json({ success: true, skill: data })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { error } = await supabase
      .from('skills')
      .delete()
      .eq('id', id)
      .eq('account_id', accountId)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error) {
    return toErrorResponse(error)
  }
}
