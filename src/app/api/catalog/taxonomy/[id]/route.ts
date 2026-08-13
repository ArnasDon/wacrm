import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

const MAX_ALIASES = 30

function optionalText(value: unknown, max: number): string | null {
  if (value == null || value === '') return null
  if (typeof value !== 'string') throw new Error('Expected text value.')
  const cleaned = value.trim()
  if (!cleaned) return null
  if (cleaned.length > max) throw new Error('Text value is too long.')
  return cleaned
}

function aliasList(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('aliases must be an array of text.')
  const cleaned = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, MAX_ALIASES)
  return Array.from(new Set(cleaned))
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { id } = await context.params
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
    }
    const input = body as Record<string, unknown>
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if ('canonical_value' in input) {
      const value = optionalText(input.canonical_value, 80)
      if (!value) return NextResponse.json({ error: 'canonical_value is required.' }, { status: 400 })
      update.canonical_value = value
    }
    if ('aliases' in input) update.aliases = aliasList(input.aliases)
    if ('enabled' in input) update.enabled = input.enabled === true

    const { data, error } = await supabase
      .from('catalog_taxonomy_terms')
      .update(update)
      .eq('id', id)
      .eq('account_id', accountId)
      .select('id, kind, canonical_value, aliases, enabled, created_at')
      .single()
    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'Já existe uma categoria/cor com este nome.' }, { status: 409 })
      }
      throw error
    }
    return NextResponse.json({ term: data })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { id } = await context.params
    const { error } = await supabase
      .from('catalog_taxonomy_terms')
      .delete()
      .eq('id', id)
      .eq('account_id', accountId)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (error) {
    return toErrorResponse(error)
  }
}
