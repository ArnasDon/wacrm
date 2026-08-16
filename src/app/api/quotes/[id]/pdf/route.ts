import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { renderQuotePdf } from '@/lib/pdf/quote-pdf'
import { uploadCatalogPdf } from '@/lib/pdf/upload-pdf'
import type { Quote, QuoteItem } from '@/types'

/**
 * POST /api/quotes/[id]/pdf  (agent+)
 *
 * (Re)generates the quote's PDF and stores its public URL on the row.
 * Idempotent — safe to call again after the quote or its items change.
 */
export async function POST(
  _request: Request,
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
    const db = supabaseAdmin()

    const { data: quote, error: quoteError } = await db
      .from('quotes')
      .select('*')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle()
    if (quoteError) return NextResponse.json({ error: quoteError.message }, { status: 500 })
    if (!quote) return NextResponse.json({ error: 'Quote not found' }, { status: 404 })

    const { data: items, error: itemsError } = await db
      .from('quote_items')
      .select('*')
      .eq('quote_id', id)
      .order('position')
    if (itemsError) return NextResponse.json({ error: itemsError.message }, { status: 500 })

    const { data: account } = await db
      .from('accounts')
      .select('name')
      .eq('id', ctx.accountId)
      .maybeSingle()

    const pdf = await renderQuotePdf(quote as Quote, (items ?? []) as QuoteItem[], account?.name ?? 'Chat Sandía')
    const pdfUrl = await uploadCatalogPdf(db, ctx.accountId, `cotizacion-${id}.pdf`, pdf)

    const { error: updateError } = await db
      .from('quotes')
      .update({ pdf_url: pdfUrl })
      .eq('id', id)
      .eq('account_id', ctx.accountId)
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

    return NextResponse.json({ pdf_url: pdfUrl })
  } catch (err) {
    return toErrorResponse(err)
  }
}
