// ============================================================
// GET /api/public/catalog/[accountId]
//
// Public — no auth required. Feeds the public catalog page
// (src/app/catalog/[accountId]/page.tsx) so a visitor can browse a
// company's active products and request a quote without logging in.
//
// Security model (mirrors /api/invitations/[token]/peek):
//   - Service-role client, since there's no session for RLS to scope
//     to — only non-sensitive, already-public-facing columns are
//     selected (never access_token, price cost, etc.).
//   - Per-IP rate limit bounds scraping/abuse.
//   - `accountId` is a UUID from the URL, not guessable in a way that
//     matters (this is meant to be shared publicly — same trust model
//     as a storefront link) — the only thing gated is inactive
//     products and internal fields.
// ============================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { checkSharedRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

function getClientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  const xri = request.headers.get('x-real-ip')
  if (xri) return xri.trim()
  return 'unknown'
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  const ip = getClientIp(request)
  const limit = await checkSharedRateLimit(`public-catalog-view:${ip}`, RATE_LIMITS.publicCatalogView)
  if (!limit.success) return rateLimitResponse(limit)

  const { accountId } = await params
  if (!accountId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const db = supabaseAdmin()

  const [{ data: account }, { data: products, error: productsError }, { data: whatsapp }] =
    await Promise.all([
      db.from('accounts').select('name, default_currency').eq('id', accountId).maybeSingle(),
      db
        .from('products')
        .select('id, name, description, price, installation_cost, image_url')
        .eq('account_id', accountId)
        .eq('is_active', true)
        .order('name'),
      db
        .from('whatsapp_config')
        .select('public_phone_number')
        .eq('account_id', accountId)
        .eq('is_default', true)
        .maybeSingle(),
    ])

  if (!account) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (productsError) {
    console.error('[public/catalog] products error:', productsError)
    return NextResponse.json({ error: 'Failed to load catalog' }, { status: 500 })
  }

  // Price options (migration 075) — up to 2 extra priced variants per
  // product, each with its own optional installation cost and extra
  // photos. Fetched in one batch query (not per-product) and merged in
  // memory, same shape as the admin/companies member-count merge.
  const productIds = (products ?? []).map((p) => p.id as string)
  const priceOptionsByProduct = new Map<string, unknown[]>()
  if (productIds.length > 0) {
    const { data: options, error: optionsError } = await db
      .from('product_price_options')
      .select('id, product_id, label, price, installation_cost, image_urls')
      .in('product_id', productIds)
      .order('position')
    if (optionsError) {
      console.error('[public/catalog] price options error:', optionsError)
      return NextResponse.json({ error: 'Failed to load catalog' }, { status: 500 })
    }
    for (const option of options ?? []) {
      const list = priceOptionsByProduct.get(option.product_id as string) ?? []
      list.push(option)
      priceOptionsByProduct.set(option.product_id as string, list)
    }
  }

  return NextResponse.json({
    account_name: account.name,
    currency: account.default_currency ?? 'USD',
    whatsapp_number: whatsapp?.public_phone_number ?? null,
    products: (products ?? []).map((product) => ({
      ...product,
      price_options: priceOptionsByProduct.get(product.id as string) ?? [],
    })),
  })
}
