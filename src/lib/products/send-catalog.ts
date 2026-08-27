import type { SupabaseClient } from '@supabase/supabase-js'
import { sendMessageToConversation, SendMessageError } from '@/lib/whatsapp/send-message'
import { signCatalogConversation } from '@/lib/products/catalog-link-token'

export class SendCatalogError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

/**
 * `NEXT_PUBLIC_SITE_URL` verbatim, no trailing slash — this runs from
 * both an HTTP route (which has a `Request` to derive an origin from)
 * and the AI's autonomous auto-reply path (a background job with no
 * incoming request), so per .env.local.example's own guidance this is
 * exactly the case the env var exists for: reading it directly rather
 * than plumbing a `Request` through every caller.
 */
function siteBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (!explicit) {
    throw new SendCatalogError('NEXT_PUBLIC_SITE_URL is not configured.', 500)
  }
  return explicit.replace(/\/+$/, '')
}

interface CatalogDeliveryRow {
  catalog_delivery_mode: 'digital' | 'pdf' | 'photos'
  catalog_pdf_url: string | null
  catalog_photo_urls: string[] | null
}

/**
 * Sends the account's catalog to `conversationId` — the shared core
 * behind both the human-triggered `POST /api/products/send-catalog`
 * route and the AI's autonomous `send_catalog` action
 * (`src/lib/ai/auto-reply.ts`). `sendMessageToConversation` is
 * channel-agnostic, so every mode below already works over WhatsApp,
 * Instagram, and Facebook without any per-channel branching here.
 *
 * Branches on `accounts.catalog_delivery_mode` (migration 068) — each
 * company adapts this to whatever already worked for them before Chat
 * Sandía, rather than being forced onto the live digital page:
 *
 *   - 'digital' (default): unchanged — a link to the always-current
 *     public catalog page.
 *   - 'pdf' / 'photos': the owner's own existing catalog file(s),
 *     uploaded as-is in Products → Catalog — never generated from
 *     product records. `products` stays the separate, always-
 *     searchable database the team/AI use for price/detail questions
 *     even when what's actually sent is just a PDF/photos.
 */
export async function sendCatalogToConversation(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
): Promise<{ catalogUrl: string | null }> {
  const { data: account, error: accountError } = await db
    .from('accounts')
    .select('catalog_delivery_mode, catalog_pdf_url, catalog_photo_urls')
    .eq('id', accountId)
    .maybeSingle<CatalogDeliveryRow>()
  if (accountError) throw new SendCatalogError(accountError.message, 500)
  const mode = account?.catalog_delivery_mode ?? 'digital'

  if (mode === 'pdf') {
    const pdfUrl = account?.catalog_pdf_url
    if (!pdfUrl) {
      throw new SendCatalogError(
        'Catalog is set to PDF but none has been uploaded yet — upload one in Products → Catalog.',
      )
    }
    try {
      await sendMessageToConversation(db, accountId, {
        conversationId,
        messageType: 'document',
        mediaUrl: pdfUrl,
        filename: 'Catalogo.pdf',
      })
    } catch (err) {
      if (err instanceof SendMessageError) throw new SendCatalogError(err.message, err.status)
      throw err
    }
    return { catalogUrl: null }
  }

  if (mode === 'photos') {
    const photoUrls = account?.catalog_photo_urls ?? []
    if (photoUrls.length === 0) {
      throw new SendCatalogError(
        'Catalog is set to photos but none have been uploaded yet — upload them in Products → Catalog.',
      )
    }
    try {
      for (const photoUrl of photoUrls) {
        await sendMessageToConversation(db, accountId, {
          conversationId,
          messageType: 'image',
          mediaUrl: photoUrl,
        })
      }
    } catch (err) {
      if (err instanceof SendMessageError) throw new SendCatalogError(err.message, err.status)
      throw err
    }
    return { catalogUrl: null }
  }

  // 'digital' — unchanged behavior, requires at least one active
  // product (the other two modes don't depend on `products` for what
  // gets sent, so this check stays scoped to this branch).
  const { count, error: countError } = await db
    .from('products')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .eq('is_active', true)
  if (countError) throw new SendCatalogError(countError.message, 500)
  if (!count) {
    throw new SendCatalogError('No active products in the catalog yet.')
  }

  // Carries the originating conversation so the public catalog page can
  // hand it straight back on "Me lo llevo" (see quote-request/route.ts)
  // instead of having to guess which of the contact's conversations —
  // possibly on a different channel — to deliver the quote into. The id
  // is HMAC-signed (see catalog-link-token.ts) so a visitor can't swap
  // in another conversation's id.
  const catalogUrl = `${siteBaseUrl()}/catalog/${accountId}?c=${signCatalogConversation(conversationId)}`

  try {
    await sendMessageToConversation(db, accountId, {
      conversationId,
      messageType: 'text',
      contentText: `Puedes ver nuestro catálogo completo aquí: ${catalogUrl}`,
    })
  } catch (err) {
    if (err instanceof SendMessageError) throw new SendCatalogError(err.message, err.status)
    throw err
  }

  return { catalogUrl }
}
