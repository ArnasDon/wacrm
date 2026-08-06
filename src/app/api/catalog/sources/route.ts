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
      .select('id, name, source_type, is_active, base_url, search_path, auth_type, auth_header, field_mapping, created_at, updated_at')
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
    if (!name || !baseUrlRaw) {
      return NextResponse.json({ error: 'name and base_url are required.' }, { status: 400 })
    }

    const authType = input.auth_type
    if (!['none', 'bearer', 'api_key_header'].includes(String(authType ?? 'none'))) {
      return NextResponse.json({ error: 'Invalid auth_type.' }, { status: 400 })
    }
    const secret = text(input.auth_secret, 4000)
    const mapping =
      input.field_mapping && typeof input.field_mapping === 'object' && !Array.isArray(input.field_mapping)
        ? input.field_mapping
        : {}

    const { data, error } = await supabase
      .from('catalog_sources')
      .insert({
        account_id: accountId,
        name,
        source_type: 'external_rest',
        is_active: input.is_active !== false,
        base_url: validateHttpsUrl(baseUrlRaw),
        search_path: text(input.search_path, 2000),
        auth_type: String(authType ?? 'none'),
        auth_header: text(input.auth_header, 200),
        auth_secret_encrypted: secret ? encrypt(secret) : null,
        field_mapping: mapping,
      })
      .select('id, name, source_type, is_active, base_url, search_path, auth_type, auth_header, field_mapping')
      .single()
    if (error) throw error
    return NextResponse.json({ source: data }, { status: 201 })
  } catch (error) {
    return toErrorResponse(error)
  }
}
