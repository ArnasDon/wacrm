import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils'
import { sendProductCarouselTemplate } from '@/lib/whatsapp/catalog-api'

export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    const conversationId = typeof body?.conversation_id === 'string' ? body.conversation_id.trim() : ''
    const templateName = typeof body?.template_name === 'string' && body.template_name.trim()
      ? body.template_name.trim()
      : 'lc_product_carousel_v1'
    const language = typeof body?.language === 'string' && body.language.trim() ? body.language.trim() : 'pt_PT'
    const ids = Array.isArray(body?.product_retailer_ids)
      ? body.product_retailer_ids.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean)
      : []
    const productRetailerIds = Array.from(new Set(ids)).slice(0, 10)

    if (!conversationId || productRetailerIds.length < 2) {
      return NextResponse.json({ error: 'conversation_id and at least two product_retailer_ids are required.' }, { status: 400 })
    }

    const catalogId = process.env.META_CATALOG_ID?.trim()
    if (!catalogId) return NextResponse.json({ error: 'META_CATALOG_ID is not configured.' }, { status: 503 })

    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('id, contact:contacts(id, phone)')
      .eq('id', conversationId)
      .eq('account_id', accountId)
      .single()
    if (convError || !conversation) return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 })

    const contact = Array.isArray(conversation.contact) ? conversation.contact[0] : conversation.contact
    const phone = sanitizePhoneForMeta(contact?.phone ?? '')
    if (!isValidE164(phone)) return NextResponse.json({ error: 'Invalid contact phone number.' }, { status: 400 })

    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('phone_number_id, access_token')
      .eq('account_id', accountId)
      .single()
    if (configError || !config) return NextResponse.json({ error: 'WhatsApp is not configured.' }, { status: 400 })

    const result = await sendProductCarouselTemplate({
      phoneNumberId: config.phone_number_id,
      accessToken: decrypt(config.access_token),
      to: phone,
      catalogId,
      templateName,
      language,
      productRetailerIds,
    })

    const preview = `Carrossel: ${productRetailerIds.length} produtos`
    const { data: saved, error: saveError } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_type: 'agent',
        content_type: 'interactive',
        content_text: preview,
        message_id: result.messageId,
        status: 'sent',
      })
      .select('id')
      .single()

    if (saveError) {
      console.error('[catalog/carousel/send] sent to Meta but failed to persist:', saveError)
    } else {
      await supabase
        .from('conversations')
        .update({ last_message_text: preview, last_message_at: new Date().toISOString() })
        .eq('id', conversationId)
        .eq('account_id', accountId)
    }

    return NextResponse.json({
      success: true,
      mode: 'product_carousel_template',
      template_name: templateName,
      language,
      product_retailer_ids: productRetailerIds,
      message_id: saved?.id ?? null,
      whatsapp_message_id: result.messageId,
    })
  } catch (error) {
    console.error('[catalog/carousel/send] error:', error)
    return toErrorResponse(error)
  }
}
