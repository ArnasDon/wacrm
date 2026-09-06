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

interface RawRate {
  weekday_group?: unknown
  occupancy?: unknown
  price?: unknown
}

interface RawRow {
  name?: unknown
  description?: unknown
  price?: unknown
  is_active?: unknown
  category?: unknown
  rates?: unknown
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

  const admin = supabaseAdmin()

  // Resolve category names → ids up front, creating any that don't exist
  // yet (an import is allowed to introduce categories).
  const wantedCategories = new Set<string>()
  for (const raw of rawRows) {
    if (typeof raw.category === 'string' && raw.category.trim()) {
      wantedCategories.add(raw.category.trim())
    }
  }
  const categoryIdByName = new Map<string, string>()
  if (wantedCategories.size > 0) {
    const { data: existing } = await admin
      .from('product_categories')
      .select('id, name')
      .eq('account_id', ctx.accountId)
    for (const c of existing ?? []) {
      categoryIdByName.set(String(c.name).trim().toLowerCase(), c.id as string)
    }
    const toCreate = [...wantedCategories].filter(
      (n) => !categoryIdByName.has(n.toLowerCase()),
    )
    if (toCreate.length > 0) {
      const base = categoryIdByName.size
      const { data: created, error: catErr } = await admin
        .from('product_categories')
        .insert(
          toCreate.map((name, i) => ({ account_id: ctx.accountId, name, position: base + i })),
        )
        .select('id, name')
      if (catErr) return NextResponse.json({ error: catErr.message }, { status: 500 })
      for (const c of created ?? []) {
        categoryIdByName.set(String(c.name).trim().toLowerCase(), c.id as string)
      }
    }
  }

  interface PreparedRow {
    insert: {
      account_id: string
      user_id: string
      name: string
      description: string | null
      price: number
      is_active: boolean
      category_id: string | null
    }
    rates: { weekday_group: string; occupancy: string; price: number }[]
  }
  const prepared: PreparedRow[] = []
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
    const categoryName =
      typeof raw.category === 'string' && raw.category.trim() ? raw.category.trim() : null
    const category_id = categoryName
      ? (categoryIdByName.get(categoryName.toLowerCase()) ?? null)
      : null

    const rates: PreparedRow['rates'] = []
    if (Array.isArray(raw.rates)) {
      for (const r of raw.rates as RawRate[]) {
        const group = r.weekday_group
        const occupancy = r.occupancy ?? 'standard'
        const p = Number(r.price)
        if (
          (group === 'weekday' || group === 'weekend') &&
          (occupancy === 'standard' || occupancy === 'couple') &&
          Number.isFinite(p) &&
          p >= 0
        ) {
          rates.push({ weekday_group: group, occupancy, price: p })
        }
      }
    }

    prepared.push({
      insert: {
        account_id: ctx.accountId,
        user_id: ctx.userId,
        name,
        description,
        price,
        is_active: isActive,
        category_id,
      },
      rates,
    })
  })

  if (prepared.length === 0) {
    return NextResponse.json({ created: 0, errors }, { status: 400 })
  }

  const { data, error } = await admin
    .from('products')
    .insert(prepared.map((p) => p.insert))
    .select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Attach rates — `insert(...).select('id')` returns ids in input
  // order, so zip them back to the prepared rows.
  const rateRows: {
    account_id: string
    product_id: string
    weekday_group: string
    occupancy: string
    price: number
    position: number
  }[] = []
  ;(data ?? []).forEach((row, i) => {
    prepared[i]?.rates.forEach((r, position) => {
      rateRows.push({
        account_id: ctx.accountId,
        product_id: row.id as string,
        weekday_group: r.weekday_group,
        occupancy: r.occupancy,
        price: r.price,
        position,
      })
    })
  })
  if (rateRows.length > 0) {
    const { error: ratesErr } = await admin.from('product_rates').insert(rateRows)
    if (ratesErr) {
      // The products landed; report the rate failure without pretending
      // the whole import failed.
      return NextResponse.json(
        { created: data?.length ?? 0, errors: [...errors, { row: 0, message: `rates: ${ratesErr.message}` }] },
        { status: 201 },
      )
    }
  }

  return NextResponse.json({ created: data?.length ?? 0, errors }, { status: 201 })
}
