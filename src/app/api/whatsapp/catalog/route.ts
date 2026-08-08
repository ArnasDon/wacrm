import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import { getCatalogProducts } from '@/lib/whatsapp/catalog-api'

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const catalogId = process.env.META_CATALOG_ID?.trim()
    if (!catalogId) {
      return NextResponse.json(
        { error: 'META_CATALOG_ID is not configured on the server.' },
        { status: 503 },
      )
    }

    const { data: config, error } = await supabase
      .from('whatsapp_config')
      .select('access_token')
      .eq('account_id', accountId)
      .single()

    if (error || !config) {
      return NextResponse.json({ error: 'WhatsApp is not configured.' }, { status: 400 })
    }

    const products = await getCatalogProducts({
      catalogId,
      accessToken: decrypt(config.access_token),
    })

    return NextResponse.json({ catalog_id: catalogId, products })
  } catch (error) {
    return toErrorResponse(error)
  }
}
