import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { parsePriceOptions, parseInstallationCost } from '@/lib/products/price-options'
import { parseRates } from '@/lib/products/rates'
import { resolveCategoryId } from '@/lib/products/categories'

// Product catalog — account-shared, no inventory tracking. GET lists;
// POST creates. Mirrors the quick-replies route: RLS-scoped read via
// the user client, service-role write after an explicit role check.

export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    // RLS (products_select / product_price_options_select) scopes both
    // queries to the caller's account.
    const [
      { data, error },
      { data: priceOptions, error: optionsError },
      { data: rates, error: ratesError },
    ] = await Promise.all([
      supabase.from('products').select('*').order('created_at', { ascending: false }),
      supabase
        .from('product_price_options')
        .select('*')
        .eq('account_id', accountId)
        .order('position'),
      supabase
        .from('product_rates')
        .select('*')
        .eq('account_id', accountId)
        .order('position'),
    ])
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (optionsError) return NextResponse.json({ error: optionsError.message }, { status: 500 })
    if (ratesError) return NextResponse.json({ error: ratesError.message }, { status: 500 })

    const optionsByProduct = new Map<string, typeof priceOptions>()
    for (const option of priceOptions ?? []) {
      const list = optionsByProduct.get(option.product_id as string) ?? []
      list.push(option)
      optionsByProduct.set(option.product_id as string, list)
    }
    const ratesByProduct = new Map<string, typeof rates>()
    for (const rate of rates ?? []) {
      const list = ratesByProduct.get(rate.product_id as string) ?? []
      list.push(rate)
      ratesByProduct.set(rate.product_id as string, list)
    }

    const products = (data ?? []).map((product) => ({
      ...product,
      price_options: optionsByProduct.get(product.id as string) ?? [],
      rates: ratesByProduct.get(product.id as string) ?? [],
    }))
    return NextResponse.json({ products })
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
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })

  const price = Number(body.price)
  if (!Number.isFinite(price) || price < 0) {
    return NextResponse.json({ error: 'price must be a non-negative number' }, { status: 400 })
  }

  const description = typeof body.description === 'string' ? body.description.trim() || null : null
  const imageUrl = typeof body.image_url === 'string' ? body.image_url.trim() || null : null
  const isActive = body.is_active !== false

  const installationCost = parseInstallationCost(body.installation_cost)
  if (!installationCost.ok) {
    return NextResponse.json({ error: installationCost.error }, { status: 400 })
  }

  const parsedOptions = parsePriceOptions(body.price_options)
  if (!parsedOptions.ok) {
    return NextResponse.json({ error: parsedOptions.error }, { status: 400 })
  }

  const parsedRates = parseRates(body.rates)
  if (!parsedRates.ok) {
    return NextResponse.json({ error: parsedRates.error }, { status: 400 })
  }

  const admin = supabaseAdmin()

  const category = await resolveCategoryId(admin, ctx.accountId, body.category_id)
  if (!category.ok) {
    return NextResponse.json({ error: category.error }, { status: 400 })
  }

  const { data, error } = await admin
    .from('products')
    .insert({
      account_id: ctx.accountId,
      user_id: ctx.userId,
      name,
      description,
      price,
      installation_cost: installationCost.value,
      image_url: imageUrl,
      is_active: isActive,
      category_id: category.value,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (parsedRates.rates.length > 0) {
    const { error: ratesError } = await admin.from('product_rates').insert(
      parsedRates.rates.map((r) => ({
        account_id: ctx.accountId,
        product_id: data.id,
        day_of_week: r.day_of_week,
        occupancy: r.occupancy,
        price: r.price,
        date_from: r.date_from,
        date_to: r.date_to,
        position: r.position,
      })),
    )
    if (ratesError) return NextResponse.json({ error: ratesError.message }, { status: 500 })
  }

  let priceOptions: unknown[] = []
  if (parsedOptions.options.length > 0) {
    const { data: insertedOptions, error: optionsError } = await admin
      .from('product_price_options')
      .insert(
        parsedOptions.options.map((option, index) => ({
          account_id: ctx.accountId,
          product_id: data.id,
          label: option.label,
          price: option.price,
          installation_cost: option.installation_cost,
          image_urls: option.image_urls,
          position: index,
        })),
      )
      .select()
    if (optionsError) return NextResponse.json({ error: optionsError.message }, { status: 500 })
    priceOptions = insertedOptions ?? []
  }

  const { data: rates } = await admin
    .from('product_rates')
    .select('*')
    .eq('product_id', data.id)
    .order('position')

  return NextResponse.json(
    { product: { ...data, price_options: priceOptions, rates: rates ?? [] } },
    { status: 201 },
  )
}
