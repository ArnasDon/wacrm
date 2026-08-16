import type { SupabaseClient } from '@supabase/supabase-js'
import { renderCatalogPdf } from '@/lib/pdf/catalog-pdf'
import { uploadCatalogPdf } from '@/lib/pdf/upload-pdf'
import { sendMessageToConversation, SendMessageError } from '@/lib/whatsapp/send-message'
import type { Product } from '@/types'

export class SendCatalogError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

/**
 * Renders the account's active-product catalog as a PDF and sends it
 * to `conversationId` — the shared core behind both the human-triggered
 * `POST /api/products/send-catalog` route and the AI's autonomous
 * `send_catalog` action (`src/lib/ai/auto-reply.ts`), so there's one
 * place that knows how to build and deliver a catalog. `sendMessageToConversation`
 * is channel-agnostic, so this already works over WhatsApp, Instagram,
 * and Facebook without any per-channel branching here.
 */
export async function sendCatalogToConversation(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
): Promise<{ pdfUrl: string }> {
  const [{ data: products, error: productsError }, { data: account }] = await Promise.all([
    db.from('products').select('*').eq('account_id', accountId).eq('is_active', true).order('created_at'),
    db.from('accounts').select('name, default_currency').eq('id', accountId).maybeSingle(),
  ])
  if (productsError) throw new SendCatalogError(productsError.message, 500)
  if (!products || products.length === 0) {
    throw new SendCatalogError('No active products in the catalog yet.')
  }

  const pdf = await renderCatalogPdf(products as Product[], account?.name ?? 'Chat Sandía', account?.default_currency ?? 'USD')
  const pdfUrl = await uploadCatalogPdf(db, accountId, 'catalogo.pdf', pdf)

  try {
    await sendMessageToConversation(db, accountId, {
      conversationId,
      messageType: 'document',
      mediaUrl: pdfUrl,
      filename: 'catalogo.pdf',
      contentText: 'Catálogo de productos',
    })
  } catch (err) {
    if (err instanceof SendMessageError) throw new SendCatalogError(err.message, err.status)
    throw err
  }

  return { pdfUrl }
}
