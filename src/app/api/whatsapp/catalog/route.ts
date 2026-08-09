import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { searchCatalogues } from '@/lib/catalog/search'

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const catalogId = process.env.META_CATALOG_ID?.trim()
    if (!catalogId) {
      return NextResponse.json(
        { error: 'META_CATALOG_ID is not configured on the server.' },
        { status: 503 },
      )
    }

    const url = new URL(request.url)
    const query = (url.searchParams.get('q') || 'fitness').trim().slice(0, 120)
    const requestedLimit = Number(url.searchParams.get('limit') || 10)
    const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 10, 1), 20)

    const products = await searchCatalogues(supabase, accountId, {
      query,
      limit,
    })

    return NextResponse.json({
      catalog_id: catalogId,
      query,
      products: products.map((product) => ({
        id: product.id,
        product_retailer_id: product.id,
        name: product.name,
        description: product.description,
        price: product.price,
        currency: product.currency,
        image_url: product.imageUrl,
        product_url: product.productUrl,
        category: product.category,
        stock_quantity: product.stockQuantity,
        source_name: product.sourceName,
        variants: product.variants,
      })),
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
