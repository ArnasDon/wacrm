import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { parsePriceOptions, parseInstallationCost } from '@/lib/products/price-options'

// Update / delete a single product. Products are account-shared, so
// every mutation is scoped by `account_id` (the service-role client
// bypasses the agent-gated RLS, so both the role check and the account
// scope are enforced here).

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  let ctx
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const update: Record<string, unknown> = {}
  if ('name' in body) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 })
    update.name = name
  }
  if ('description' in body) {
    update.description = typeof body.description === 'string' ? body.description.trim() || null : null
  }
  if ('price' in body) {
    const price = Number(body.price)
    if (!Number.isFinite(price) || price < 0) {
      return NextResponse.json({ error: 'price must be a non-negative number' }, { status: 400 })
    }
    update.price = price
  }
  if ('installation_cost' in body) {
    const installationCost = parseInstallationCost(body.installation_cost)
    if (!installationCost.ok) {
      return NextResponse.json({ error: installationCost.error }, { status: 400 })
    }
    update.installation_cost = installationCost.value
  }
  if ('image_url' in body) {
    update.image_url = typeof body.image_url === 'string' ? body.image_url.trim() || null : null
  }
  if ('is_active' in body) {
    update.is_active = body.is_active === true
  }

  const admin = supabaseAdmin()

  if (Object.keys(update).length > 0) {
    const { error } = await admin
      .from('products')
      .update(update)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Full replace, not a diff — the form always sends the complete
  // desired set (at most 2 rows), so delete-then-reinsert correctly
  // handles adds/removes/reorders without needing to track row ids.
  if ('price_options' in body) {
    const parsedOptions = parsePriceOptions(body.price_options)
    if (!parsedOptions.ok) {
      return NextResponse.json({ error: parsedOptions.error }, { status: 400 })
    }

    const { error: deleteError } = await admin
      .from('product_price_options')
      .delete()
      .eq('product_id', id)
      .eq('account_id', ctx.accountId)
    if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 })

    if (parsedOptions.options.length > 0) {
      const { error: insertError } = await admin.from('product_price_options').insert(
        parsedOptions.options.map((option, index) => ({
          account_id: ctx.accountId,
          product_id: id,
          label: option.label,
          price: option.price,
          installation_cost: option.installation_cost,
          image_urls: option.image_urls,
          position: index,
        })),
      )
      if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  let ctx
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const { error } = await supabaseAdmin()
    .from('products')
    .delete()
    .eq('id', id)
    .eq('account_id', ctx.accountId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
