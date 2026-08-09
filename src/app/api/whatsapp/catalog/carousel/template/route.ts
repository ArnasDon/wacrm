import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import { createProductCarouselTemplate } from '@/lib/whatsapp/catalog-api'

export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const name = typeof body.name === 'string' && body.name.trim()
      ? body.name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 512)
      : 'lc_product_carousel_v1'
    const language = typeof body.language === 'string' && body.language.trim() ? body.language.trim() : 'pt_PT'
    const bodyText = typeof body.body_text === 'string' && body.body_text.trim()
      ? body.body_text.trim()
      : 'Veja estas opções disponíveis e escolha a que prefere.'

    const { data: config, error } = await supabase
      .from('whatsapp_config')
      .select('waba_id, access_token')
      .eq('account_id', accountId)
      .single()

    if (error || !config?.waba_id || !config?.access_token) {
      return NextResponse.json({ error: 'WhatsApp/WABA is not configured.' }, { status: 400 })
    }

    const result = await createProductCarouselTemplate({
      wabaId: config.waba_id,
      accessToken: decrypt(config.access_token),
      name,
      language,
      bodyText,
    })

    return NextResponse.json({ success: true, name, language, ...result })
  } catch (error) {
    console.error('[catalog/carousel/template] error:', error)
    return toErrorResponse(error)
  }
}
