import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { renderCatalogPdf } from '@/lib/pdf/catalog-pdf'
import { uploadCatalogPdf } from '@/lib/pdf/upload-pdf'
import { sendMessageToConversation, SendMessageError } from '@/lib/whatsapp/send-message'
import type { Product } from '@/types'

/**
 * POST /api/products/send-catalog  (agent+)
 *
 * Body: { conversation_id }. Generates a PDF of the account's active
 * products and sends it as a document to the given conversation, via
 * the same channel-agnostic send core the quote-send route uses.
 */
export async function POST(request: Request) {
  let ctx
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  try {
    const body = await request.json().catch(() => null)
    const conversationId = typeof body?.conversation_id === 'string' ? body.conversation_id : ''
    if (!conversationId) return NextResponse.json({ error: 'conversation_id is required' }, { status: 400 })

    const db = supabaseAdmin()

    const { data: conv } = await db
      .from('conversations')
      .select('id')
      .eq('id', conversationId)
      .eq('account_id', ctx.accountId)
      .maybeSingle()
    if (!conv) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })

    const [{ data: products, error: productsError }, { data: account }] = await Promise.all([
      db.from('products').select('*').eq('account_id', ctx.accountId).eq('is_active', true).order('created_at'),
      db.from('accounts').select('name, default_currency').eq('id', ctx.accountId).maybeSingle(),
    ])
    if (productsError) return NextResponse.json({ error: productsError.message }, { status: 500 })
    if (!products || products.length === 0) {
      return NextResponse.json({ error: 'No active products in the catalog yet.' }, { status: 400 })
    }

    const pdf = await renderCatalogPdf(products as Product[], account?.name ?? 'Chat Sandía', account?.default_currency ?? 'USD')
    const pdfUrl = await uploadCatalogPdf(db, ctx.accountId, 'catalogo.pdf', pdf)

    try {
      await sendMessageToConversation(db, ctx.accountId, {
        conversationId,
        messageType: 'document',
        mediaUrl: pdfUrl,
        filename: 'catalogo.pdf',
        contentText: 'Catálogo de productos',
      })
    } catch (err) {
      if (err instanceof SendMessageError) {
        return NextResponse.json({ error: err.message }, { status: err.status })
      }
      throw err
    }

    return NextResponse.json({ ok: true, pdf_url: pdfUrl })
  } catch (err) {
    return toErrorResponse(err)
  }
}
