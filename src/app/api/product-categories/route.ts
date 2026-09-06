import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'

// Catalog categories (migration 106) — account-shared grouping for
// products. Same shape as the products route: RLS-scoped read via the
// user client, service-role write after an explicit agent+ check.

export async function GET() {
  try {
    const { supabase } = await getCurrentAccount()
    const { data, error } = await supabase
      .from('product_categories')
      .select('*')
      .order('position')
      .order('created_at')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ categories: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  let ctx
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = await request.json().catch(() => null)
  const name = body && typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })

  const admin = supabaseAdmin()
  const { count } = await admin
    .from('product_categories')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', ctx.accountId)

  const { data, error } = await admin
    .from('product_categories')
    .insert({ account_id: ctx.accountId, name, position: count ?? 0 })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ category: data }, { status: 201 })
}
