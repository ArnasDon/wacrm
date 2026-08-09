import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils'
import { getCustomerServiceWindow } from '@/lib/whatsapp/customer-service-window'
import { sendCatalogProduct, sendCatalogProductList } from '@/lib/whatsapp/catalog-api'

export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    const conversationId = typeof body?.conversation_id === 'string' ? body.conversation_id : ''
    const singleRetailerId = typeof body?.product_retailer_id === 'string' ? body.product_retailer_id.trim() : ''
    const retailerIds = Array.isArray(body?.product_retailer_ids)
      ? body.product_retailer_ids.filter((value): value is string => typeof value === 'string').map((value) => value.trim()).filter(Boolean)
      : []
    const productRetailerIds = Array.from(new Set(retailerIds.length ? retailerIds : singleRetailerId ? [singleRetailerId] : [])).slice(0, 10)
    const productName = typeof body?.product_name === 'string' ? body.product_name.trim() : ''
    const productNames = Array.isArray(body?.product_names)
      ? body.product_names.filter((value): value is string => typeof value === 'string').map((value) => value.trim()).filter(Boolean)
      : []
    const bodyText = typeof body?.body_text === 'string' ? body.body_text.trim().slice(0, 1024) : ''

    if (!conversationId || productRetailerIds.length === 0) {
      return NextResponse.json(
        { error: 'conversation_id and at least one product retailer id are required.' },
        { status: 400 },
      )
    }

    const catalogId = process.env.META_CATALOG_ID?.trim()
    if (!catalogId) {
      return NextResponse.json({ error: 'META_CATALOG_ID is not configured.' }, { status: 503 })
    }

    const serviceWindow = await getCustomerServiceWindow(supabase, conversationId)
    if (!serviceWindow.open) {
      return NextResponse.json(
        {
          error: 'The 24-hour WhatsApp customer-service window is closed. Send an approved template first.',
          code: 'customer_service_window_closed',
          requires_template: true,
        },
        { status: 409 },
      )
    }

    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('id, contact:contacts(id, phone)')
      .eq('id', conversationId)
      .eq('account_id', accountId)
      .single()

    if (convError || !conversation) {
      return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 })
    }

    const contact = Array.isArray(conversation.contact)
      ? conversation.contact[0]
      : conversation.contact
    const phone = sanitizePhoneForMeta(contact?.phone ?? '')
    if (!isValidE164(phone)) {
      return NextResponse.json({ error: 'Invalid contact phone number.' }, { status: 400 })
    }

    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('phone_number_id, access_token')
      .eq('account_id', accountId)
      .single()

    if (configError || !config) {
      return NextResponse.json({ error: 'WhatsApp is not configured.' }, { status: 400 })
    }

    const credentials = {
      phoneNumberId: config.phone_number_id,
      accessToken: decrypt(config.access_token),
      to: phone,
      catalogId,
    }

    const result = productRetailerIds.length === 1
      ? await sendCatalogProduct({
          ...credentials,
          productRetailerId: productRetailerIds[0],
          bodyText: bodyText || undefined,
        })
      : await sendCatalogProductList({
          ...credentials,
          productRetailerIds,
          bodyText: bodyText || 'Veja estas opções disponíveis:',
        })

    const names = productNames.length ? productNames : productName ? [productName] : []
    const preview = productRetailerIds.length === 1
      ? `Produto: ${names[0] || productRetailerIds[0]}`
      : `Catálogo: ${names.length ? names.join(', ') : `${productRetailerIds.length} produtos`}`

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
      console.error('[catalog/send] sent to Meta but failed to persist:', saveError)
      return NextResponse.json(
        { error: `Product sent to WhatsApp but failed to save locally: ${saveError.message}` },
        { status: 500 },
      )
    }

    await supabase
      .from('conversations')
      .update({ last_message_text: preview, last_message_at: new Date().toISOString() })
      .eq('id', conversationId)
      .eq('account_id', accountId)

    return NextResponse.json({
      success: true,
      mode: productRetailerIds.length === 1 ? 'product' : 'product_list',
      product_retailer_ids: productRetailerIds,
      message_id: saved.id,
      whatsapp_message_id: result.messageId,
    })
  } catch (error) {
    console.error('[catalog/send] error:', error)
    return toErrorResponse(error)
  }
}
