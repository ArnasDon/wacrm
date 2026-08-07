import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

function optionalText(value: unknown, max = 1000): string | null {
  if (value == null || value === '') return null
  if (typeof value !== 'string') throw new Error('Expected text value.')
  const cleaned = value.trim()
  if (!cleaned) return null
  if (cleaned.length > max) throw new Error('Text value is too long.')
  return cleaned
}

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const { data, error } = await supabase
      .from('catalog_products')
      .select('*')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
    if (error) throw error
    return NextResponse.json({ products: data ?? [] })
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
    const name = optionalText(input.name, 200)
    const price = Number(input.price)
    if (!name) return NextResponse.json({ error: 'name is required.' }, { status: 400 })
    if (!Number.isFinite(price) || price < 0) {
      return NextResponse.json({ error: 'price must be a positive number.' }, { status: 400 })
    }

    const row = {
      account_id: accountId,
      name,
      price,
      currency: optionalText(input.currency, 8) ?? 'MZN',
      image_url: optionalText(input.image_url, 2000),
      description: optionalText(input.description, 4000),
      category: optionalText(input.category, 200),
      product_url: optionalText(input.product_url, 2000),
      stock_quantity:
        input.stock_quantity == null || input.stock_quantity === ''
          ? null
          : Math.max(0, Math.floor(Number(input.stock_quantity))),
      is_active: input.is_active !== false,
    }

    const { data, error } = await supabase
      .from('catalog_products')
      .insert(row)
      .select('*')
      .single()
    if (error) throw error
    return NextResponse.json({ product: data }, { status: 201 })
  } catch (error) {
    return toErrorResponse(error)
  }
}
