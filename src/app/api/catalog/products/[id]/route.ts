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
    if ('name' in input) {
      const name = optionalText(input.name, 200)
      if (!name) return NextResponse.json({ error: 'name is required.' }, { status: 400 })
      update.name = name
    }
    if ('price' in input) {
      const price = Number(input.price)
      if (!Number.isFinite(price) || price < 0) return NextResponse.json({ error: 'Invalid price.' }, { status: 400 })
      update.price = price
    }
    if ('currency' in input) update.currency = optionalText(input.currency, 8) ?? 'MZN'
    if ('image_url' in input) update.image_url = optionalText(input.image_url, 2000)
    if ('description' in input) update.description = optionalText(input.description, 4000)
    if ('category' in input) update.category = optionalText(input.category, 200)
    if ('product_url' in input) update.product_url = optionalText(input.product_url, 2000)
    if ('stock_quantity' in input) {
      update.stock_quantity = input.stock_quantity == null || input.stock_quantity === ''
        ? null
        : Math.max(0, Math.floor(Number(input.stock_quantity)))
    }
    if ('is_active' in input) update.is_active = input.is_active === true

    const { data, error } = await supabase
      .from('catalog_products')
      .update(update)
      .eq('id', id)
      .eq('account_id', accountId)
      .select('*')
      .single()
    if (error) throw error
    return NextResponse.json({ product: data })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { id } = await context.params
    const { error } = await supabase
      .from('catalog_products')
      .delete()
      .eq('id', id)
      .eq('account_id', accountId)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (error) {
    return toErrorResponse(error)
  }
}
