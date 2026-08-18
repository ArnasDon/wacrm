import type { SupabaseClient } from '@supabase/supabase-js'
import { renderQuotePdf } from '@/lib/pdf/quote-pdf'
import { uploadCatalogPdf } from '@/lib/pdf/upload-pdf'
import { sendMessageToConversation, SendMessageError } from '@/lib/whatsapp/send-message'
import { formatCurrency } from '@/lib/currency'
import type { Quote, QuoteItem } from '@/types'

export class SendQuoteError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

const MESSAGING_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * The contact's most recently active conversation for this account, on
 * any channel — "most recent wins," same rule the human quote-send
 * route already used before this lookup was extracted. Null if the
 * contact has never had a conversation here.
 */
export async function findRecentConversation(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<{ id: string } | null> {
  const { data } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as { id: string } | null) ?? null
}

/**
 * Whether `conversationId` currently sits inside WhatsApp's 24-hour
 * customer-initiated messaging window — i.e. whether a business-sent
 * free-form message (like a quote PDF) is allowed right now. Meta
 * enforces this itself and simply errors outside the window
 * (`sendMessageToConversation` never pre-checks it), so callers that
 * want to avoid a doomed send — or branch to a fallback flow instead —
 * check this first.
 */
export async function isWithinMessagingWindow(
  db: SupabaseClient,
  conversationId: string,
): Promise<boolean> {
  const { data } = await db
    .from('messages')
    .select('created_at')
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'customer')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data?.created_at) return false
  return Date.now() - new Date(data.created_at as string).getTime() < MESSAGING_WINDOW_MS
}

/**
 * Ensures `quoteId` has a rendered PDF (generating + persisting one if
 * missing), sends it as a document into `conversationId`, and marks the
 * quote sent (clearing `auto_send_pending` along the way, harmless for
 * quotes that never had it set). Shared core behind the human-triggered
 * `POST /api/quotes/[id]/send` route, the public catalog page's "Me lo
 * llevo" instant-push path, and the WhatsApp webhook's auto-send of a
 * pending quote once the contact's messaging window (re)opens.
 */
export async function sendQuoteToConversation(
  db: SupabaseClient,
  accountId: string,
  quoteId: string,
  conversationId: string,
): Promise<{ pdfUrl: string }> {
  const { data: quote, error: quoteError } = await db
    .from('quotes')
    .select('*')
    .eq('id', quoteId)
    .eq('account_id', accountId)
    .maybeSingle()
  if (quoteError) throw new SendQuoteError(quoteError.message, 500)
  if (!quote) throw new SendQuoteError('Quote not found', 404)

  let pdfUrl = quote.pdf_url as string | null
  if (!pdfUrl) {
    const { data: items, error: itemsError } = await db
      .from('quote_items')
      .select('*')
      .eq('quote_id', quoteId)
      .order('position')
    if (itemsError) throw new SendQuoteError(itemsError.message, 500)

    const { data: account } = await db.from('accounts').select('name').eq('id', accountId).maybeSingle()
    const pdf = await renderQuotePdf(quote as Quote, (items ?? []) as QuoteItem[], account?.name ?? 'Chat Sandía')
    pdfUrl = await uploadCatalogPdf(db, accountId, `cotizacion-${quoteId}.pdf`, pdf)
    await db.from('quotes').update({ pdf_url: pdfUrl }).eq('id', quoteId).eq('account_id', accountId)
  }

  try {
    await sendMessageToConversation(db, accountId, {
      conversationId,
      messageType: 'document',
      mediaUrl: pdfUrl,
      filename: `cotizacion-${quoteId}.pdf`,
      contentText: 'Cotización',
    })
  } catch (err) {
    if (err instanceof SendMessageError) throw new SendQuoteError(err.message, err.status)
    throw err
  }

  await db
    .from('quotes')
    .update({ sent_at: new Date().toISOString(), status: 'sent', auto_send_pending: false })
    .eq('id', quoteId)
    .eq('account_id', accountId)

  return { pdfUrl }
}

/**
 * Alternative to `sendQuoteToConversation` that delivers the quote as
 * a plain-text summary instead of a PDF — no file generated or
 * uploaded at all. Currently only reachable from the AI's
 * `create_quote_chat` action (`src/lib/ai/auto-reply.ts`), for
 * accounts whose catalog is a PDF/photos rather than the digital page
 * (whose own cart always uses the PDF path, unchanged). Shares the
 * same `quote_items` fetch and "mark sent" bookkeeping as the PDF path
 * so both leave the quote in an identical state afterward.
 */
export async function sendQuoteAsText(
  db: SupabaseClient,
  accountId: string,
  quoteId: string,
  conversationId: string,
): Promise<void> {
  const { data: quote, error: quoteError } = await db
    .from('quotes')
    .select('*')
    .eq('id', quoteId)
    .eq('account_id', accountId)
    .maybeSingle()
  if (quoteError) throw new SendQuoteError(quoteError.message, 500)
  if (!quote) throw new SendQuoteError('Quote not found', 404)

  const { data: items, error: itemsError } = await db
    .from('quote_items')
    .select('*')
    .eq('quote_id', quoteId)
    .order('position')
  if (itemsError) throw new SendQuoteError(itemsError.message, 500)

  const currency = (quote as Quote).currency
  const lines = ((items ?? []) as QuoteItem[]).map(
    (item) =>
      `${item.quantity}x ${item.description} — ${formatCurrency(item.unit_price, currency)} c/u = ${formatCurrency(item.line_total, currency)}`,
  )
  const summary = ['Cotización:', ...lines, '', `Total: ${formatCurrency((quote as Quote).total, currency)}`].join('\n')

  try {
    await sendMessageToConversation(db, accountId, {
      conversationId,
      messageType: 'text',
      contentText: summary,
    })
  } catch (err) {
    if (err instanceof SendMessageError) throw new SendQuoteError(err.message, err.status)
    throw err
  }

  await db
    .from('quotes')
    .update({ sent_at: new Date().toISOString(), status: 'sent', auto_send_pending: false })
    .eq('id', quoteId)
    .eq('account_id', accountId)
}
