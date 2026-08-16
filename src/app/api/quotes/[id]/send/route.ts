import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { renderQuotePdf } from '@/lib/pdf/quote-pdf'
import { uploadCatalogPdf } from '@/lib/pdf/upload-pdf'
import { sendMessageToConversation, SendMessageError } from '@/lib/whatsapp/send-message'
import type { Quote, QuoteItem } from '@/types'

/**
 * POST /api/quotes/[id]/send  (agent+)
 *
 * Body: { conversation_id? } — targets that conversation, or (if
 * omitted) the contact's most recently active conversation on any
 * channel. Ensures the quote has a PDF (generates one if missing),
 * then sends it as a document through the existing channel-agnostic
 * send core, which already branches on `conversation.channel` toward
 * WhatsApp/Instagram/Facebook — no per-channel dispatch needed here.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let ctx
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const db = supabaseAdmin()

    const { data: quote, error: quoteError } = await db
      .from('quotes')
      .select('*')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle()
    if (quoteError) return NextResponse.json({ error: quoteError.message }, { status: 500 })
    if (!quote) return NextResponse.json({ error: 'Quote not found' }, { status: 404 })

    let conversationId = typeof body.conversation_id === 'string' ? body.conversation_id : ''
    if (conversationId) {
      const { data: conv } = await db
        .from('conversations')
        .select('id')
        .eq('id', conversationId)
        .eq('account_id', ctx.accountId)
        .maybeSingle()
      if (!conv) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    } else {
      const { data: conv } = await db
        .from('conversations')
        .select('id')
        .eq('account_id', ctx.accountId)
        .eq('contact_id', quote.contact_id)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (!conv) {
        return NextResponse.json(
          { error: 'No conversation exists yet for this contact — message them first.' },
          { status: 400 },
        )
      }
      conversationId = conv.id as string
    }

    let pdfUrl = quote.pdf_url as string | null
    if (!pdfUrl) {
      const { data: items, error: itemsError } = await db
        .from('quote_items')
        .select('*')
        .eq('quote_id', id)
        .order('position')
      if (itemsError) return NextResponse.json({ error: itemsError.message }, { status: 500 })

      const { data: account } = await db.from('accounts').select('name').eq('id', ctx.accountId).maybeSingle()
      const pdf = await renderQuotePdf(quote as Quote, (items ?? []) as QuoteItem[], account?.name ?? 'Chat Sandía')
      pdfUrl = await uploadCatalogPdf(db, ctx.accountId, `cotizacion-${id}.pdf`, pdf)
      await db.from('quotes').update({ pdf_url: pdfUrl }).eq('id', id).eq('account_id', ctx.accountId)
    }

    try {
      await sendMessageToConversation(db, ctx.accountId, {
        conversationId,
        messageType: 'document',
        mediaUrl: pdfUrl,
        filename: `cotizacion-${id}.pdf`,
        contentText: 'Cotización',
      })
    } catch (err) {
      if (err instanceof SendMessageError) {
        return NextResponse.json({ error: err.message }, { status: err.status })
      }
      throw err
    }

    await db
      .from('quotes')
      .update({ sent_at: new Date().toISOString(), status: 'sent' })
      .eq('id', id)
      .eq('account_id', ctx.accountId)

    return NextResponse.json({ ok: true, pdf_url: pdfUrl })
  } catch (err) {
    return toErrorResponse(err)
  }
}
