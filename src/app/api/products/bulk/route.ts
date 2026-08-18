import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'

// Bulk product create, backing the Products → Excel import dialog.
// One insert() call for the whole batch instead of N sequential POSTs
// to /api/products — a 100+ row import would otherwise burn through
// RATE_LIMITS.adminAction for no reason. Same validation as the
// single-product POST route, applied per row; a bad row is reported
// and skipped rather than failing the whole batch, mirroring the
// client-side preview's own error handling in parse-products-excel.ts.

const MAX_ROWS = 500

interface RawRow {
  name?: unknown
  description?: unknown
  price?: unknown
  is_active?: unknown
}

export async function POST(request: Request) {
  let ctx
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = await request.json().catch(() => null)
  const rawRows = Array.isArray(body?.rows) ? (body.rows as RawRow[]) : null
  if (!rawRows || rawRows.length === 0) {
    return NextResponse.json({ error: 'rows is required and must be a non-empty array' }, { status: 400 })
  }
  if (rawRows.length > MAX_ROWS) {
    return NextResponse.json({ error: `A single import is capped at ${MAX_ROWS} rows` }, { status: 400 })
  }

  const toInsert: {
    account_id: string
    user_id: string
    name: string
    description: string | null
    price: number
    is_active: boolean
  }[] = []
  const errors: { row: number; message: string }[] = []

  rawRows.forEach((raw, index) => {
    const rowNumber = index + 1
    const name = typeof raw.name === 'string' ? raw.name.trim() : ''
    if (!name) {
      errors.push({ row: rowNumber, message: 'name is required' })
      return
    }
    const price = Number(raw.price)
    if (!Number.isFinite(price) || price < 0) {
      errors.push({ row: rowNumber, message: 'price must be a non-negative number' })
      return
    }
    const description = typeof raw.description === 'string' ? raw.description.trim() || null : null
    const isActive = raw.is_active !== false

    toInsert.push({
      account_id: ctx.accountId,
      user_id: ctx.userId,
      name,
      description,
      price,
      is_active: isActive,
    })
  })

  if (toInsert.length === 0) {
    return NextResponse.json({ created: 0, errors }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin().from('products').insert(toInsert).select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ created: data?.length ?? 0, errors }, { status: 201 })
}
