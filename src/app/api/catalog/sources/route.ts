import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { encrypt } from '@/lib/whatsapp/encryption'

function text(value: unknown, max: number): string | null {
  if (value == null || value === '') return null
  if (typeof value !== 'string') throw new Error('Expected text value.')
  const cleaned = value.trim()
  if (!cleaned) return null
  if (cleaned.length > max) throw new Error('Text value is too long.')
  return cleaned
}

function validateHttpsUrl(raw: string): string {
  const url = new URL(raw)
  if (url.protocol !== 'https:') throw new Error('base_url must use HTTPS.')
  return url.toString()
}

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { data, error } = await supabase
      .from('catalog_sources')
      .select('id, name, source_type, is_active, base_url, search_path, auth_type, auth_header, field_mapping, meta_feed_token, created_at, updated_at')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
    if (error) throw error
    return NextResponse.json({ sources: data ?? [] })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
    }
    const input = body as Record<string, unknown>
    const name = text(input.name, 200)
    const baseUrlRaw = text(input.base_url, 2000)
    const sourceType = String(input.source_type ?? 'external_rest')
    if (!['external_rest', 'external_supabase'].includes(sourceType)) {
      return NextResponse.json({ error: 'Invalid source_type.' }, { status: 400 })
    }
    if (!name || !baseUrlRaw) {
      return NextResponse.json({ error: 'name and base_url are required.' }, { status: 400 })
    }

    const authType = sourceType === 'external_supabase' ? 'api_key_header' : String(input.auth_type ?? 'none')
    if (!['none', 'bearer', 'api_key_header'].includes(authType)) {
      return NextResponse.json({ error: 'Invalid auth_type.' }, { status: 400 })
    }
    const secret = text(input.auth_secret, 8000)
    if (sourceType === 'external_supabase' && !secret) {
      return NextResponse.json({ error: 'A Supabase API key read-only is required.' }, { status: 400 })
    }

    const mapping =
      input.field_mapping && typeof input.field_mapping === 'object' && !Array.isArray(input.field_mapping)
        ? input.field_mapping
        : {}

    if (sourceType === 'external_supabase') {
      const m = mapping as Record<string, unknown>
      if (typeof m.table !== 'string' || !m.table.trim()) {
        return NextResponse.json({ error: 'field_mapping.table is required for Supabase sources.' }, { status: 400 })
      }
    }

    const { data, error } = await supabase
      .from('catalog_sources')
      .insert({
        account_id: accountId,
        name,
        source_type: sourceType,
        is_active: input.is_active !== false,
        base_url: validateHttpsUrl(baseUrlRaw),
        search_path: sourceType === 'external_rest' ? text(input.search_path, 2000) : null,
        auth_type: authType,
        auth_header: sourceType === 'external_rest' ? text(input.auth_header, 200) : 'apikey',
        auth_secret_encrypted: secret ? encrypt(secret) : null,
        field_mapping: mapping,
      })
      .select('id, name, source_type, is_active, base_url, search_path, auth_type, auth_header, field_mapping, meta_feed_token')
      .single()
    if (error) throw error
    return NextResponse.json({ source: data }, { status: 201 })
  } catch (error) {
    return toErrorResponse(error)
  }
}
