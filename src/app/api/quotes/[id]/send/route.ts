import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { sendQuoteByAccountPreference, SendQuoteError } from '@/lib/quotes/send-quote'

/**
 * POST /api/quotes/[id]/send  (agent+)
 *
 * Body: { conversation_id? } — targets that conversation, or (if
 * omitted) the contact's most recently active conversation on any
 * channel. Delivers the quote per the account's
 * `quote_delivery_mode` (migration 109) — a rendered PDF document or a
 * plain-text breakdown — through the existing channel-agnostic send
 * core, which already branches on `conversation.channel` toward
 * WhatsApp/Instagram/Facebook.
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
      .select('contact_id')
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

    try {
      const { mode, pdfUrl } = await sendQuoteByAccountPreference(
        db,
        ctx.accountId,
        id,
        conversationId,
      )
      return NextResponse.json({ ok: true, mode, pdf_url: pdfUrl })
    } catch (err) {
      if (err instanceof SendQuoteError) {
        return NextResponse.json({ error: err.message }, { status: err.status })
      }
      throw err
    }
  } catch (err) {
    return toErrorResponse(err)
  }
}
